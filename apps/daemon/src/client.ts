import { randomUUID } from "node:crypto"

import WebSocket from "ws"

import type { DaemonConfig, DaemonLocalConfig } from "@devforge/config"
import {
  ApiToDaemonMessageSchema,
  DaemonToApiMessageSchema,
  PROTOCOL_VERSION,
} from "@devforge/protocol"
import type { BindingRegistry } from "./binding-registry.js"
import { BindingNotAllowedError } from "./binding-registry.js"

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

  socket.on("open", () => {
    const hello = {
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
    }

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
      console.log(`Daemon ready: ${message.payload.bindings.length} binding(s) accepted`)

      return
    }

    if (message.type === "heartbeat.ack") {
      return
    }

    if (message.type === "command.request") {
      const startedAt = new Date().toISOString()

      try {
        await bindingRegistry.authorizeBinding(message.payload.projectId, message.payload.bindingId)

        // Binding is locally authorized.
        //
        // Git execution is intentionally not implemented yet.
        // The next step will use the approved canonical root.
        return
      } catch (error) {
        if (!(error instanceof BindingNotAllowedError)) {
          throw error
        }

        const completedAt = new Date().toISOString()

        const response = DaemonToApiMessageSchema.safeParse({
          version: PROTOCOL_VERSION,
          type: "command.error",
          messageId: randomUUID(),
          payload: {
            requestId: message.payload.requestId,
            projectId: message.payload.projectId,
            bindingId: message.payload.bindingId,
            commandType: "git.status",
            code: "BINDING_NOT_ALLOWED",
            message: "Binding is not allowed",
            startedAt,
            completedAt,
          },
        })

        socket.send(JSON.stringify(response))
        return
      }
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
