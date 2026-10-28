import { z } from "zod"

export const WebConfigSchema = z.object({
  VITE_API_BASE_URL: z.url().default("http://127.0.0.1:3000"),
})

export type WebConfig = z.infer<typeof WebConfigSchema>

export function loadWebConfig(input: Record<string, string | undefined>): WebConfig {
  return WebConfigSchema.parse(input)
}
