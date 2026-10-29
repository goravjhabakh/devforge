import { describe, expect, it } from "vitest"

import type { BootstrapPlanDocument } from "@devforge/contracts"

import { applyBootstrapPlan } from "./bootstrap.js"

const projectId = "22222222-2222-4222-8222-222222222222"
const bindingId = "33333333-3333-4333-8333-333333333333"
const planId = "44444444-4444-4444-8444-444444444444"

const plan: BootstrapPlanDocument = {
  schemaVersion: 1,
  projectId,
  bindingId,
  operations: [],
}

describe("applyBootstrapPlan", () => {
  it("returns a safe not-implemented failure", async () => {
    const result = await applyBootstrapPlan({
      canonicalRepositoryRoot: "C:\\very-secret\\repo",
      planId,
      planHash: "a".repeat(64),
      mode: "initial",
      plan,
    })

    expect(result).toEqual({
      ok: false,
      code: "BOOTSTRAP_FAILED",
      message: "Bootstrap execution is not implemented",
      completedOperationCount: 0,
      reusedOperationCount: 0,
    })

    expect(JSON.stringify(result)).not.toContain("C:\\")
  })
})
