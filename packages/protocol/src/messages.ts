import { z } from "zod"
import { GitStatusSchema } from "./git-status.js"

export const PROTOCOL_VERSION = 1 as const

const MessageIdSchema = z.uuid()
const RequestIdSchema = z.uuid()
const ProjectIdSchema = z.uuid()
const BindingIdSchema = z.uuid()
const DaemonIdSchema = z.uuid()

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
    capabilities: z.array(z.literal("git.status")),
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

export const CommandRequestMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.request"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    requestId: RequestIdSchema,
    projectId: ProjectIdSchema,
    bindingId: BindingIdSchema,
    command: z.strictObject({
      type: z.literal("git.status"),
    }),
  }),
})

export const CommandResultMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.result"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    requestId: RequestIdSchema,
    projectId: ProjectIdSchema,
    bindingId: BindingIdSchema,
    commandType: z.literal("git.status"),
    result: GitStatusSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  }),
})

export const CommandErrorCodeSchema = z.enum([
  "BINDING_NOT_ALLOWED",
  "GIT_NOT_FOUND",
  "NOT_A_GIT_REPOSITORY",
  "COMMAND_TIMEOUT",
  "OUTPUT_LIMIT_EXCEEDED",
  "GIT_STATUS_FAILED",
])

export const CommandErrorMessageSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.error"),
  messageId: MessageIdSchema,
  payload: z.strictObject({
    requestId: RequestIdSchema,
    projectId: ProjectIdSchema,
    bindingId: BindingIdSchema,
    commandType: z.literal("git.status"),
    code: CommandErrorCodeSchema,
    message: z.string().min(1),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  }),
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
