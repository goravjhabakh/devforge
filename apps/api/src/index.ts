import { config } from "dotenv"
import { loadApiConfig } from "@devforge/config"
import { createDb } from "@devforge/db"

import { buildApp } from "./app.js"
import { DaemonConnectionRegistry } from "./daemon/connection-registry.js"

config({ path: "../../.env" })
const apiConfig = loadApiConfig(process.env)
const database = createDb(apiConfig.DATABASE_URL)
const registry = new DaemonConnectionRegistry()

const app = await buildApp({
  db: database.db,
  daemonWsPath: apiConfig.DAEMON_WS_PATH,
  registry,
})

let shuttingDown = false

async function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  try {
    await app.close()
  } finally {
    await database.close()
  }
}

process.on("SIGINT", () => {
  void shutdown()
})

process.on("SIGTERM", () => {
  void shutdown()
})

try {
  await app.listen({
    host: apiConfig.HOST,
    port: apiConfig.PORT,
  })
} catch (error) {
  await shutdown()
  throw error
}
