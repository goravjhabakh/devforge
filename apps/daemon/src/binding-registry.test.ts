import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import type { DaemonLocalConfig } from "@devforge/config"

import { BindingNotAllowedError, BindingRegistry } from "./binding-registry.js"

const projectA = "22222222-2222-4222-8222-222222222222"
const bindingA = "33333333-3333-4333-8333-333333333333"

const projectB = "44444444-4444-4444-8444-444444444444"
const bindingB = "55555555-5555-4555-8555-555555555555"

describe("BindingRegistry", () => {
  const tempDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirectories.map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        })
      )
    )

    tempDirectories.length = 0
  })

  async function createTempDirectory() {
    const directory = await mkdtemp(join(tmpdir(), "devforge-binding-"))

    tempDirectories.push(directory)

    return directory
  }

  it("authorizes a valid binding and returns its canonical root", async () => {
    const tempRoot = await createTempDirectory()
    const repositoryRoot = join(tempRoot, "repo")

    await mkdir(repositoryRoot)

    const config: DaemonLocalConfig = {
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot,
        },
      ],
    }

    const registry = await BindingRegistry.create(config)

    const authorized = await registry.authorizeBinding(projectA, bindingA)

    expect(authorized).toEqual({
      projectId: projectA,
      bindingId: bindingA,
      canonicalRepositoryRoot: await realpath(repositoryRoot),
    })
  })

  it("rejects an unknown project", async () => {
    const tempRoot = await createTempDirectory()
    const repositoryRoot = join(tempRoot, "repo")

    await mkdir(repositoryRoot)

    const registry = await BindingRegistry.create({
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot,
        },
      ],
    })

    await expect(registry.authorizeBinding(projectB, bindingA)).rejects.toBeInstanceOf(
      BindingNotAllowedError
    )
  })

  it("rejects a mismatched binding ID", async () => {
    const tempRoot = await createTempDirectory()
    const repositoryRoot = join(tempRoot, "repo")

    await mkdir(repositoryRoot)

    const registry = await BindingRegistry.create({
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot,
        },
      ],
    })

    await expect(registry.authorizeBinding(projectA, bindingB)).rejects.toBeInstanceOf(
      BindingNotAllowedError
    )
  })

  it("fails startup when the configured repository root does not exist", async () => {
    const tempRoot = await createTempDirectory()
    const repositoryRoot = join(tempRoot, "missing-repository")

    await expect(
      BindingRegistry.create({
        bindings: [
          {
            projectId: projectA,
            bindingId: bindingA,
            repositoryRoot,
          },
        ],
      })
    ).rejects.toThrow()
  })

  it("fails startup when the configured repository root is a file", async () => {
    const tempRoot = await createTempDirectory()
    const repositoryRoot = join(tempRoot, "file.txt")

    await writeFile(repositoryRoot, "not a directory")

    await expect(
      BindingRegistry.create({
        bindings: [
          {
            projectId: projectA,
            bindingId: bindingA,
            repositoryRoot,
          },
        ],
      })
    ).rejects.toThrow("Configured repository root is not a directory")
  })

  it("rejects a binding when its repository root disappears after startup", async () => {
    const tempRoot = await createTempDirectory()
    const repositoryRoot = join(tempRoot, "repo")

    await mkdir(repositoryRoot)

    const registry = await BindingRegistry.create({
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot,
        },
      ],
    })

    await rm(repositoryRoot, {
      recursive: true,
      force: true,
    })

    await expect(registry.authorizeBinding(projectA, bindingA)).rejects.toBeInstanceOf(
      BindingNotAllowedError
    )
  })

  it("supports multiple valid bindings", async () => {
    const tempRoot = await createTempDirectory()

    const repositoryA = join(tempRoot, "repo-a")
    const repositoryB = join(tempRoot, "repo-b")

    await mkdir(repositoryA)
    await mkdir(repositoryB)

    const registry = await BindingRegistry.create({
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot: repositoryA,
        },
        {
          projectId: projectB,
          bindingId: bindingB,
          repositoryRoot: repositoryB,
        },
      ],
    })

    await expect(registry.authorizeBinding(projectA, bindingA)).resolves.toMatchObject({
      projectId: projectA,
      bindingId: bindingA,
    })

    await expect(registry.authorizeBinding(projectB, bindingB)).resolves.toMatchObject({
      projectId: projectB,
      bindingId: bindingB,
    })
  })
})
