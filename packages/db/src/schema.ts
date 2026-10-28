import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const daemons = pgTable("daemons", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  credentialHash: text("credential_hash").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  daemonId: uuid("daemon_id")
    .notNull()
    .references(() => daemons.id),
  daemonBindingId: uuid("daemon_binding_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    daemonId: uuid("daemon_id").references(() => daemons.id),
    requestId: uuid("request_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    requestIdIdx: index("events_request_id_idx").on(table.requestId),
  })
)
