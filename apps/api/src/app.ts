import Fastify from "fastify"
import type { createDb } from "@devforge/db"
import { registerProjectRoutes } from "./routes/projects.js"

export type AppDeps = {
  db: ReturnType<typeof createDb>["db"]
}

export function buildApp(deps: AppDeps) {
  const app = Fastify()

  app.get("/api/health", async () => {
    return {
      status: "ok",
    }
  })

  registerProjectRoutes(app, deps)

  return app
}
