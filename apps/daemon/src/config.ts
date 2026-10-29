import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadEnv } from "dotenv"

import { loadDaemonConfig, loadDaemonLocalConfig } from "@devforge/config"
import { BindingRegistry } from "./binding-registry.js"

export async function loadDaemonLocalConfigFile(configPath: string) {
  const rawConfig = await readFile(configPath, "utf-8")
  const parsedConfig: unknown = JSON.parse(rawConfig)

  return loadDaemonLocalConfig(parsedConfig)
}

export async function loadDaemonApplicationConfig() {
  const currentDirectory = dirname(fileURLToPath(import.meta.url))

  const repositoryRoot = resolve(currentDirectory, "../../..")

  loadEnv({
    path: resolve(repositoryRoot, ".env"),
  })

  const daemonConfig = loadDaemonConfig(process.env)
  const localConfigPath = resolve(repositoryRoot, daemonConfig.configPath)
  const rawConfig = await readFile(localConfigPath, "utf8")
  const parsedConfig: unknown = JSON.parse(rawConfig)
  const localConfig = loadDaemonLocalConfig(parsedConfig)
  const bindingRegistry = await BindingRegistry.create(localConfig)

  return {
    daemonConfig,
    localConfig,
    bindingRegistry,
  }
}
