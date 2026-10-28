import { createHash } from "node:crypto"

import { config } from "dotenv"

import { createDb } from "./client.js"
import { daemons, projects } from "./schema.js"

config({ path: "../../.env" })

const DAEMON_ID = "11111111-1111-4111-8111-111111111111"

const PROJECT_A_ID = "22222222-2222-4222-8222-222222222222"
const BINDING_A_ID = "33333333-3333-4333-8333-333333333333"

const PROJECT_B_ID = "44444444-4444-4444-8444-444444444444"
const BINDING_B_ID = "55555555-5555-4555-8555-555555555555"

const DEVELOPMENT_CREDENTIAL = "devforge-local-development-credential-0001"

function hashCredential(credential: string) {
  return createHash("sha256").update(credential).digest("hex")
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL

  if (typeof databaseUrl !== "string") {
    throw new Error("DATABASE_URL is required")
  }
  const { db, close } = createDb(databaseUrl)

  try {
    await db
      .insert(daemons)
      .values({
        id: DAEMON_ID,
        name: "Local Development Daemon",
        credentialHash: hashCredential(DEVELOPMENT_CREDENTIAL),
      })
      .onConflictDoNothing()

    await db
      .insert(projects)
      .values([
        {
          id: PROJECT_A_ID,
          name: "Development Project A",
          daemonId: DAEMON_ID,
          daemonBindingId: BINDING_A_ID,
        },
        {
          id: PROJECT_B_ID,
          name: "Development Project B",
          daemonId: DAEMON_ID,
          daemonBindingId: BINDING_B_ID,
        },
      ])
      .onConflictDoNothing()
  } finally {
    await close()
  }
}

await main()
