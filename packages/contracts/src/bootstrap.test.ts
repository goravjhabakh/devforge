import { describe, expect, it } from "vitest"
import {
  BootstrapPlanDocumentSchema,
  hashBootstrapPlan,
  serializeBootstrapPlan,
  validateBootstrapPlan,
  isValidBootstrapPath,
} from "./bootstrap.js"
import type { BootstrapPlanDocument } from "./bootstrap.js"

describe("BootstrapPlanDocumentSchema", () => {
  it("accepts a valid bootstrap plan", () => {
    const result = BootstrapPlanDocumentSchema.safeParse({
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [
        {
          type: "directory.create",
          path: "docs",
        },
        {
          type: "file.write",
          path: "README.md",
          encoding: "utf8",
          content: "# Example\n",
          contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: 10,
        },
        {
          type: "git.init",
          initialBranch: "main",
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it("rejects unexpected operation fields", () => {
    const result = BootstrapPlanDocumentSchema.safeParse({
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [
        {
          type: "git.init",
          initialBranch: "main",
          command: "rm -rf something",
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it("serializes object keys canonically", () => {
    const first = {
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [],
    } satisfies BootstrapPlanDocument

    const second = {
      operations: [],
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      schemaVersion: 1,
    } satisfies BootstrapPlanDocument

    expect(serializeBootstrapPlan(first)).toBe(serializeBootstrapPlan(second))
  })

  it("produces the same hash regardless of object key insertion order", async () => {
    const first = {
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [],
    } satisfies BootstrapPlanDocument

    const second = {
      operations: [],
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      schemaVersion: 1,
    } satisfies BootstrapPlanDocument

    expect(await hashBootstrapPlan(first)).toBe(await hashBootstrapPlan(second))
  })

  it("preserves operation order when hashing", async () => {
    const base = {
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
    } satisfies Omit<BootstrapPlanDocument, "operations">

    const first = {
      ...base,
      operations: [
        { type: "directory.create", path: "docs" },
        { type: "directory.create", path: "docs/specs" },
      ],
    } satisfies BootstrapPlanDocument

    const second = {
      ...base,
      operations: [...first.operations].reverse(),
    } satisfies BootstrapPlanDocument

    expect(await hashBootstrapPlan(first)).not.toBe(await hashBootstrapPlan(second))
  })

  it("accepts a semantically valid plan", async () => {
    const content = "# Example\n"
    const bytes = new TextEncoder().encode(content)

    const contentSha256 = await crypto.subtle.digest("SHA-256", bytes)
    const hash = Array.from(new Uint8Array(contentSha256))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")

    const result = await validateBootstrapPlan({
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [
        {
          type: "file.write",
          path: "README.md",
          encoding: "utf8",
          content,
          contentSha256: hash,
          sizeBytes: bytes.byteLength,
        },
      ],
    })

    expect(result).toEqual({ success: true })
  })

  it("rejects mismatched file sizes", async () => {
    const result = await validateBootstrapPlan({
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [
        {
          type: "file.write",
          path: "README.md",
          encoding: "utf8",
          content: "hello",
          contentSha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          sizeBytes: 999,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it("rejects git init when it is not last", async () => {
    const result = await validateBootstrapPlan({
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [
        {
          type: "git.init",
          initialBranch: "main",
        },
        {
          type: "directory.create",
          path: "docs",
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it("rejects case-insensitive path collisions", async () => {
    const result = await validateBootstrapPlan({
      schemaVersion: 1,
      projectId: "123e4567-e89b-42d3-a456-426614174000",
      bindingId: "123e4567-e89b-42d3-a456-426614174001",
      operations: [
        {
          type: "directory.create",
          path: "docs",
        },
        {
          type: "directory.create",
          path: "DOCS",
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it.each([
    "",
    ".",
    "..",
    "../README.md",
    "./README.md",
    "/README.md",
    "C:/temp/file.txt",
    "\\\\server\\share",
    "docs\\README.md",
    "docs//README.md",
    "docs/../README.md",
    "docs/file.",
    "docs/file ",
    "CON",
    "CON.txt",
    "docs/NUL.md",
    "COM1.log",
  ])("rejects invalid bootstrap path %s", (path) => {
    expect(isValidBootstrapPath(path)).toBe(false)
  })

  it.each([
    "README.md",
    "AGENTS.md",
    "docs",
    "docs/project.md",
    "docs/specs",
    "docs/specs/README.md",
  ])("accepts portable bootstrap path %s", (path) => {
    expect(isValidBootstrapPath(path)).toBe(true)
  })
})
