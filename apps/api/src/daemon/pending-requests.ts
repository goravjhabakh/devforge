import type { CommandErrorMessage, CommandResultMessage } from "@devforge/protocol"

export type PendingResolution = "resolved" | "unknown" | "mismatch"

export type PendingRequestOutcome =
  | {
      type: "result"
      payload: CommandResultMessage["payload"]
    }
  | {
      type: "error"
      payload: CommandErrorMessage["payload"]
    }
  | {
      type: "timeout"
    }
  | {
      type: "daemon_disconnected"
    }

type PendingCommandType = "git.status" | "bootstrap.apply"

type PendingRequest = {
  requestId: string
  projectId: string
  daemonId: string
  bindingId: string
  commandType: PendingCommandType
  resolve: (outcome: PendingRequestOutcome) => void
  timeout: ReturnType<typeof setTimeout>
}

export class PendingRequestManager {
  private readonly requests = new Map<string, PendingRequest>()

  create(input: {
    requestId: string
    projectId: string
    daemonId: string
    bindingId: string
    commandType: PendingCommandType
    timeoutMs: number
  }): Promise<PendingRequestOutcome> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const pending = this.requests.get(input.requestId)

        if (!pending) {
          return
        }

        this.requests.delete(input.requestId)

        resolve({
          type: "timeout",
        })
      }, input.timeoutMs)

      this.requests.set(input.requestId, {
        requestId: input.requestId,
        projectId: input.projectId,
        daemonId: input.daemonId,
        bindingId: input.bindingId,
        commandType: input.commandType,
        resolve,
        timeout,
      })
    })
  }

  resolveResult(daemonId: string, payload: CommandResultMessage["payload"]): PendingResolution {
    const pending = this.requests.get(payload.requestId)

    if (!pending) {
      return "unknown"
    }

    if (
      pending.daemonId !== daemonId ||
      pending.projectId !== payload.projectId ||
      pending.bindingId !== payload.bindingId ||
      pending.commandType !== payload.commandType
    ) {
      return "mismatch"
    }

    clearTimeout(pending.timeout)
    this.requests.delete(payload.requestId)

    pending.resolve({
      type: "result",
      payload,
    })

    return "resolved"
  }

  resolveError(daemonId: string, payload: CommandErrorMessage["payload"]): PendingResolution {
    const pending = this.requests.get(payload.requestId)

    if (!pending) {
      return "unknown"
    }

    if (
      pending.daemonId !== daemonId ||
      pending.projectId !== payload.projectId ||
      pending.bindingId !== payload.bindingId ||
      pending.commandType !== payload.commandType
    ) {
      return "mismatch"
    }

    clearTimeout(pending.timeout)
    this.requests.delete(payload.requestId)

    pending.resolve({
      type: "error",
      payload,
    })

    return "resolved"
  }

  remove(requestId: string): boolean {
    const pending = this.requests.get(requestId)

    if (!pending) {
      return false
    }

    clearTimeout(pending.timeout)

    return this.requests.delete(requestId)
  }

  failForDaemon(daemonId: string): void {
    for (const [requestId, pending] of this.requests) {
      if (pending.daemonId !== daemonId) {
        continue
      }

      clearTimeout(pending.timeout)
      this.requests.delete(requestId)

      pending.resolve({
        type: "daemon_disconnected",
      })
    }
  }

  hasProjectInFlight(projectId: string): boolean {
    for (const pending of this.requests.values()) {
      if (pending.projectId === projectId) {
        return true
      }
    }

    return false
  }
}
