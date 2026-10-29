import { createHash, randomUUID, timingSafeEqual } from "node:crypto"

import { eq } from "drizzle-orm"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type WebSocket from "ws"

import { daemons, projects } from "@devforge/db"
import {
  ApiToDaemonMessageSchema,
  DaemonToApiMessageSchema,
  PROTOCOL_VERSION,
} from "@devforge/protocol"

import type { AppDeps } from "../app.js"

const DAEMON_ID_HEADER = "x-devforge-daemon-id"

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null
  }

  const [scheme, token, ...rest] = authorization.trim().split(/\s+/)

  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
    return null
  }

  return token
}

function hashCredential(credential: string): Buffer {
  return createHash("sha256").update(credential).digest()
}

function credentialsMatch(credential: string, credentialHash: string): boolean {
  const provided = hashCredential(credential)
  const expected = Buffer.from(credentialHash, "hex")

  if (provided.length !== expected.length) {
    return false
  }

  return timingSafeEqual(provided, expected)
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data)
  }

  return Buffer.from(data)
}

async function authenticateDaemon(
  request: FastifyRequest,
  deps: AppDeps
): Promise<{ daemonId: string } | null> {
  const daemonIdHeader = request.headers[DAEMON_ID_HEADER]
  const authorization = request.headers.authorization

  if (typeof daemonIdHeader !== "string" || typeof authorization !== "string") {
    return null
  }

  const credential = extractBearerToken(authorization)

  if (!credential) {
    return null
  }

  const [daemon] = await deps.db
    .select({
      id: daemons.id,
      credentialHash: daemons.credentialHash,
    })
    .from(daemons)
    .where(eq(daemons.id, daemonIdHeader))
    .limit(1)

  if (!daemon) {
    return null
  }

  if (!credentialsMatch(credential, daemon.credentialHash)) {
    return null
  }

  return {
    daemonId: daemon.id,
  }
}

export function registerDaemonWebSocket(app: FastifyInstance, deps: AppDeps): void {
  app.get(deps.daemonWsPath, { websocket: true }, async (socket, request) => {
    let authenticated = false
    let daemonId: string | null = null
    let ready = false
    const pending: Array<Buffer> = []

    // Attach the message listener before any await so that frames which arrive
    // while authentication is in flight (e.g. daemon.hello, which the daemon
    // sends immediately after the socket opens) are not dropped by the ws
    // library. Pre-authentication frames are buffered and replayed below.
    socket.on("message", async (data) => {
      const buffer = toBuffer(data)

      if (!authenticated || daemonId === null) {
        pending.push(buffer)
        return
      }

      await processMessage(socket, buffer, daemonId)
    })

    const auth = await authenticateDaemon(request, deps)

    if (!auth) {
      socket.close(1008, "Unauthorized")
      return
    }

    daemonId = auth.daemonId
    authenticated = true

    // Replay any messages that arrived while authentication was in flight.
    const buffered = pending.splice(0, pending.length)
    for (const data of buffered) {
      await processMessage(socket, data, daemonId)
    }

    async function processMessage(
      socket: WebSocket,
      data: Buffer,
      daemonId: string
    ): Promise<void> {
      let raw: unknown

      try {
        raw = JSON.parse(data.toString())
      } catch {
        socket.close(1008, "Invalid protocol message")
        return
      }

      const parsed = DaemonToApiMessageSchema.safeParse(raw)

      if (!parsed.success) {
        socket.close(1008, "Invalid protocol message")
        return
      }

      const message = parsed.data

      if (!ready) {
        if (message.type !== "daemon.hello") {
          socket.close(1008, "Expected daemon.hello")
          return
        }

        if (message.payload.daemonId !== daemonId) {
          socket.close(1008, "Daemon identity mismatch")
          return
        }

        if (!message.payload.supportedVersions.includes(PROTOCOL_VERSION)) {
          socket.close(1008, "Unsupported protocol version")
          return
        }

        if (!message.payload.capabilities.includes("git.status")) {
          socket.close(1008, "Required capability missing")
          return
        }

        const acceptedBindings: Array<{
          projectId: string
          bindingId: string
        }> = []

        for (const advertisedBinding of message.payload.bindings) {
          const [project] = await deps.db
            .select({
              id: projects.id,
              daemonId: projects.daemonId,
              daemonBindingId: projects.daemonBindingId,
            })
            .from(projects)
            .where(eq(projects.id, advertisedBinding.projectId))
            .limit(1)

          if (!project) {
            continue
          }

          if (project.daemonId !== daemonId) {
            continue
          }

          if (project.daemonBindingId !== advertisedBinding.bindingId) {
            continue
          }

          acceptedBindings.push(advertisedBinding)
        }

        deps.registry.setConnection(daemonId, {
          socket,
          acceptedBindings,
          connectedAt: new Date(),
        })

        socket.on("close", () => {
          deps.registry.removeConnection(daemonId, socket)
        })

        await deps.db
          .update(daemons)
          .set({
            lastSeenAt: new Date(),
          })
          .where(eq(daemons.id, daemonId))

        const readyMessage = ApiToDaemonMessageSchema.parse({
          version: PROTOCOL_VERSION,
          type: "daemon.ready",
          messageId: randomUUID(),
          payload: {
            selectedVersion: PROTOCOL_VERSION,
            bindings: acceptedBindings,
          },
        })

        socket.send(JSON.stringify(readyMessage))

        ready = true
        return
      }

      if (message.type === "heartbeat") {
        if (message.payload.daemonId !== daemonId) {
          socket.close(1008, "Daemon identity mismatch")
          return
        }

        await deps.db
          .update(daemons)
          .set({
            lastSeenAt: new Date(),
          })
          .where(eq(daemons.id, daemonId))

        const ack = ApiToDaemonMessageSchema.parse({
          version: PROTOCOL_VERSION,
          type: "heartbeat.ack",
          messageId: randomUUID(),
          payload: {
            daemonId,
            timestamp: new Date().toISOString(),
          },
        })

        socket.send(JSON.stringify(ack))
        return
      }

      // command.result and command.error become meaningful
      // once command correlation exists in the next steps.
    }
  })
}
