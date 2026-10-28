import { z } from "zod"

export const GitBranchSchema = z.object({
  head: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.string().optional(),
  ahead: z.number().int().nonnegative().optional(),
  behind: z.number().int().nonnegative().optional(),
})

export type GitBranch = z.infer<typeof GitBranchSchema>

export const GitStatusSchema = z.object({
  branch: GitBranchSchema,
  staged: z.number().int().nonnegative(),
  unstaged: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
  conflicted: z.number().int().nonnegative(),
  clean: z.boolean(),
})

export type GitStatus = z.infer<typeof GitStatusSchema>
