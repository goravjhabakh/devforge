import { z } from "zod"
import { GitStatusSchema } from "./git-status.js"
import { BootstrapPlanDocumentSchema } from "@devforge/contracts"

export const PROTOCOL_VERSION = 1 as const

const MessageIdSchema = z.uuid()
const RequestIdSchema = z.uuid()
const ProjectIdSchema = z.uuid()
const BindingIdSchema = z.uuid()
const DaemonIdSchema = z.uuid()

const DaemonCapabilitySchema = z.enum(["git.status", "bootstrap.apply"])

export const DaemonBindingRefSchema = z.strictObject({
  projectId: ProjectIdSchema,
  bindingId: BindingIdSchema,
})

export const DaemonHelloMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("daemon.hello"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    daemonId: DaemonIdSchema,
    supportedVersions: z.array(z.literal(PROTOCOL_VERSION)),
    capabilities: z.array(DaemonCapabilitySchema),
    bindings: z.array(DaemonBindingRefSchema),
  }),
})

export const DaemonReadyMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("daemon.ready"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    selectedVersion: z.literal(PROTOCOL_VERSION),
    bindings: z.array(DaemonBindingRefSchema),
  }),
})

const GitStatusCommandSchema = z.strictObject({
  type: z.literal("git.status"),
})

const BootstrapApplyCommandSchema = z.strictObject({
  type: z.literal("bootstrap.apply"),
  planId: z.uuid(),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  mode: z.enum(["initial", "resume"]),
  plan: BootstrapPlanDocumentSchema,
})

const CommandSchema = z.discriminatedUnion("type", [
  GitStatusCommandSchema,
  BootstrapApplyCommandSchema,
])

export const CommandRequestMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.request"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    requestId: RequestIdSchema,
    projectId: ProjectIdSchema,
    bindingId: BindingIdSchema,
    command: CommandSchema,
  }),
})

const GitStatusCommandResultPayloadSchema = z.strictObject({
  requestId: RequestIdSchema,
  projectId: ProjectIdSchema,
  bindingId: BindingIdSchema,
  commandType: z.literal("git.status"),
  result: GitStatusSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
})

const BootstrapApplyCommandResultPayloadSchema = z.strictObject({
  requestId: RequestIdSchema,
  projectId: ProjectIdSchema,
  bindingId: BindingIdSchema,
  commandType: z.literal("bootstrap.apply"),

  planId: z.uuid(),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),

  verifiedOperationCount: z.number().int().nonnegative(),
  reusedOperationCount: z.number().int().nonnegative(),
  gitInitialized: z.boolean(),

  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
})

const CommandResultPayloadSchema = z.discriminatedUnion("commandType", [
  GitStatusCommandResultPayloadSchema,
  BootstrapApplyCommandResultPayloadSchema,
])

export const CommandResultMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.result"),
  messageId: MessageIdSchema,
  payload: CommandResultPayloadSchema,
})

export const CommandErrorCodeSchema = z.enum([
  "BINDING_NOT_ALLOWED",
  "GIT_NOT_FOUND",
  "NOT_A_GIT_REPOSITORY",
  "COMMAND_TIMEOUT",
  "OUTPUT_LIMIT_EXCEEDED",
  "GIT_STATUS_FAILED",
])

export const BootstrapCommandErrorCodeSchema = z.enum([
  "BINDING_NOT_ALLOWED",
  "ROOT_NOT_FOUND",
  "ROOT_NOT_DIRECTORY",
  "TARGET_NOT_EMPTY",
  "PLAN_HASH_MISMATCH",
  "PLAN_INVALID",
  "PLAN_LIMIT_EXCEEDED",
  "PATH_INVALID",
  "PATH_OUTSIDE_ROOT",
  "LINK_NOT_ALLOWED",
  "ENTRY_CONFLICT",
  "FILE_WRITE_FAILED",
  "GIT_NOT_FOUND",
  "GIT_INIT_FAILED",
  "VERIFICATION_FAILED",
  "BOOTSTRAP_FAILED",
])

const GitStatusCommandErrorPayloadSchema = z.strictObject({
  requestId: RequestIdSchema,
  projectId: ProjectIdSchema,
  bindingId: BindingIdSchema,
  commandType: z.literal("git.status"),
  code: CommandErrorCodeSchema,
  message: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
})

const BootstrapApplyCommandErrorPayloadSchema = z.strictObject({
  requestId: RequestIdSchema,
  projectId: ProjectIdSchema,
  bindingId: BindingIdSchema,
  commandType: z.literal("bootstrap.apply"),

  planId: z.uuid(),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),

  code: BootstrapCommandErrorCodeSchema,
  message: z.string().min(1),

  completedOperationCount: z.number().int().nonnegative(),
  reusedOperationCount: z.number().int().nonnegative(),

  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
})

const CommandErrorPayloadSchema = z.discriminatedUnion("commandType", [
  GitStatusCommandErrorPayloadSchema,
  BootstrapApplyCommandErrorPayloadSchema,
])

export const CommandErrorMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.error"),
  messageId: MessageIdSchema,
  payload: CommandErrorPayloadSchema,
})

export const HeartbeatMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("heartbeat"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    daemonId: DaemonIdSchema,
    timestamp: z.iso.datetime(),
  }),
})

export const HeartbeatAckMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("heartbeat.ack"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    daemonId: DaemonIdSchema,
    timestamp: z.iso.datetime(),
  }),
})

export const DaemonToApiMessageSchema = z.discriminatedUnion("type", [
  DaemonHelloMessageSchema,
  CommandResultMessageSchema,
  CommandErrorMessageSchema,
  HeartbeatMessageSchema,
])

export const ApiToDaemonMessageSchema = z.discriminatedUnion("type", [
  DaemonReadyMessageSchema,
  CommandRequestMessageSchema,
  HeartbeatAckMessageSchema,
])

export type DaemonHelloMessage = z.infer<typeof DaemonHelloMessageSchema>
export type DaemonReadyMessage = z.infer<typeof DaemonReadyMessageSchema>
export type CommandRequestMessage = z.infer<typeof CommandRequestMessageSchema>
export type CommandResultMessage = z.infer<typeof CommandResultMessageSchema>
export type CommandErrorMessage = z.infer<typeof CommandErrorMessageSchema>
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>
export type HeartbeatAckMessage = z.infer<typeof HeartbeatAckMessageSchema>

export type DaemonToApiMessage = z.infer<typeof DaemonToApiMessageSchema>
export type ApiToDaemonMessage = z.infer<typeof ApiToDaemonMessageSchema>
