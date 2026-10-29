import { z } from "zod"

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
])

export function isValidBootstrapPath(path: string): boolean {
  if (path.length === 0) {
    return false
  }

  if (path.startsWith("/") || path.startsWith("\\")) {
    return false
  }

  if (/^[A-Za-z]:/.test(path)) {
    return false
  }

  if (path.includes("\\")) {
    return false
  }

  if (/[\u0000-\u001F\u007F]/.test(path)) {
    return false
  }

  const segments = path.split("/")

  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return false
    }

    if (segment.endsWith(".") || segment.endsWith(" ")) {
      return false
    }

    const baseName = segment.split(".")[0]?.toUpperCase()

    if (baseName && WINDOWS_RESERVED_NAMES.has(baseName)) {
      return false
    }
  }

  return true
}

export type BootstrapPlanValidationError = {
  code: "PLAN_LIMIT_EXCEEDED" | "PATH_INVALID" | "ENTRY_CONFLICT" | "PLAN_INVALID"
  message: string
}

export type BootstrapPlanValidationResult =
  | { success: true }
  | {
      success: false
      error: BootstrapPlanValidationError
    }

export const BootstrapDirectoryCreateOperationSchema = z.strictObject({
  type: z.literal("directory.create"),
  path: z.string().min(1),
})

export const BootstrapFileWriteOperationSchema = z.strictObject({
  type: z.literal("file.write"),
  path: z.string().min(1),
  encoding: z.literal("utf8"),
  content: z.string(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
})

export const BootstrapGitInitOperationSchema = z.strictObject({
  type: z.literal("git.init"),
  initialBranch: z.literal("main"),
})

export const BootstrapOperationSchema = z.discriminatedUnion("type", [
  BootstrapDirectoryCreateOperationSchema,
  BootstrapFileWriteOperationSchema,
  BootstrapGitInitOperationSchema,
])

export const BootstrapPlanDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  bindingId: z.uuid(),
  operations: z.array(BootstrapOperationSchema),
})

export const BootstrapStateSchema = z.enum([
  "not_started",
  "awaiting_approval",
  "approved",
  "executing",
  "succeeded",
  "failed",
])

export const BootstrapPlanStatusSchema = z.enum([
  "awaiting_approval",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "superseded",
])

export const BootstrapFailureCodeSchema = z.enum([
  "BINDING_NOT_ALLOWED",
  "ROOT_NOT_FOUND",
  "ROOT_NOT_DIRECTORY",
  "TARGET_NOT_EMPTY",
  "PLAN_HASH_MISMATCH",
  "PLAN_INVALID",
  "PLAN_LIMIT_EXCEEDED",
  "PATH_INVALID",
  "PATH_OUTSIDE_ROOT",
  "LINK_NOT_ALLOWED",
  "ENTRY_CONFLICT",
  "FILE_WRITE_FAILED",
  "GIT_NOT_FOUND",
  "GIT_INIT_FAILED",
  "VERIFICATION_FAILED",
  "BOOTSTRAP_FAILED",
])

export const CreateBootstrapPlanRequestSchema = z.strictObject({
  initializeGit: z.boolean(),
})

export const BootstrapPlanHashRequestSchema = z.strictObject({
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export const BootstrapPlanPreviewSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: BootstrapPlanStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  document: BootstrapPlanDocumentSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})

export const BootstrapApprovalSchema = z.strictObject({
  planId: z.uuid(),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  approvedAt: z.iso.datetime(),
})

export const ProjectBootstrapSchema = z.strictObject({
  state: BootstrapStateSchema,
  plan: BootstrapPlanPreviewSchema.nullable(),
  approval: BootstrapApprovalSchema.nullable(),
})

export type BootstrapState = z.infer<typeof BootstrapStateSchema>
export type BootstrapPlanStatus = z.infer<typeof BootstrapPlanStatusSchema>

export type BootstrapOperation = z.infer<typeof BootstrapOperationSchema>
export type BootstrapPlanDocument = z.infer<typeof BootstrapPlanDocumentSchema>

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)])
    )
  }

  return value
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export function serializeBootstrapPlan(plan: BootstrapPlanDocument): string {
  return JSON.stringify(canonicalize(plan))
}

export async function hashBootstrapPlan(plan: BootstrapPlanDocument): Promise<string> {
  const serialized = serializeBootstrapPlan(plan)
  const bytes = new TextEncoder().encode(serialized)

  return sha256Hex(bytes)
}

export async function validateBootstrapPlan(
  plan: BootstrapPlanDocument
): Promise<BootstrapPlanValidationResult> {
  if (plan.operations.length > 100) {
    return {
      success: false,
      error: {
        code: "PLAN_LIMIT_EXCEEDED",
        message: "Bootstrap plan exceeds the operation limit",
      },
    }
  }

  let fileCount = 0
  let totalFileBytes = 0

  const seenPaths = new Set<string>()
  const seenCaseInsensitivePaths = new Set<string>()

  for (const [index, operation] of plan.operations.entries()) {
    if (operation.type === "git.init") {
      if (index !== plan.operations.length - 1) {
        return {
          success: false,
          error: {
            code: "PLAN_INVALID",
            message: "Git initialization must be the final operation",
          },
        }
      }

      continue
    }

    if (!isValidBootstrapPath(operation.path)) {
      return {
        success: false,
        error: {
          code: "PATH_INVALID",
          message: "Bootstrap path is invalid",
        },
      }
    }

    const pathBytes = new TextEncoder().encode(operation.path).byteLength

    if (pathBytes > 240) {
      return {
        success: false,
        error: {
          code: "PATH_INVALID",
          message: "Bootstrap path exceeds the maximum length",
        },
      }
    }

    if (seenPaths.has(operation.path)) {
      return {
        success: false,
        error: {
          code: "ENTRY_CONFLICT",
          message: "Bootstrap plan contains a duplicate path",
        },
      }
    }

    const caseInsensitivePath = operation.path.toLocaleLowerCase("en-US")

    if (seenCaseInsensitivePaths.has(caseInsensitivePath)) {
      return {
        success: false,
        error: {
          code: "ENTRY_CONFLICT",
          message: "Bootstrap plan contains a case-insensitive path collision",
        },
      }
    }

    seenPaths.add(operation.path)
    seenCaseInsensitivePaths.add(caseInsensitivePath)

    if (operation.type !== "file.write") {
      continue
    }

    fileCount += 1

    if (fileCount > 50) {
      return {
        success: false,
        error: {
          code: "PLAN_LIMIT_EXCEEDED",
          message: "Bootstrap plan exceeds the file limit",
        },
      }
    }

    const contentBytes = new TextEncoder().encode(operation.content)

    if (contentBytes.byteLength > 256 * 1024) {
      return {
        success: false,
        error: {
          code: "PLAN_LIMIT_EXCEEDED",
          message: "Bootstrap file exceeds the size limit",
        },
      }
    }

    totalFileBytes += contentBytes.byteLength

    if (totalFileBytes > 1024 * 1024) {
      return {
        success: false,
        error: {
          code: "PLAN_LIMIT_EXCEEDED",
          message: "Bootstrap plan exceeds the total file content limit",
        },
      }
    }

    if (operation.sizeBytes !== contentBytes.byteLength) {
      return {
        success: false,
        error: {
          code: "PLAN_INVALID",
          message: "Bootstrap file size does not match its content",
        },
      }
    }

    const actualHash = await sha256Hex(contentBytes)

    if (actualHash !== operation.contentSha256) {
      return {
        success: false,
        error: {
          code: "PLAN_INVALID",
          message: "Bootstrap file hash does not match its content",
        },
      }
    }
  }

  return { success: true }
}
