import { z } from "zod"

export const DaemonConfigSchema = z.object({
  daemonId: z.uuid(),
  credential: z.string().min(32),
  controlPlaneUrl: z.url().refine((value) => {
    return value.startsWith("ws://") || value.startsWith("wss://")
  }, "Control plane URL must use ws:// or wss://"),
  configPath: z.string().min(1),
})

export type DaemonConfig = z.infer<typeof DaemonConfigSchema>

export function loadDaemonConfig(env: Record<string, string | undefined>) {
  return DaemonConfigSchema.parse({
    daemonId: env.DEVFORGE_DAEMON_ID,
    credential: env.DEVFORGE_DAEMON_CREDENTIAL,
    controlPlaneUrl: env.DEVFORGE_CONTROL_PLANE_URL,
    configPath: env.DEVFORGE_DAEMON_CONFIG_PATH,
  })
}

export const DaemonBindingSchema = z.object({
  projectId: z.uuid(),
  bindingId: z.uuid(),
  repositoryRoot: z.string().min(1),
})

export const DaemonLocalConfigSchema = z
  .object({
    bindings: z.array(DaemonBindingSchema),
  })
  .superRefine((config, ctx) => {
    const projectIds = new Set<string>()
    const bindingIds = new Set<string>()

    config.bindings.forEach((binding, index) => {
      if (projectIds.has(binding.projectId)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate projectId: ${binding.projectId}`,
          path: ["bindings", index, "projectId"],
        })
      } else {
        projectIds.add(binding.projectId)
      }

      if (bindingIds.has(binding.bindingId)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate bindingId: ${binding.bindingId}`,
          path: ["bindings", index, "bindingId"],
        })
      } else {
        bindingIds.add(binding.bindingId)
      }
    })
  })

export type DaemonBinding = z.infer<typeof DaemonBindingSchema>

export type DaemonLocalConfig = z.infer<typeof DaemonLocalConfigSchema>

export function loadDaemonLocalConfig(input: unknown): DaemonLocalConfig {
  return DaemonLocalConfigSchema.parse(input)
}
