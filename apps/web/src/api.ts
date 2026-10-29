import { ApiErrorSchema, GitStatusResponseSchema, ProjectDetailSchema } from "@devforge/contracts"
import type { ApiError, GitStatusResponse, ProjectDetail } from "@devforge/contracts"

export class DevForgeApiError extends Error {
  readonly code: ApiError["code"]

  constructor(error: ApiError) {
    super(error.message)
    this.name = "DevForgeApiError"
    this.code = error.code
  }
}

async function parseError(response: Response): Promise<never> {
  const json: unknown = await response.json()
  const error = ApiErrorSchema.parse(json)

  throw new DevForgeApiError(error)
}

export async function getProject(apiBaseUrl: string, projectId: string): Promise<ProjectDetail> {
  const response = await fetch(`${apiBaseUrl}/api/projects/${projectId}`)

  if (!response.ok) {
    return parseError(response)
  }

  const json: unknown = await response.json()

  return ProjectDetailSchema.parse(json)
}

export async function refreshGitStatus(
  apiBaseUrl: string,
  projectId: string
): Promise<GitStatusResponse> {
  const response = await fetch(`${apiBaseUrl}/api/projects/${projectId}/git-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    return parseError(response)
  }

  const json: unknown = await response.json()

  return GitStatusResponseSchema.parse(json)
}
