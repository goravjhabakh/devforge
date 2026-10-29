import { describe, expect, it } from "vitest"
import { ActivityEventSchema, BootstrapRequestedActivitySchema } from "./activity.js"

const id = "11111111-1111-4111-8111-111111111111"
const projectId = "22222222-2222-4222-8222-222222222222"
const daemonId = "33333333-3333-4333-8333-333333333333"
const requestId = "44444444-4444-4444-8444-444444444444"
const createdAt = "2026-10-29T12:00:00.000Z"

const validStatus = {
  branch: {
    head: "main",
    detached: false,
  },
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  clean: true,
}

describe("ActivityEventSchema", () => {
  it("accepts a valid requested event", () => {
    const value = {
      id,
      projectId,
      daemonId,
      requestId,
      type: "git.status.requested",
      payload: {},
      createdAt,
    }

    expect(ActivityEventSchema.safeParse(value).success).toBe(true)
  })

  it("accepts a valid succeeded event", () => {
    const value = {
      id,
      projectId,
      daemonId,
      requestId,
      type: "git.status.succeeded",
      payload: {
        status: validStatus,
      },
      createdAt,
    }

    expect(ActivityEventSchema.safeParse(value).success).toBe(true)
  })

  it("accepts a valid failed event", () => {
    const value = {
      id,
      projectId,
      daemonId: null,
      requestId,
      type: "git.status.failed",
      payload: {
        code: "DAEMON_DISCONNECTED",
        message: "Daemon is disconnected",
      },
      createdAt,
    }

    expect(ActivityEventSchema.safeParse(value).success).toBe(true)
  })

  it("rejects a succeeded event with malformed Git status", () => {
    const value = {
      id,
      projectId,
      daemonId,
      requestId,
      type: "git.status.succeeded",
      payload: {
        status: {
          ...validStatus,
          untracked: "3",
        },
      },
      createdAt,
    }

    expect(ActivityEventSchema.safeParse(value).success).toBe(false)
  })

  it("rejects an unknown event type", () => {
    const value = {
      id,
      projectId,
      daemonId,
      requestId,
      type: "git.status.cancelled",
      payload: {},
      createdAt,
    }

    expect(ActivityEventSchema.safeParse(value).success).toBe(false)
  })

  it("rejects unsafe extra fields", () => {
    const value = {
      id,
      projectId,
      daemonId,
      requestId,
      type: "git.status.requested",
      payload: {
        repositoryRoot: "C:\\development\\secret-project",
      },
      createdAt,
    }

    expect(ActivityEventSchema.safeParse(value).success).toBe(false)
  })

  it("rejects local roots in bootstrap activity", () => {
    const result = BootstrapRequestedActivitySchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      daemonId: null,
      requestId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-10-29T12:00:00.000Z",
      type: "bootstrap.requested",
      payload: {
        planId: "44444444-4444-4444-8444-444444444444",
        planHash: "a".repeat(64),
        attempt: 1,
        mode: "initial",
        repositoryRoot: "C:\\secret",
      },
    })

    expect(result.success).toBe(false)
  })
})
