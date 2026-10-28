import { describe, expect, it } from "vitest"

import {
  ApiToDaemonMessageSchema,
  CommandErrorMessageSchema,
  CommandRequestMessageSchema,
  CommandResultMessageSchema,
  DaemonHelloMessageSchema,
  DaemonToApiMessageSchema,
} from "./messages.js"

const messageId = "11111111-1111-4111-8111-111111111111"
const requestId = "22222222-2222-4222-8222-222222222222"
const daemonId = "33333333-3333-4333-8333-333333333333"
const projectId = "44444444-4444-4444-8444-444444444444"
const bindingId = "55555555-5555-4555-8555-555555555555"

describe("daemon protocol messages", () => {
  it("accepts a valid daemon.hello message", () => {
    const value = {
      version: 1,
      type: "daemon.hello",
      messageId,
      payload: {
        daemonId,
        supportedVersions: [1],
        capabilities: ["git.status"],
        bindings: [
          {
            projectId,
            bindingId,
          },
          {
            projectId: "66666666-6666-4666-8666-666666666666",
            bindingId: "77777777-7777-4777-8777-777777777777",
          },
        ],
      },
    }

    expect(DaemonHelloMessageSchema.safeParse(value).success).toBe(true)
  })

  it("accepts a valid command.request", () => {
    const value = {
      version: 1,
      type: "command.request",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        command: {
          type: "git.status",
        },
      },
    }

    expect(CommandRequestMessageSchema.safeParse(value).success).toBe(true)
    expect(ApiToDaemonMessageSchema.safeParse(value).success).toBe(true)
  })

  it("rejects an arbitrary command type", () => {
    const value = {
      version: 1,
      type: "command.request",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        command: {
          type: "shell.execute",
        },
      },
    }

    expect(CommandRequestMessageSchema.safeParse(value).success).toBe(false)
  })

  it("rejects extra execution fields", () => {
    const value = {
      version: 1,
      type: "command.request",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        command: {
          type: "git.status",
          executable: "git",
        },
      },
    }

    expect(CommandRequestMessageSchema.safeParse(value).success).toBe(false)
  })

  it("rejects repository paths in command requests", () => {
    const value = {
      version: 1,
      type: "command.request",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        repositoryRoot: "C:\\development\\secret-project",
        command: {
          type: "git.status",
        },
      },
    }

    expect(CommandRequestMessageSchema.safeParse(value).success).toBe(false)
  })

  it("rejects an unknown protocol version", () => {
    const value = {
      version: 2,
      type: "command.request",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        command: {
          type: "git.status",
        },
      },
    }

    expect(ApiToDaemonMessageSchema.safeParse(value).success).toBe(false)
  })

  it("rejects an unknown message type", () => {
    const value = {
      version: 1,
      type: "command.cancel",
      messageId,
      payload: {
        requestId,
      },
    }

    expect(ApiToDaemonMessageSchema.safeParse(value).success).toBe(false)
    expect(DaemonToApiMessageSchema.safeParse(value).success).toBe(false)
  })

  it("rejects malformed command results", () => {
    const value = {
      version: 1,
      type: "command.result",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        commandType: "git.status",
        result: {
          branch: {
            head: "main",
            detached: false,
          },
          staged: 0,
          unstaged: 0,
          untracked: "3",
          conflicted: 0,
          clean: false,
        },
        startedAt: "2026-10-29T12:00:00.000Z",
        completedAt: "2026-10-29T12:00:01.000Z",
      },
    }

    expect(CommandResultMessageSchema.safeParse(value).success).toBe(false)
  })

  it("rejects invalid command error codes", () => {
    const value = {
      version: 1,
      type: "command.error",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        commandType: "git.status",
        code: "RAW_PROCESS_ERROR",
        message: "something failed",
        startedAt: "2026-10-29T12:00:00.000Z",
        completedAt: "2026-10-29T12:00:01.000Z",
      },
    }

    expect(CommandErrorMessageSchema.safeParse(value).success).toBe(false)
  })

  it("rejects API-to-daemon messages in the daemon-to-API union", () => {
    const value = {
      version: 1,
      type: "command.request",
      messageId,
      payload: {
        requestId,
        projectId,
        bindingId,
        command: {
          type: "git.status",
        },
      },
    }

    expect(DaemonToApiMessageSchema.safeParse(value).success).toBe(false)
  })
})
