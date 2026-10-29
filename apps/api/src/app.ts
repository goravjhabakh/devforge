import websocketPlugin from "@fastify/websocket"
import Fastify from "fastify"

import type { createDb } from "@devforge/db"

import type { DaemonConnectionRegistry } from "./daemon/connection-registry.js"
import type { PendingRequestManager } from "./daemon/pending-requests.js"
import { registerDaemonWebSocket } from "./daemon/websocket.js"
import { registerProjectRoutes } from "./routes/projects.js"

export type AppDeps = {
  db: ReturnType<typeof createDb>["db"]
  daemonWsPath: string
  registry: DaemonConnectionRegistry
  pendingRequests: PendingRequestManager
  commandTimeoutMs: number
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify()

  await app.register(websocketPlugin)

  app.get("/api/health", async () => {
    return {
      status: "ok",
    }
  })

  registerProjectRoutes(app, deps)
  registerDaemonWebSocket(app, deps)

  return app
}
