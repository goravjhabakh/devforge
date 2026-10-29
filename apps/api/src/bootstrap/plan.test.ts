import { describe, expect, it } from "vitest"

import { createBootstrapPlan } from "./plan.js"

const projectId = "11111111-1111-4111-8111-111111111111"
const bindingId = "22222222-2222-4222-8222-222222222222"

describe("createBootstrapPlan", () => {
  it("creates the same plan and hash for the same input", async () => {
    const input = {
      projectId,
      bindingId,
      projectName: "Example Project",
      initializeGit: true,
    }

    const first = await createBootstrapPlan(input)
    const second = await createBootstrapPlan(input)

    expect(first).toEqual(second)
  })

  it("places git.init last when requested", async () => {
    const result = await createBootstrapPlan({
      projectId,
      bindingId,
      projectName: "Example Project",
      initializeGit: true,
    })

    expect(result.document.operations.at(-1)).toEqual({
      type: "git.init",
      initialBranch: "main",
    })
  })

  it("omits git.init when disabled", async () => {
    const result = await createBootstrapPlan({
      projectId,
      bindingId,
      projectName: "Example Project",
      initializeGit: false,
    })

    expect(result.document.operations.some((operation) => operation.type === "git.init")).toBe(
      false
    )
  })

  it("includes exact file sizes and content hashes", async () => {
    const result = await createBootstrapPlan({
      projectId,
      bindingId,
      projectName: "Example Project",
      initializeGit: false,
    })

    const fileOperations = result.document.operations.filter(
      (operation) => operation.type === "file.write"
    )

    expect(fileOperations.length).toBeGreaterThan(0)

    for (const operation of fileOperations) {
      expect(operation.sizeBytes).toBe(new TextEncoder().encode(operation.content).byteLength)

      expect(operation.contentSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
