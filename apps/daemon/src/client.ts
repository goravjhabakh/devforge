import { randomUUID } from "node:crypto"

import WebSocket from "ws"

import type { DaemonConfig, DaemonLocalConfig } from "@devforge/config"
import {
  ApiToDaemonMessageSchema,
  DaemonToApiMessageSchema,
  PROTOCOL_VERSION,
} from "@devforge/protocol"

import type { BindingRegistry } from "./binding-registry.js"
import { handleCommandRequest } from "./command-handler.js"
import { runGitStatus } from "./git-status.js"

type StartDaemonClientOptions = {
  config: DaemonConfig
  localConfig: DaemonLocalConfig
  bindingRegistry: BindingRegistry
}

export function startDaemonClient({
  config,
  localConfig,
  bindingRegistry,
}: StartDaemonClientOptions): WebSocket {
  const socket = new WebSocket(config.controlPlaneUrl, {
    headers: {
      Authorization: `Bearer ${config.credential}`,
      "X-Devforge-Daemon-Id": config.daemonId,
    },
  })

  let readyReceived = false

  socket.on("open", () => {
    const hello = DaemonToApiMessageSchema.parse({
      version: PROTOCOL_VERSION,
      type: "daemon.hello",
      messageId: randomUUID(),
      payload: {
        daemonId: config.daemonId,
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: ["git.status"],
        bindings: localConfig.bindings.map((binding) => ({
          projectId: binding.projectId,
          bindingId: binding.bindingId,
        })),
      },
    })

    socket.send(JSON.stringify(hello))
  })

  socket.on("message", async (data) => {
    let raw: unknown

    try {
      raw = JSON.parse(data.toString())
    } catch {
      socket.close(1008, "Invalid protocol message")
      return
    }

    const parsed = ApiToDaemonMessageSchema.safeParse(raw)

    if (!parsed.success) {
      socket.close(1008, "Invalid protocol message")
      return
    }

    const message = parsed.data

    if (message.type === "daemon.ready") {
      if (readyReceived) {
        console.warn("Received unexpected daemon.ready after handshake")
        return
      }

      readyReceived = true

      console.log(`Daemon ready: ${message.payload.bindings.length} binding(s) accepted`)

      return
    }

    if (message.type === "heartbeat.ack") {
      return
    }

    if (message.type === "command.request") {
      if (!readyReceived) {
        console.warn("Received command.request before daemon.ready")
        return
      }

      try {
        const outcome = await handleCommandRequest(message, {
          bindingRegistry,
          runGitStatus,
        })

        const response = DaemonToApiMessageSchema.parse({
          version: PROTOCOL_VERSION,
          type: outcome.type,
          messageId: randomUUID(),
          payload: outcome.payload,
        })

        socket.send(JSON.stringify(response))
      } catch {
        // The command handler is expected to convert normal capability
        // failures into command.error responses. Reaching this branch means
        // an unexpected internal failure occurred.
        const startedAt = new Date().toISOString()
        const completedAt = new Date().toISOString()

        const response = DaemonToApiMessageSchema.parse({
          version: PROTOCOL_VERSION,
          type: "command.error",
          messageId: randomUUID(),
          payload: {
            requestId: message.payload.requestId,
            projectId: message.payload.projectId,
            bindingId: message.payload.bindingId,
            commandType: "git.status",
            code: "GIT_STATUS_FAILED",
            message: "Git status failed",
            startedAt,
            completedAt,
          },
        })

        socket.send(JSON.stringify(response))
      }

      return
    }
  })

  socket.on("close", (code, reason) => {
    console.log(`Daemon connection closed (${code}): ${reason.toString()}`)
  })

  socket.on("error", (error) => {
    console.error("Daemon WebSocket error:", error.message)
  })

  return socket
}
