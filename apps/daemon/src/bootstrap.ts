import type { BootstrapFailureCode, BootstrapPlanDocument } from "@devforge/contracts"

export type BootstrapApplyInput = {
  canonicalRepositoryRoot: string
  planId: string
  planHash: string
  mode: "initial" | "resume"
  plan: BootstrapPlanDocument
}

export type BootstrapApplyResult =
  | {
      ok: true
      verifiedOperationCount: number
      reusedOperationCount: number
      gitInitialized: boolean
    }
  | {
      ok: false
      code: BootstrapFailureCode
      message: string
      completedOperationCount: number
      reusedOperationCount: number
    }

export async function applyBootstrapPlan(
  _input: BootstrapApplyInput
): Promise<BootstrapApplyResult> {
  return {
    ok: false,
    code: "BOOTSTRAP_FAILED",
    message: "Bootstrap execution is not implemented",
    completedOperationCount: 0,
    reusedOperationCount: 0,
  }
}
