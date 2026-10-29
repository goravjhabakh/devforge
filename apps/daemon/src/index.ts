import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadEnv } from "dotenv"

import { loadDaemonConfig, loadDaemonLocalConfig } from "@devforge/config"

import { startDaemonClient } from "./client.js"

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(currentDirectory, "../../..")

loadEnv({
  path: resolve(repositoryRoot, ".env"),
})

const daemonConfig = loadDaemonConfig(process.env)

const configPath = resolve(repositoryRoot, daemonConfig.configPath)

const rawConfig = await readFile(configPath, "utf8")
const parsedConfig: unknown = JSON.parse(rawConfig)

const localConfig = loadDaemonLocalConfig(parsedConfig)

startDaemonClient({
  config: daemonConfig,
  localConfig,
})
