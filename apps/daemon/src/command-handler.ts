import type {
  CommandErrorMessage,
  CommandRequestMessage,
  CommandResultMessage,
} from "@devforge/protocol"

import type {
  BootstrapApplyResult,
  applyBootstrapPlan as applyBootstrapPlanFunction,
} from "./bootstrap.js"

import type { BindingRegistry } from "./binding-registry.js"
import type { GitStatusResult, runGitStatus as runGitStatusFunction } from "./git-status.js"

type CommandHandlerDeps = {
  bindingRegistry: BindingRegistry
  runGitStatus: typeof runGitStatusFunction
  applyBootstrapPlan: typeof applyBootstrapPlanFunction
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
  const command = message.payload.command

  let canonicalRepositoryRoot: string

  try {
    const binding = await deps.bindingRegistry.authorizeBinding(
      message.payload.projectId,
      message.payload.bindingId
    )

    canonicalRepositoryRoot = binding.canonicalRepositoryRoot
  } catch {
    const completedAt = nowIso()

    if (command.type === "bootstrap.apply") {
      return {
        type: "command.error",
        payload: {
          requestId: message.payload.requestId,
          projectId: message.payload.projectId,
          bindingId: message.payload.bindingId,
          commandType: "bootstrap.apply",
          planId: command.planId,
          planHash: command.planHash,
          code: "BINDING_NOT_ALLOWED",
          message: "Binding is not allowed",
          completedOperationCount: 0,
          reusedOperationCount: 0,
          startedAt,
          completedAt,
        },
      }
    }

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
        completedAt,
      },
    }
  }

  if (command.type === "bootstrap.apply") {
    const result: BootstrapApplyResult = await deps.applyBootstrapPlan({
      canonicalRepositoryRoot,
      planId: command.planId,
      planHash: command.planHash,
      mode: command.mode,
      plan: command.plan,
    })

    const completedAt = nowIso()

    if (!result.ok) {
      return {
        type: "command.error",
        payload: {
          requestId: message.payload.requestId,
          projectId: message.payload.projectId,
          bindingId: message.payload.bindingId,
          commandType: "bootstrap.apply",
          planId: command.planId,
          planHash: command.planHash,
          code: result.code,
          message: result.message,
          completedOperationCount: result.completedOperationCount,
          reusedOperationCount: result.reusedOperationCount,
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
        commandType: "bootstrap.apply",
        planId: command.planId,
        planHash: command.planHash,
        verifiedOperationCount: result.verifiedOperationCount,
        reusedOperationCount: result.reusedOperationCount,
        gitInitialized: result.gitInitialized,
        startedAt,
        completedAt,
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
