import type { BootstrapPlanDocument } from "@devforge/contracts"
import { bootstrapApprovals, bootstrapPlans, type createDb, projects } from "@devforge/db"
import { and, desc, eq, inArray } from "drizzle-orm"

type Database = ReturnType<typeof createDb>["db"]

export type PersistBootstrapPlanInput = {
  projectId: string
  document: BootstrapPlanDocument
  planHash: string
}

export async function createBootstrapPlanRevision(db: Database, input: PersistBootstrapPlanInput) {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({
        revision: bootstrapPlans.revision,
      })
      .from(bootstrapPlans)
      .where(eq(bootstrapPlans.projectId, input.projectId))
      .orderBy(desc(bootstrapPlans.revision))
      .limit(1)

    const revision = (latest?.revision ?? 0) + 1

    await tx
      .update(bootstrapPlans)
      .set({
        status: "superseded",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bootstrapPlans.projectId, input.projectId),
          inArray(bootstrapPlans.status, ["awaiting_approval", "approved"])
        )
      )

    const [plan] = await tx
      .insert(bootstrapPlans)
      .values({
        projectId: input.projectId,
        revision,
        schemaVersion: input.document.schemaVersion,
        planHash: input.planHash,
        document: input.document,
        status: "awaiting_approval",
      })
      .returning()

    await tx
      .update(projects)
      .set({
        bootstrapState: "awaiting_approval",
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId))

    if (!plan) {
      throw new Error("Failed to create bootstrap plan")
    }

    return plan
  })
}

export async function approveBootstrapPlan(
  db: Database,
  input: {
    projectId: string
    planId: string
    planHash: string
  }
) {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(bootstrapPlans)
      .where(
        and(eq(bootstrapPlans.id, input.planId), eq(bootstrapPlans.projectId, input.projectId))
      )
      .limit(1)

    if (!plan) {
      return null
    }

    if (plan.status !== "awaiting_approval" || plan.planHash !== input.planHash) {
      return null
    }

    const [approval] = await tx
      .insert(bootstrapApprovals)
      .values({
        projectId: input.projectId,
        planId: input.planId,
        planHash: input.planHash,
      })
      .returning()

    await tx
      .update(bootstrapPlans)
      .set({
        status: "approved",
        updatedAt: new Date(),
      })
      .where(eq(bootstrapPlans.id, input.planId))

    await tx
      .update(projects)
      .set({
        bootstrapState: "approved",
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId))

    return approval ?? null
  })
}

export async function getLatestBootstrapPlan(db: Database, projectId: string) {
  const [plan] = await db
    .select()
    .from(bootstrapPlans)
    .where(eq(bootstrapPlans.projectId, projectId))
    .orderBy(desc(bootstrapPlans.revision))
    .limit(1)

  return plan ?? null
}

export async function getBootstrapApproval(db: Database, planId: string) {
  const [approval] = await db
    .select()
    .from(bootstrapApprovals)
    .where(eq(bootstrapApprovals.planId, planId))
    .limit(1)

  return approval ?? null
}
