import { spawn } from "node:child_process"

import { GitStatusSchema } from "@devforge/protocol"
import type { GitStatus } from "@devforge/protocol"

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

type GitStatusOptions = {
  timeoutMs?: number
  maxOutputBytes?: number
}

export type GitStatusErrorCode =
  | "GIT_NOT_FOUND"
  | "NOT_A_GIT_REPOSITORY"
  | "COMMAND_TIMEOUT"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "GIT_STATUS_FAILED"

export type GitStatusResult =
  | {
      ok: true
      status: GitStatus
    }
  | {
      ok: false
      code: GitStatusErrorCode
      message: string
    }

class GitStatusParseError extends Error {
  constructor() {
    super("Unsupported Git status output")
    this.name = "GitStatusParseError"
  }
}

function gitStatusFailure(code: GitStatusErrorCode, message: string): GitStatusResult {
  return {
    ok: false,
    code,
    message,
  }
}

function mapSpawnError(error: NodeJS.ErrnoException): GitStatusResult {
  if (error.code === "ENOENT") {
    return gitStatusFailure("GIT_NOT_FOUND", "Git executable was not found")
  }

  return gitStatusFailure("GIT_STATUS_FAILED", "Git status failed")
}

export function parseGitStatus(output: string): GitStatus {
  let head: string | null = null
  let detached = false
  let upstream: string | undefined
  let ahead: number | undefined
  let behind: number | undefined

  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflicted = 0

  const lines = output.split(/\r?\n/)

  for (const line of lines) {
    if (!line) {
      continue
    }

    if (line.startsWith("# ")) {
      if (line.startsWith("# branch.oid ")) {
        continue
      }

      if (line.startsWith("# branch.head ")) {
        const value = line.slice("# branch.head ".length)

        if (value === "(detached)") {
          head = null
          detached = true
        } else {
          head = value
          detached = false
        }

        continue
      }

      if (line.startsWith("# branch.upstream ")) {
        upstream = line.slice("# branch.upstream ".length)
        continue
      }

      if (line.startsWith("# branch.ab ")) {
        const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)

        if (!match) {
          throw new GitStatusParseError()
        }

        const [, aheadValue, behindValue] = match

        if (aheadValue === undefined || behindValue === undefined) {
          throw new GitStatusParseError()
        }

        ahead = Number.parseInt(aheadValue, 10)
        behind = Number.parseInt(behindValue, 10)
        continue
      }

      throw new GitStatusParseError()
    }

    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.slice(2, 4)

      const indexStatus = xy[0]
      const worktreeStatus = xy[1]

      if (xy.length !== 2 || indexStatus === undefined || worktreeStatus === undefined) {
        throw new GitStatusParseError()
      }

      if (indexStatus !== ".") {
        staged += 1
      }

      if (worktreeStatus !== ".") {
        unstaged += 1
      }

      continue
    }

    if (line.startsWith("u ")) {
      conflicted += 1
      continue
    }

    if (line.startsWith("? ")) {
      untracked += 1
      continue
    }

    if (line.startsWith("! ")) {
      continue
    }

    throw new GitStatusParseError()
  }

  return GitStatusSchema.parse({
    branch: {
      head,
      detached,
      ...(upstream !== undefined ? { upstream } : {}),
      ...(ahead !== undefined ? { ahead } : {}),
      ...(behind !== undefined ? { behind } : {}),
    },
    staged,
    unstaged,
    untracked,
    conflicted,
    clean: staged === 0 && unstaged === 0 && untracked === 0 && conflicted === 0,
  })
}

export async function runGitStatus(
  repositoryRoot: string,
  options: GitStatusOptions = {}
): Promise<GitStatusResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

  return await new Promise<GitStatusResult>((resolve) => {
    const child = spawn(
      "git",
      ["-C", repositoryRoot, "status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
      {
        shell: false,
        windowsHide: true,
      }
    )

    let stdoutChunks: Buffer[] = []
    let stderrChunks: Buffer[] = []

    let stdoutBytes = 0
    let stderrBytes = 0

    let settled = false
    let timedOut = false
    let outputLimitExceeded = false

    function finish(result: GitStatusResult) {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || outputLimitExceeded) {
        return
      }

      stdoutBytes += chunk.length

      if (stdoutBytes > maxOutputBytes) {
        outputLimitExceeded = true
        stdoutChunks = []
        child.kill()
        return
      }

      stdoutChunks.push(chunk)
    })

    child.stderr.on("data", (chunk: Buffer) => {
      if (settled || outputLimitExceeded) {
        return
      }

      stderrBytes += chunk.length

      if (stderrBytes > maxOutputBytes) {
        outputLimitExceeded = true
        stderrChunks = []
        child.kill()
        return
      }

      stderrChunks.push(chunk)
    })

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(mapSpawnError(error))
    })

    child.on("close", (code) => {
      if (settled) {
        return
      }

      if (timedOut) {
        finish(gitStatusFailure("COMMAND_TIMEOUT", "Git status command timed out"))

        return
      }

      if (outputLimitExceeded) {
        finish(
          gitStatusFailure("OUTPUT_LIMIT_EXCEEDED", "Git status output exceeded the allowed limit")
        )

        return
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf8")
      const stderr = Buffer.concat(stderrChunks).toString("utf8")

      stdoutChunks = []
      stderrChunks = []

      if (code !== 0) {
        if (stderr.toLowerCase().includes("not a git repository")) {
          finish(gitStatusFailure("NOT_A_GIT_REPOSITORY", "Repository is not a Git working tree"))

          return
        }

        finish(gitStatusFailure("GIT_STATUS_FAILED", "Git status failed"))

        return
      }

      try {
        finish({
          ok: true,
          status: parseGitStatus(stdout),
        })
      } catch {
        finish(gitStatusFailure("GIT_STATUS_FAILED", "Git status failed"))
      }
    })
  })
}
