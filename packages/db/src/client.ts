import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl)
  const db = drizzle(client)

  async function close() {
    await client.end()
  }

  return {
    db,
    close,
  }
}
