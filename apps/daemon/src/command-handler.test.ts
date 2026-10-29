import { describe, expect, it, vi } from "vitest"

import type { CommandRequestMessage } from "@devforge/protocol"

import { handleCommandRequest } from "./command-handler.js"

const projectId = "22222222-2222-4222-8222-222222222222"
const bindingId = "33333333-3333-4333-8333-333333333333"
const requestId = "66666666-6666-4666-8666-666666666666"

const repositoryRoot = "C:\\very-secret\\repo"

const request: CommandRequestMessage = {
  version: 1,
  type: "command.request",
  messageId: "77777777-7777-4777-8777-777777777777",
  payload: {
    requestId,
    projectId,
    bindingId,
    command: {
      type: "git.status",
    },
  },
}

const status = {
  branch: {
    head: "main",
    detached: false,
  },
  staged: 0,
  unstaged: 1,
  untracked: 0,
  conflicted: 0,
  clean: false,
}

const planId = "44444444-4444-4444-8444-444444444444"
const planHash = "a".repeat(64)

const plan = {
  schemaVersion: 1 as const,
  projectId,
  bindingId,
  operations: [],
}

const bootstrapRequest: CommandRequestMessage = {
  version: 1,
  type: "command.request",
  messageId: "88888888-8888-4888-8888-888888888888",
  payload: {
    requestId,
    projectId,
    bindingId,
    command: {
      type: "bootstrap.apply",
      planId,
      planHash,
      mode: "initial",
      plan,
    },
  },
}

describe("handleCommandRequest", () => {
  it("returns command.result for a successful Git status", async () => {
    const authorizeBinding = vi.fn().mockResolvedValue({
      projectId,
      bindingId,
      canonicalRepositoryRoot: repositoryRoot,
    })

    const runGitStatus = vi.fn().mockResolvedValue({
      ok: true,
      status,
    })

    const applyBootstrapPlan = vi.fn()

    const result = await handleCommandRequest(request, {
      bindingRegistry: {
        authorizeBinding,
      } as never,
      runGitStatus,
      applyBootstrapPlan,
    })

    expect(result.type).toBe("command.result")

    expect(result.payload).toMatchObject({
      requestId,
      projectId,
      bindingId,
      commandType: "git.status",
      result: status,
    })

    expect(new Date(result.payload.startedAt).toISOString()).toBe(result.payload.startedAt)

    expect(new Date(result.payload.completedAt).toISOString()).toBe(result.payload.completedAt)

    expect(runGitStatus).toHaveBeenCalledWith(repositoryRoot)

    expect(applyBootstrapPlan).not.toHaveBeenCalled()
  })

  it("returns BINDING_NOT_ALLOWED without invoking Git", async () => {
    const authorizeBinding = vi.fn().mockRejectedValue(new Error("not allowed"))

    const runGitStatus = vi.fn()

    const applyBootstrapPlan = vi.fn()

    const result = await handleCommandRequest(request, {
      bindingRegistry: {
        authorizeBinding,
      } as never,
      runGitStatus,
      applyBootstrapPlan,
    })

    expect(result).toMatchObject({
      type: "command.error",
      payload: {
        requestId,
        projectId,
        bindingId,
        commandType: "git.status",
        code: "BINDING_NOT_ALLOWED",
        message: "Binding is not allowed",
      },
    })

    expect(runGitStatus).not.toHaveBeenCalled()
    expect(applyBootstrapPlan).not.toHaveBeenCalled()
  })

  it("maps Git failures to command.error", async () => {
    const authorizeBinding = vi.fn().mockResolvedValue({
      projectId,
      bindingId,
      canonicalRepositoryRoot: repositoryRoot,
    })

    const runGitStatus = vi.fn().mockResolvedValue({
      ok: false,
      code: "NOT_A_GIT_REPOSITORY",
      message: "Repository is not a Git working tree",
    })

    const applyBootstrapPlan = vi.fn()

    const result = await handleCommandRequest(request, {
      bindingRegistry: {
        authorizeBinding,
      } as never,
      runGitStatus,
      applyBootstrapPlan,
    })

    expect(result).toMatchObject({
      type: "command.error",
      payload: {
        code: "NOT_A_GIT_REPOSITORY",
        message: "Repository is not a Git working tree",
      },
    })

    expect(applyBootstrapPlan).not.toHaveBeenCalled()
  })

  it("does not leak repository paths", async () => {
    const authorizeBinding = vi.fn().mockResolvedValue({
      projectId,
      bindingId,
      canonicalRepositoryRoot: repositoryRoot,
    })

    const runGitStatus = vi.fn().mockResolvedValue({
      ok: false,
      code: "GIT_STATUS_FAILED",
      message: "Git status failed",
    })

    const applyBootstrapPlan = vi.fn()

    const result = await handleCommandRequest(request, {
      bindingRegistry: {
        authorizeBinding,
      } as never,
      runGitStatus,
      applyBootstrapPlan,
    })

    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain(repositoryRoot)
    expect(serialized).not.toContain("C:\\")
    expect(serialized).not.toContain("/tmp/")
    expect(applyBootstrapPlan).not.toHaveBeenCalled()
  })

  it("routes bootstrap.apply to the bootstrap executor", async () => {
    const authorizeBinding = vi.fn().mockResolvedValue({
      projectId,
      bindingId,
      canonicalRepositoryRoot: repositoryRoot,
    })

    const runGitStatus = vi.fn()

    const applyBootstrapPlan = vi.fn().mockResolvedValue({
      ok: true,
      verifiedOperationCount: 0,
      reusedOperationCount: 0,
      gitInitialized: false,
    })

    const result = await handleCommandRequest(bootstrapRequest, {
      bindingRegistry: {
        authorizeBinding,
      } as never,
      runGitStatus,
      applyBootstrapPlan,
    })

    expect(applyBootstrapPlan).toHaveBeenCalledWith({
      canonicalRepositoryRoot: repositoryRoot,
      planId,
      planHash,
      mode: "initial",
      plan,
    })

    expect(runGitStatus).not.toHaveBeenCalled()

    expect(result).toMatchObject({
      type: "command.result",
      payload: {
        requestId,
        projectId,
        bindingId,
        commandType: "bootstrap.apply",
        planId,
        planHash,
        verifiedOperationCount: 0,
        reusedOperationCount: 0,
        gitInitialized: false,
      },
    })
  })

  it("maps bootstrap failures to command.error", async () => {
    const authorizeBinding = vi.fn().mockResolvedValue({
      projectId,
      bindingId,
      canonicalRepositoryRoot: repositoryRoot,
    })

    const runGitStatus = vi.fn()

    const applyBootstrapPlan = vi.fn().mockResolvedValue({
      ok: false,
      code: "BOOTSTRAP_FAILED",
      message: "Bootstrap execution is not implemented",
      completedOperationCount: 0,
      reusedOperationCount: 0,
    })

    const result = await handleCommandRequest(bootstrapRequest, {
      bindingRegistry: {
        authorizeBinding,
      } as never,
      runGitStatus,
      applyBootstrapPlan,
    })

    expect(result).toMatchObject({
      type: "command.error",
      payload: {
        requestId,
        projectId,
        bindingId,
        commandType: "bootstrap.apply",
        planId,
        planHash,
        code: "BOOTSTRAP_FAILED",
        message: "Bootstrap execution is not implemented",
        completedOperationCount: 0,
        reusedOperationCount: 0,
      },
    })

    expect(runGitStatus).not.toHaveBeenCalled()
  })

  it("does not invoke bootstrap when binding authorization fails", async () => {
    const authorizeBinding = vi.fn().mockRejectedValue(new Error("not allowed"))

    const runGitStatus = vi.fn()
    const applyBootstrapPlan = vi.fn()

    const result = await handleCommandRequest(bootstrapRequest, {
      bindingRegistry: {
        authorizeBinding,
      } as never,
      runGitStatus,
      applyBootstrapPlan,
    })

    expect(result).toMatchObject({
      type: "command.error",
      payload: {
        commandType: "bootstrap.apply",
        code: "BINDING_NOT_ALLOWED",
        planId,
        planHash,
        completedOperationCount: 0,
        reusedOperationCount: 0,
      },
    })

    expect(applyBootstrapPlan).not.toHaveBeenCalled()
    expect(runGitStatus).not.toHaveBeenCalled()
  })
})
