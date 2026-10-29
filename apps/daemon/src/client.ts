import { randomUUID } from "node:crypto"

import WebSocket from "ws"

import type { DaemonConfig, DaemonLocalConfig } from "@devforge/config"
import { ApiToDaemonMessageSchema, PROTOCOL_VERSION } from "@devforge/protocol"

type StartDaemonClientOptions = {
  config: DaemonConfig
  localConfig: DaemonLocalConfig
}

export function startDaemonClient({ config, localConfig }: StartDaemonClientOptions): WebSocket {
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

  socket.on("message", (data) => {
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

    // command.request will be implemented in a later step.
  })

  socket.on("close", (code, reason) => {
    console.log(`Daemon connection closed (${code}): ${reason.toString()}`)
  })

  socket.on("error", (error) => {
    console.error("Daemon WebSocket error:", error.message)
  })

  return socket
}
