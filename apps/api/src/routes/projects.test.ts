import { createHash } from "node:crypto"
import type { AddressInfo } from "node:net"

import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"

import { daemons, events, projects } from "@devforge/db"
import { ApiToDaemonMessageSchema } from "@devforge/protocol"

import type { AppDeps } from "../app.js"
import { buildApp } from "../app.js"
import { DaemonConnectionRegistry } from "../daemon/connection-registry.js"
import { PendingRequestManager } from "../daemon/pending-requests.js"

const daemonId = "11111111-1111-4111-8111-111111111111"
const projectId = "22222222-2222-4222-8222-222222222222"
const bindingId = "33333333-3333-4333-8333-333333333333"

const credential = "devforge-local-development-credential-0001"

const credentialHash = createHash("sha256").update(credential).digest("hex")

const validStatus = {
  branch: {
    head: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
  },
  staged: 1,
  unstaged: 2,
  untracked: 3,
  conflicted: 0,
  clean: false,
}

type StoredEvent = {
  id: string
  projectId: string
  daemonId: string | null
  requestId: string
  type: string
  payload: unknown
  createdAt: Date
}

function createFakeDb() {
  const storedEvents: StoredEvent[] = []

  const daemonRow = {
    id: daemonId,
    name: "Test daemon",
    credentialHash,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const projectRow = {
    id: projectId,
    name: "Test project",
    daemonId,
    daemonBindingId: bindingId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const fakeDb = {
    select: () => ({
      from: (table: unknown) => {
        if (table === events) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: async () =>
                  [...storedEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
              }),
            }),
          }
        }

        return {
          where: () => ({
            limit: async () => {
              if (table === daemons) {
                return [daemonRow]
              }

              if (table === projects) {
                return [projectRow]
              }

              return []
            },
          }),
        }
      },
    }),

    insert: (table: unknown) => ({
      values: async (value: unknown) => {
        if (table === events) {
          const values = Array.isArray(value) ? value : [value]

          for (const event of values) {
            storedEvents.push(event as StoredEvent)
          }
        }

        return []
      },
    }),

    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
  }

  return {
    db: fakeDb as unknown as AppDeps["db"],
    storedEvents,
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()))
      } catch (error) {
        reject(error)
      }
    })

    socket.once("error", reject)
  })
}

async function waitForCommandRequest(socket: WebSocket) {
  const raw = await waitForMessage(socket)
  const message = ApiToDaemonMessageSchema.parse(raw)

  if (message.type !== "command.request") {
    throw new Error(`Expected command.request, received ${message.type}`)
  }

  return message
}

describe("POST /api/projects/:projectId/git-status", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = []
  const sockets: WebSocket[] = []

  afterEach(async () => {
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
      }
    }

    sockets.length = 0

    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  async function setup(commandTimeoutMs = 1_000) {
    const fakeDb = createFakeDb()
    const registry = new DaemonConnectionRegistry()
    const pendingRequests = new PendingRequestManager()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests,
      commandTimeoutMs,
    })

    apps.push(app)

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    return {
      app,
      registry,
      storedEvents: fakeDb.storedEvents,
      wsUrl: `ws://127.0.0.1:${address.port}/api/daemon`,
    }
  }

  async function connectDaemon(wsUrl: string) {
    const socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    sockets.push(socket)

    await waitForOpen(socket)

    const readyPromise = waitForMessage(socket)

    socket.send(
      JSON.stringify({
        version: 1,
        type: "daemon.hello",
        messageId: "66666666-6666-4666-8666-666666666666",
        payload: {
          daemonId,
          supportedVersions: [1],
          capabilities: ["git.status"],
          bindings: [
            {
              projectId,
              bindingId,
            },
          ],
        },
      })
    )

    const ready = ApiToDaemonMessageSchema.parse(await readyPromise)

    expect(ready.type).toBe("daemon.ready")

    return socket
  }

  it("dispatches git.status and returns a correlated result", { timeout: 10_000 }, async () => {
    const { app, wsUrl, storedEvents } = await setup()
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    expect(command.payload.command).toEqual({
      type: "git.status",
    })

    expect(command.payload).not.toHaveProperty("repositoryRoot")
    expect(command.payload.command).not.toHaveProperty("args")
    expect(command.payload.command).not.toHaveProperty("executable")

    const completedAt = new Date().toISOString()

    socket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          requestId: command.payload.requestId,
          projectId,
          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt,
        },
      })
    )

    const response = await responsePromise

    expect(response.statusCode).toBe(200)

    expect(response.json()).toEqual({
      requestId: command.payload.requestId,
      status: validStatus,
      completedAt,
    })

    expect(storedEvents).toHaveLength(2)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.succeeded",
      payload: {
        status: validStatus,
      },
    })
  })

  it("rejects a second request while one is already in flight", async () => {
    const { app, wsUrl } = await setup()
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const firstResponsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    const secondResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    expect(secondResponse.statusCode).toBe(409)

    expect(secondResponse.json()).toEqual({
      code: "REQUEST_ALREADY_IN_FLIGHT",
      message: "A Git status request is already in flight",
    })

    socket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          requestId: command.payload.requestId,
          projectId,
          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      })
    )

    const firstResponse = await firstResponsePromise

    expect(firstResponse.statusCode).toBe(200)
  })

  it("persists a failure and returns 504 when the daemon times out", async () => {
    const { app, wsUrl, storedEvents } = await setup(50)
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    // Intentionally do not respond.
    const response = await responsePromise

    expect(response.statusCode).toBe(504)

    expect(response.json()).toEqual({
      code: "COMMAND_TIMEOUT",
      message: "Git status command timed out",
    })

    expect(storedEvents).toHaveLength(2)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.failed",
      payload: {
        code: "COMMAND_TIMEOUT",
      },
    })
  })

  it("fails promptly when the daemon disconnects", async () => {
    const { app, wsUrl, storedEvents } = await setup(5_000)
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    socket.close()

    const response = await responsePromise

    expect(response.statusCode).toBe(409)

    expect(response.json()).toEqual({
      code: "DAEMON_DISCONNECTED",
      message: "Daemon disconnected while command was in flight",
    })

    expect(storedEvents).toHaveLength(2)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.failed",
      payload: {
        code: "DAEMON_DISCONNECTED",
      },
    })
  })

  it("does not accept a mismatched command result", async () => {
    const { app, wsUrl, storedEvents } = await setup(100)
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    socket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          requestId: command.payload.requestId,

          // Valid UUID, but deliberately wrong project.
          projectId: "88888888-8888-4888-8888-888888888888",

          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      })
    )

    const response = await responsePromise

    expect(response.statusCode).not.toBe(200)

    expect(storedEvents.some((event) => event.type === "git.status.succeeded")).toBe(false)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.failed",
    })
  })

  it("rejects a request when the daemon is disconnected without creating activity", async () => {
    const { app, storedEvents } = await setup()

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    expect(response.statusCode).toBe(409)

    expect(response.json()).toEqual({
      code: "DAEMON_DISCONNECTED",
      message: "Daemon is disconnected",
    })

    expect(storedEvents).toHaveLength(0)
  })
})
