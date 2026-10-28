import { describe, expect, it } from "vitest"
import { ApiErrorSchema, GitStatusResponseSchema, ProjectDetailSchema } from "./projects.js"

const projectId = "11111111-1111-4111-8111-111111111111"
const daemonId = "22222222-2222-4222-8222-222222222222"
const requestId = "33333333-3333-4333-8333-333333333333"

const validStatus = {
  branch: {
    head: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
  },
  staged: 0,
  unstaged: 1,
  untracked: 0,
  conflicted: 0,
  clean: false,
}

describe("ProjectDetailSchema", () => {
  it("accepts a valid project detail", () => {
    const value = {
      project: {
        id: projectId,
        name: "DevForge",
      },
      daemon: {
        id: daemonId,
        connected: true,
        lastSeenAt: "2026-10-29T12:00:00.000Z",
      },
      binding: {
        available: true,
      },
      latestStatus: {
        status: validStatus,
        completedAt: "2026-10-29T12:00:01.000Z",
      },
      activity: [],
    }

    expect(ProjectDetailSchema.safeParse(value).success).toBe(true)
  })

  it("accepts a disconnected daemon state", () => {
    const value = {
      project: {
        id: projectId,
        name: "DevForge",
      },
      daemon: {
        id: daemonId,
        connected: false,
        lastSeenAt: null,
      },
      binding: {
        available: false,
      },
      latestStatus: null,
      activity: [],
    }

    expect(ProjectDetailSchema.safeParse(value).success).toBe(true)
  })

  it("accepts latestStatus as null", () => {
    const value = {
      project: {
        id: projectId,
        name: "DevForge",
      },
      daemon: {
        id: daemonId,
        connected: true,
        lastSeenAt: "2026-10-29T12:00:00.000Z",
      },
      binding: {
        available: true,
      },
      latestStatus: null,
      activity: [],
    }

    expect(ProjectDetailSchema.safeParse(value).success).toBe(true)
  })

  it("rejects repository and local path fields", () => {
    const value = {
      project: {
        id: projectId,
        name: "DevForge",
      },
      daemon: {
        id: daemonId,
        connected: true,
        lastSeenAt: null,
      },
      binding: {
        available: true,
        repositoryRoot: "C:\\development\\secret-project",
      },
      latestStatus: null,
      activity: [],
    }

    expect(ProjectDetailSchema.safeParse(value).success).toBe(false)
  })
})

describe("GitStatusResponseSchema", () => {
  it("accepts a valid Git status response", () => {
    const value = {
      requestId,
      status: validStatus,
      completedAt: "2026-10-29T12:00:01.000Z",
    }

    expect(GitStatusResponseSchema.safeParse(value).success).toBe(true)
  })
})

describe("ApiErrorSchema", () => {
  it("accepts a valid API error", () => {
    const value = {
      code: "DAEMON_DISCONNECTED",
      message: "Daemon is disconnected",
    }

    expect(ApiErrorSchema.safeParse(value).success).toBe(true)
  })

  it("rejects an unknown API error code", () => {
    const value = {
      code: "RAW_PROCESS_ERROR",
      message: "Something failed",
    }

    expect(ApiErrorSchema.safeParse(value).success).toBe(false)
  })
})
