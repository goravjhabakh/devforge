import { z } from "zod"
import { BootstrapFailureCodeSchema } from "./bootstrap.js"
import { GitStatusSchema } from "./git-status.js"

export const ActivityFailureCodeSchema = z.enum([
  "DAEMON_DISCONNECTED",
  "BINDING_NOT_AVAILABLE",
  "COMMAND_TIMEOUT",
  "BINDING_NOT_ALLOWED",
  "GIT_NOT_FOUND",
  "NOT_A_GIT_REPOSITORY",
  "OUTPUT_LIMIT_EXCEEDED",
  "GIT_STATUS_FAILED",
])

const ActivityBaseSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  daemonId: z.uuid().nullable(),
  requestId: z.uuid(),
  createdAt: z.iso.datetime(),
})

export const GitStatusRequestedActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("git.status.requested"),
  payload: z.strictObject({}),
})

export const GitStatusSucceededActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("git.status.succeeded"),
  payload: z.strictObject({
    status: GitStatusSchema,
  }),
})

export const GitStatusFailedActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("git.status.failed"),
  payload: z.strictObject({
    code: ActivityFailureCodeSchema,
    message: z.string().min(1),
  }),
})

export const BootstrapPlanCreatedActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("bootstrap.plan_created"),
  payload: z.strictObject({
    planId: z.uuid(),
    revision: z.number().int().positive(),
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
})

export const BootstrapApprovedActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("bootstrap.approved"),
  payload: z.strictObject({
    planId: z.uuid(),
    revision: z.number().int().positive(),
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
})

export const BootstrapRequestedActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("bootstrap.requested"),
  payload: z.strictObject({
    planId: z.uuid(),
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
    attempt: z.number().int().positive(),
    mode: z.enum(["initial", "resume"]),
  }),
})

export const BootstrapSucceededActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("bootstrap.succeeded"),
  payload: z.strictObject({
    planId: z.uuid(),
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
    attempt: z.number().int().positive(),
    verifiedOperationCount: z.number().int().nonnegative(),
    reusedOperationCount: z.number().int().nonnegative(),
    gitInitialized: z.boolean(),
  }),
})

export const BootstrapFailedActivitySchema = ActivityBaseSchema.extend({
  type: z.literal("bootstrap.failed"),
  payload: z.strictObject({
    planId: z.uuid(),
    planHash: z.string().regex(/^[0-9a-f]{64}$/),
    attempt: z.number().int().positive(),
    code: BootstrapFailureCodeSchema,
    message: z.string().min(1),
    completedOperationCount: z.number().int().nonnegative().optional(),
    reusedOperationCount: z.number().int().nonnegative().optional(),
  }),
})

export const ActivityEventSchema = z.discriminatedUnion("type", [
  GitStatusRequestedActivitySchema,
  GitStatusSucceededActivitySchema,
  GitStatusFailedActivitySchema,
  BootstrapPlanCreatedActivitySchema,
  BootstrapApprovedActivitySchema,
  BootstrapRequestedActivitySchema,
  BootstrapSucceededActivitySchema,
  BootstrapFailedActivitySchema,
])

export type ActivityFailureCode = z.infer<typeof ActivityFailureCodeSchema>

export type GitStatusRequestedActivity = z.infer<typeof GitStatusRequestedActivitySchema>
export type GitStatusSucceededActivity = z.infer<typeof GitStatusSucceededActivitySchema>
export type GitStatusFailedActivity = z.infer<typeof GitStatusFailedActivitySchema>

export type BootstrapPlanCreatedActivity = z.infer<typeof BootstrapPlanCreatedActivitySchema>
export type BootstrapApprovedActivity = z.infer<typeof BootstrapApprovedActivitySchema>
export type BootstrapRequestedActivity = z.infer<typeof BootstrapRequestedActivitySchema>
export type BootstrapSucceededActivity = z.infer<typeof BootstrapSucceededActivitySchema>
export type BootstrapFailedActivity = z.infer<typeof BootstrapFailedActivitySchema>

export type ActivityEvent = z.infer<typeof ActivityEventSchema>
