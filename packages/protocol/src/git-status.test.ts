import { describe, expect, it } from "vitest"
import { GitStatusSchema } from "./git-status.js"

describe("GitStatusSchema", () => {
  it("accepts a valid clean status", () => {
    const value = {
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

    expect(GitStatusSchema.safeParse(value).success).toBe(true)
  })

  it("accepts a valid branch state with upstream divergence", () => {
    const value = {
      branch: {
        head: "main",
        detached: false,
        upstream: "origin/main",
        ahead: 2,
        behind: 1,
      },
      staged: 1,
      unstaged: 2,
      untracked: 3,
      conflicted: 0,
      clean: false,
    }

    expect(GitStatusSchema.safeParse(value).success).toBe(true)
  })

  it("accepts a detached branch", () => {
    const value = {
      branch: {
        head: null,
        detached: true,
      },
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      clean: true,
    }

    expect(GitStatusSchema.safeParse(value).success).toBe(true)
  })

  it("rejects negative counts", () => {
    const value = {
      branch: {
        head: "main",
        detached: false,
      },
      staged: 0,
      unstaged: -1,
      untracked: 0,
      conflicted: 0,
      clean: false,
    }

    expect(GitStatusSchema.safeParse(value).success).toBe(false)
  })

  it("rejects fractional counts", () => {
    const value = {
      branch: {
        head: "main",
        detached: false,
      },
      staged: 1.5,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      clean: false,
    }

    expect(GitStatusSchema.safeParse(value).success).toBe(false)
  })

  it("rejects string counts instead of coercing them", () => {
    const value = {
      branch: {
        head: "main",
        detached: false,
      },
      staged: 0,
      unstaged: 0,
      untracked: "3",
      conflicted: 0,
      clean: false,
    }

    expect(GitStatusSchema.safeParse(value).success).toBe(false)
  })
})
