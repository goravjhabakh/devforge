// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProjectDetail } from "@devforge/contracts"

import { App } from "./App.js"
import { DevForgeApiError, getProject, refreshGitStatus } from "./api.js"

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.js")>()

  return {
    ...actual,
    getProject: vi.fn(),
    refreshGitStatus: vi.fn(),
  }
})

const mockedGetProject = vi.mocked(getProject)
const mockedRefreshGitStatus = vi.mocked(refreshGitStatus)

const projectId = "22222222-2222-4222-8222-222222222222"
const daemonId = "11111111-1111-4111-8111-111111111111"

function createProject(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: {
      id: projectId,
      name: "Development Project A",
    },
    daemon: {
      id: daemonId,
      connected: true,
      lastSeenAt: "2026-10-29T08:00:00.000Z",
    },
    binding: {
      available: true,
    },
    latestStatus: null,
    activity: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("App", () => {
  it("renders an enabled refresh button when the daemon and binding are available", async () => {
    mockedGetProject.mockResolvedValue(createProject())

    render(<App apiBaseUrl="http://127.0.0.1:3000" />)

    const button = await screen.findByRole("button", {
      name: "Refresh Git status",
    })

    expect(button).toBeEnabled()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByText("Available")).toBeInTheDocument()
  })

  it("disables refresh when the daemon is disconnected", async () => {
    mockedGetProject.mockResolvedValue(
      createProject({
        daemon: {
          id: daemonId,
          connected: false,
          lastSeenAt: "2026-10-29T08:00:00.000Z",
        },
      })
    )

    render(<App apiBaseUrl="http://127.0.0.1:3000" />)

    const button = await screen.findByRole("button", {
      name: "Refresh Git status",
    })

    expect(button).toBeDisabled()
    expect(screen.getByText("Disconnected")).toBeInTheDocument()
  })

  it("renders the latest Git status", async () => {
    mockedGetProject.mockResolvedValue(
      createProject({
        latestStatus: {
          completedAt: "2026-10-29T08:00:00.000Z",
          status: {
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
          },
        },
      })
    )

    render(<App apiBaseUrl="http://127.0.0.1:3000" />)

    await screen.findByText("Git status")

    expect(screen.getByText("main")).toBeInTheDocument()
    expect(screen.getByText("Dirty")).toBeInTheDocument()
    expect(screen.getByText("origin/main")).toBeInTheDocument()

    expect(screen.getByText("Staged").nextElementSibling).toHaveTextContent("1")
    expect(screen.getByText("Unstaged").nextElementSibling).toHaveTextContent("2")
    expect(screen.getByText("Untracked").nextElementSibling).toHaveTextContent("3")
    expect(screen.getByText("Conflicted").nextElementSibling).toHaveTextContent("0")
  })

  it("refreshes Git status and then reloads persisted project state", async () => {
    const user = userEvent.setup()

    const initialProject = createProject()

    const refreshedProject = createProject({
      latestStatus: {
        completedAt: "2026-10-29T08:05:00.000Z",
        status: {
          branch: {
            head: "main",
            detached: false,
          },
          staged: 0,
          unstaged: 1,
          untracked: 0,
          conflicted: 0,
          clean: false,
        },
      },
    })

    mockedGetProject.mockResolvedValueOnce(initialProject).mockResolvedValueOnce(refreshedProject)

    if (!refreshedProject.latestStatus) {
      throw new Error("Expected latestStatus to be defined")
    }

    mockedRefreshGitStatus.mockResolvedValue({
      requestId: "66666666-6666-4666-8666-666666666666",
      completedAt: "2026-10-29T08:05:00.000Z",
      status: refreshedProject.latestStatus.status,
    })

    render(<App apiBaseUrl="http://127.0.0.1:3000" />)

    const button = await screen.findByRole("button", {
      name: "Refresh Git status",
    })

    await user.click(button)

    await waitFor(() => {
      expect(mockedRefreshGitStatus).toHaveBeenCalledOnce()
    })

    expect(mockedRefreshGitStatus).toHaveBeenCalledWith("http://127.0.0.1:3000", projectId)

    await waitFor(() => {
      expect(mockedGetProject).toHaveBeenCalledTimes(2)
    })

    expect(await screen.findByText("Dirty")).toBeInTheDocument()
  })

  it("displays a safe API failure", async () => {
    mockedGetProject.mockResolvedValue(createProject())

    mockedRefreshGitStatus.mockRejectedValue(
      new DevForgeApiError({
        code: "DAEMON_COMMAND_FAILED",
        message: "Repository is not a Git working tree",
      })
    )

    render(<App apiBaseUrl="http://127.0.0.1:3000" />)

    const user = userEvent.setup()

    const button = await screen.findByRole("button", {
      name: "Refresh Git status",
    })

    await user.click(button)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Repository is not a Git working tree"
    )
  })
})
