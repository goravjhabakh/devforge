import { describe, expect, it } from "vitest"

import { parseGitStatus } from "./git-status.js"

describe("parseGitStatus", () => {
  it("parses a clean branch", () => {
    const status = parseGitStatus(
      ["# branch.oid 0123456789abcdef", "# branch.head main", ""].join("\n")
    )

    expect(status).toEqual({
      branch: {
        head: "main",
        detached: false,
      },
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      clean: true,
    })
  })

  it("counts a staged file", () => {
    const status = parseGitStatus(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head main",
        "1 M. N... 100644 100644 100644 abcdef abcdef staged.txt",
      ].join("\n")
    )

    expect(status.staged).toBe(1)
    expect(status.unstaged).toBe(0)
    expect(status.clean).toBe(false)
  })

  it("counts an unstaged file", () => {
    const status = parseGitStatus(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head main",
        "1 .M N... 100644 100644 100644 abcdef abcdef unstaged.txt",
      ].join("\n")
    )

    expect(status.staged).toBe(0)
    expect(status.unstaged).toBe(1)
    expect(status.clean).toBe(false)
  })

  it("counts staged and unstaged state for the same file", () => {
    const status = parseGitStatus(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head main",
        "1 MM N... 100644 100644 100644 abcdef abcdef both.txt",
      ].join("\n")
    )

    expect(status.staged).toBe(1)
    expect(status.unstaged).toBe(1)
    expect(status.clean).toBe(false)
  })

  it("counts renamed entries using their XY state", () => {
    const status = parseGitStatus(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head main",
        "2 R. N... 100644 100644 100644 abcdef abcdef R100 renamed.txt",
      ].join("\n")
    )

    expect(status.staged).toBe(1)
    expect(status.unstaged).toBe(0)
  })

  it("counts untracked files without exposing filenames", () => {
    const filename = "secret-file.txt"

    const status = parseGitStatus(
      ["# branch.oid 0123456789abcdef", "# branch.head main", `? ${filename}`].join("\n")
    )

    expect(status.untracked).toBe(1)
    expect(status.clean).toBe(false)

    expect(JSON.stringify(status)).not.toContain(filename)
  })

  it("counts conflicts separately", () => {
    const status = parseGitStatus(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head main",
        "u UU N... 100644 100644 100644 100644 abc abc abc conflict.txt",
      ].join("\n")
    )

    expect(status.conflicted).toBe(1)
    expect(status.staged).toBe(0)
    expect(status.unstaged).toBe(0)
    expect(status.clean).toBe(false)
  })

  it("parses upstream ahead and behind metadata", () => {
    const status = parseGitStatus(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -3",
      ].join("\n")
    )

    expect(status.branch).toEqual({
      head: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 2,
      behind: 3,
    })
  })

  it("parses detached HEAD", () => {
    const status = parseGitStatus(
      ["# branch.oid 0123456789abcdef", "# branch.head (detached)"].join("\n")
    )

    expect(status.branch).toEqual({
      head: null,
      detached: true,
    })
  })

  it("leaves ahead and behind absent when branch.ab is absent", () => {
    const status = parseGitStatus(
      ["# branch.oid 0123456789abcdef", "# branch.head main", "# branch.upstream origin/main"].join(
        "\n"
      )
    )

    expect(status.branch.upstream).toBe("origin/main")
    expect(status.branch).not.toHaveProperty("ahead")
    expect(status.branch).not.toHaveProperty("behind")
  })

  it("rejects unknown porcelain records", () => {
    expect(() =>
      parseGitStatus(
        ["# branch.oid 0123456789abcdef", "# branch.head main", "x unknown-record"].join("\n")
      )
    ).toThrow("Unsupported Git status output")
  })

  it("rejects malformed branch divergence metadata", () => {
    expect(() =>
      parseGitStatus(
        [
          "# branch.oid 0123456789abcdef",
          "# branch.head main",
          "# branch.ab something-we-do-not-understand",
        ].join("\n")
      )
    ).toThrow("Unsupported Git status output")
  })

  it("rejects unknown porcelain headers", () => {
    expect(() =>
      parseGitStatus(
        [
          "# branch.oid 0123456789abcdef",
          "# branch.head main",
          "# something.future-format value",
        ].join("\n")
      )
    ).toThrow("Unsupported Git status output")
  })
})
