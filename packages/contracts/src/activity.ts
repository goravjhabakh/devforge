import { z } from "zod"
import { GitStatusSchema } from "@devforge/protocol"

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

export const ActivityEventSchema = z.discriminatedUnion("type", [
  GitStatusRequestedActivitySchema,
  GitStatusSucceededActivitySchema,
  GitStatusFailedActivitySchema,
])

export type ActivityFailureCode = z.infer<typeof ActivityFailureCodeSchema>
export type GitStatusRequestedActivity = z.infer<typeof GitStatusRequestedActivitySchema>
export type GitStatusSucceededActivity = z.infer<typeof GitStatusSucceededActivitySchema>
export type GitStatusFailedActivity = z.infer<typeof GitStatusFailedActivitySchema>
export type ActivityEvent = z.infer<typeof ActivityEventSchema>
