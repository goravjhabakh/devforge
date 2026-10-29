import { useEffect, useState } from "react"

import type { ProjectDetail } from "@devforge/contracts"

import { DevForgeApiError, getProject, refreshGitStatus } from "./api.js"

const PROJECT_ID = "22222222-2222-4222-8222-222222222222"

type AppProps = {
  apiBaseUrl: string
}

function formatError(error: unknown): string {
  if (error instanceof DevForgeApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return "Unable to reach the DevForge API"
  }

  return "Something went wrong"
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function activityLabel(type: ProjectDetail["activity"][number]["type"]): string {
  switch (type) {
    case "git.status.requested":
      return "Git status requested"

    case "git.status.succeeded":
      return "Git status succeeded"

    case "git.status.failed":
      return "Git status failed"
  }
}

export function App({ apiBaseUrl }: AppProps) {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadProject() {
    const data = await getProject(apiBaseUrl, PROJECT_ID)
    setProject(data)
  }

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const data = await getProject(apiBaseUrl, PROJECT_ID)

        if (active) {
          setProject(data)
          setError(null)
        }
      } catch (loadError) {
        if (active) {
          setError(formatError(loadError))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [apiBaseUrl])

  async function handleRefresh() {
    if (!project) {
      return
    }

    setRefreshing(true)
    setError(null)

    try {
      await refreshGitStatus(apiBaseUrl, PROJECT_ID)
    } catch (refreshError) {
      setError(formatError(refreshError))
    }

    try {
      await loadProject()
    } catch (loadError) {
      setError(formatError(loadError))
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <main>
        <h1>DevForge</h1>
        <p>Loading project…</p>
      </main>
    )
  }

  if (!project) {
    return (
      <main>
        <h1>DevForge</h1>
        <p role="alert">{error ?? "Unable to load project"}</p>
      </main>
    )
  }

  const latestStatus = project.latestStatus

  const refreshDisabled = !project.daemon.connected || !project.binding.available || refreshing

  return (
    <main>
      <header>
        <h1>{project.project.name}</h1>

        <dl>
          <div>
            <dt>Daemon</dt>
            <dd>{project.daemon.connected ? "Connected" : "Disconnected"}</dd>
          </div>

          <div>
            <dt>Binding</dt>
            <dd>{project.binding.available ? "Available" : "Unavailable"}</dd>
          </div>
        </dl>
      </header>

      {error ? <p role="alert">{error}</p> : null}

      <section>
        <div>
          <h2>Git status</h2>

          <button
            type="button"
            disabled={refreshDisabled}
            onClick={() => {
              void handleRefresh()
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh Git status"}
          </button>
        </div>

        {latestStatus === null ? (
          <p>No Git status has been recorded yet.</p>
        ) : (
          <div>
            <p>
              <strong>Branch:</strong>{" "}
              {latestStatus.status.branch.detached
                ? "Detached HEAD"
                : latestStatus.status.branch.head}
            </p>

            <p>
              <strong>State:</strong> {latestStatus.status.clean ? "Clean" : "Dirty"}
            </p>

            <dl>
              <div>
                <dt>Staged</dt>
                <dd>{latestStatus.status.staged}</dd>
              </div>

              <div>
                <dt>Unstaged</dt>
                <dd>{latestStatus.status.unstaged}</dd>
              </div>

              <div>
                <dt>Untracked</dt>
                <dd>{latestStatus.status.untracked}</dd>
              </div>

              <div>
                <dt>Conflicted</dt>
                <dd>{latestStatus.status.conflicted}</dd>
              </div>
            </dl>

            {latestStatus.status.branch.upstream !== undefined ? (
              <p>
                <strong>Upstream:</strong> {latestStatus.status.branch.upstream}
              </p>
            ) : null}

            {latestStatus.status.branch.ahead !== undefined ? (
              <p>
                <strong>Ahead:</strong> {latestStatus.status.branch.ahead}
              </p>
            ) : null}

            {latestStatus.status.branch.behind !== undefined ? (
              <p>
                <strong>Behind:</strong> {latestStatus.status.branch.behind}
              </p>
            ) : null}

            <p>
              <strong>Last checked:</strong> {formatDate(latestStatus.completedAt)}
            </p>
          </div>
        )}
      </section>

      <section>
        <h2>Activity</h2>

        {project.activity.length === 0 ? (
          <p>No activity yet.</p>
        ) : (
          <ul>
            {project.activity.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{activityLabel(event.type)}</strong>
                </div>

                <div>{formatDate(event.createdAt)}</div>

                {event.type === "git.status.failed" ? <div>{event.payload.message}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
