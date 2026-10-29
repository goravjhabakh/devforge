import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

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
  bootstrapState: text("bootstrap_state").notNull().default("succeeded"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const bootstrapPlans = pgTable(
  "bootstrap_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    revision: integer("revision").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    planHash: text("plan_hash").notNull(),
    document: jsonb("document").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: jsonb("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bootstrap_plans_project_revision_unique").on(table.projectId, table.revision),
    index("bootstrap_plans_project_status_idx").on(table.projectId, table.status),
  ]
)

export const bootstrapApprovals = pgTable(
  "bootstrap_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => bootstrapPlans.id),
    planHash: text("plan_hash").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("bootstrap_approvals_plan_unique").on(table.planId)]
)

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
  (table) => [index("events_request_id_idx").on(table.requestId)]
)
