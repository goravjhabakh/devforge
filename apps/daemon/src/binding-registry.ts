import { realpath, stat } from "node:fs/promises"

import type { DaemonLocalConfig } from "@devforge/config"

type RegisteredBinding = {
  bindingId: string
  configuredRepositoryRoot: string
  canonicalRepositoryRoot: string
}

export type AuthorizedBinding = {
  projectId: string
  bindingId: string
  canonicalRepositoryRoot: string
}

function pathsMatch(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase()
  }

  return left === right
}

export class BindingNotAllowedError extends Error {
  constructor() {
    super("Binding is not allowed")
    this.name = "BindingNotAllowedError"
  }
}

export class BindingRegistry {
  private readonly bindings: Map<string, RegisteredBinding>

  private constructor(bindings: Map<string, RegisteredBinding>) {
    this.bindings = bindings
  }

  static async create(config: DaemonLocalConfig): Promise<BindingRegistry> {
    const bindings = new Map<string, RegisteredBinding>()

    for (const binding of config.bindings) {
      const canonicalRepositoryRoot = await realpath(binding.repositoryRoot)

      const repositoryStat = await stat(canonicalRepositoryRoot)

      if (!repositoryStat.isDirectory()) {
        throw new Error(`Configured repository root is not a directory: ${binding.repositoryRoot}`)
      }

      bindings.set(binding.projectId, {
        bindingId: binding.bindingId,
        configuredRepositoryRoot: binding.repositoryRoot,
        canonicalRepositoryRoot,
      })
    }

    return new BindingRegistry(bindings)
  }

  async authorizeBinding(projectId: string, bindingId: string): Promise<AuthorizedBinding> {
    const binding = this.bindings.get(projectId)

    if (!binding || binding.bindingId !== bindingId) {
      throw new BindingNotAllowedError()
    }

    let currentCanonicalRoot: string

    try {
      currentCanonicalRoot = await realpath(binding.configuredRepositoryRoot)

      const repositoryStat = await stat(currentCanonicalRoot)

      if (!repositoryStat.isDirectory()) {
        throw new BindingNotAllowedError()
      }
    } catch (error) {
      if (error instanceof BindingNotAllowedError) {
        throw error
      }

      throw new BindingNotAllowedError()
    }

    if (!pathsMatch(currentCanonicalRoot, binding.canonicalRepositoryRoot)) {
      throw new BindingNotAllowedError()
    }

    return {
      projectId,
      bindingId: binding.bindingId,

      // Use the originally approved canonical root, not any
      // path supplied by the network or newly constructed path.
      canonicalRepositoryRoot: binding.canonicalRepositoryRoot,
    }
  }
}
