import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDaemonLocalConfigFile } from "./config.js"

const projectA = "22222222-2222-4222-8222-222222222222"
const bindingA = "33333333-3333-4333-8333-333333333333"

const projectB = "44444444-4444-4444-8444-444444444444"
const bindingB = "55555555-5555-4555-8555-555555555555"

describe("loadDaemonLocalConfigFile", () => {
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

  async function createConfigFile(value: unknown) {
    const directory = await mkdtemp(join(tmpdir(), "devforge-config-"))

    tempDirectories.push(directory)

    const configPath = join(directory, "daemon.local.json")

    await writeFile(configPath, JSON.stringify(value), "utf8")

    return configPath
  }

  it("loads a valid configuration with multiple bindings", async () => {
    const configPath = await createConfigFile({
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot: "C:\\test\\repo-a",
        },
        {
          projectId: projectB,
          bindingId: bindingB,
          repositoryRoot: "C:\\test\\repo-b",
        },
      ],
    })

    const config = await loadDaemonLocalConfigFile(configPath)

    expect(config.bindings).toHaveLength(2)

    expect(config.bindings[0]).toEqual({
      projectId: projectA,
      bindingId: bindingA,
      repositoryRoot: "C:\\test\\repo-a",
    })

    expect(config.bindings[1]).toEqual({
      projectId: projectB,
      bindingId: bindingB,
      repositoryRoot: "C:\\test\\repo-b",
    })
  })

  it("rejects duplicate project IDs", async () => {
    const configPath = await createConfigFile({
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot: "C:\\test\\repo-a",
        },
        {
          projectId: projectA,
          bindingId: bindingB,
          repositoryRoot: "C:\\test\\repo-b",
        },
      ],
    })

    await expect(loadDaemonLocalConfigFile(configPath)).rejects.toThrow()
  })

  it("rejects duplicate binding IDs", async () => {
    const configPath = await createConfigFile({
      bindings: [
        {
          projectId: projectA,
          bindingId: bindingA,
          repositoryRoot: "C:\\test\\repo-a",
        },
        {
          projectId: projectB,
          bindingId: bindingA,
          repositoryRoot: "C:\\test\\repo-b",
        },
      ],
    })

    await expect(loadDaemonLocalConfigFile(configPath)).rejects.toThrow()
  })

  it("rejects malformed JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devforge-config-"))

    tempDirectories.push(directory)

    const configPath = join(directory, "daemon.local.json")

    await writeFile(configPath, "{ definitely not valid json", "utf8")

    await expect(loadDaemonLocalConfigFile(configPath)).rejects.toThrow()
  })
})
