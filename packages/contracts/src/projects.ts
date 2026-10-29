import { z } from "zod"
import { ActivityEventSchema } from "./activity.js"
import { BootstrapStateSchema } from "./bootstrap.js"
import { GitStatusSchema } from "./git-status.js"

export const ProjectDetailSchema = z.strictObject({
  project: z.strictObject({
    id: z.uuid(),
    name: z.string().min(1),
    bootstrapState: BootstrapStateSchema,
  }),

  daemon: z.strictObject({
    id: z.uuid(),
    connected: z.boolean(),
    lastSeenAt: z.iso.datetime().nullable(),
  }),

  binding: z.strictObject({
    available: z.boolean(),
  }),

  latestStatus: z
    .strictObject({
      status: GitStatusSchema,
      completedAt: z.iso.datetime(),
    })
    .nullable(),

  activity: z.array(ActivityEventSchema),
})

export type ProjectDetail = z.infer<typeof ProjectDetailSchema>

export const GitStatusResponseSchema = z.strictObject({
  requestId: z.uuid(),
  status: GitStatusSchema,
  completedAt: z.iso.datetime(),
})

export type GitStatusResponse = z.infer<typeof GitStatusResponseSchema>

export const ApiErrorCodeSchema = z.enum([
  "PROJECT_NOT_FOUND",
  "DAEMON_DISCONNECTED",
  "BINDING_NOT_AVAILABLE",
  "REQUEST_ALREADY_IN_FLIGHT",
  "COMMAND_TIMEOUT",
  "DAEMON_COMMAND_FAILED",
  "INTERNAL_ERROR",
])

export const ApiErrorSchema = z.strictObject({
  code: ApiErrorCodeSchema,
  message: z.string().min(1),
})

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
