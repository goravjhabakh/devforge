import { z } from "zod"

export const ApiConfigSchema = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  DAEMON_WS_PATH: z.string().startsWith("/").default("/api/daemon"),
  DAEMON_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
})

export type ApiConfig = z.infer<typeof ApiConfigSchema>

export function loadApiConfig(env: Record<string, string | undefined>) {
  return ApiConfigSchema.parse(env)
}
