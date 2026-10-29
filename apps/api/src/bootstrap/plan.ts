import { hashBootstrapPlan, type BootstrapPlanDocument } from "@devforge/contracts"

import { createBootstrapTemplate } from "./template.js"

export type CreateBootstrapPlanInput = {
  projectId: string
  bindingId: string
  projectName: string
  initializeGit: boolean
}

export type CreatedBootstrapPlan = {
  document: BootstrapPlanDocument
  planHash: string
}

export async function createBootstrapPlan(
  input: CreateBootstrapPlanInput
): Promise<CreatedBootstrapPlan> {
  const template = createBootstrapTemplate({
    projectName: input.projectName,
  })

  const directoryOperations = template.directories.map((path) => ({
    type: "directory.create" as const,
    path,
  }))

  const fileOperations = await Promise.all(
    template.files.map(async (file) => {
      const bytes = new TextEncoder().encode(file.content)

      const digest = await crypto.subtle.digest("SHA-256", bytes)

      const contentSha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")

      return {
        type: "file.write" as const,
        path: file.path,
        encoding: "utf8" as const,
        content: file.content,
        contentSha256,
        sizeBytes: bytes.byteLength,
      }
    })
  )

  const operations: BootstrapPlanDocument["operations"] = [
    ...directoryOperations,
    ...fileOperations,
  ]

  if (input.initializeGit) {
    operations.push({
      type: "git.init",
      initialBranch: "main",
    })
  }

  const document: BootstrapPlanDocument = {
    schemaVersion: 1,
    projectId: input.projectId,
    bindingId: input.bindingId,
    operations,
  }

  return {
    document,
    planHash: await hashBootstrapPlan(document),
  }
}
