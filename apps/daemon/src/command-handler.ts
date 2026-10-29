import type {
  CommandErrorMessage,
  CommandRequestMessage,
  CommandResultMessage,
} from "@devforge/protocol"

import type { BindingRegistry } from "./binding-registry.js"
import type { GitStatusResult, runGitStatus as runGitStatusFunction } from "./git-status.js"

type CommandHandlerDeps = {
  bindingRegistry: BindingRegistry
  runGitStatus: typeof runGitStatusFunction
}

export type CommandHandlerResult =
  | {
      type: "command.result"
      payload: CommandResultMessage["payload"]
    }
  | {
      type: "command.error"
      payload: CommandErrorMessage["payload"]
    }

function nowIso() {
  return new Date().toISOString()
}

export async function handleCommandRequest(
  message: CommandRequestMessage,
  deps: CommandHandlerDeps
): Promise<CommandHandlerResult> {
  const startedAt = nowIso()

  if (message.payload.command.type !== "git.status") {
    return {
      type: "command.error",
      payload: {
        requestId: message.payload.requestId,
        projectId: message.payload.projectId,
        bindingId: message.payload.bindingId,
        commandType: "git.status",
        code: "GIT_STATUS_FAILED",
        message: "Git status failed",
        startedAt,
        completedAt: nowIso(),
      },
    }
  }

  let canonicalRepositoryRoot: string

  try {
    const binding = await deps.bindingRegistry.authorizeBinding(
      message.payload.projectId,
      message.payload.bindingId
    )

    canonicalRepositoryRoot = binding.canonicalRepositoryRoot
  } catch {
    return {
      type: "command.error",
      payload: {
        requestId: message.payload.requestId,
        projectId: message.payload.projectId,
        bindingId: message.payload.bindingId,
        commandType: "git.status",
        code: "BINDING_NOT_ALLOWED",
        message: "Binding is not allowed",
        startedAt,
        completedAt: nowIso(),
      },
    }
  }

  const result: GitStatusResult = await deps.runGitStatus(canonicalRepositoryRoot)

  const completedAt = nowIso()

  if (!result.ok) {
    return {
      type: "command.error",
      payload: {
        requestId: message.payload.requestId,
        projectId: message.payload.projectId,
        bindingId: message.payload.bindingId,
        commandType: "git.status",
        code: result.code,
        message: result.message,
        startedAt,
        completedAt,
      },
    }
  }

  return {
    type: "command.result",
    payload: {
      requestId: message.payload.requestId,
      projectId: message.payload.projectId,
      bindingId: message.payload.bindingId,
      commandType: "git.status",
      result: result.status,
      startedAt,
      completedAt,
    },
  }
}
