import { startDaemonClient } from "./client.js"
import { loadDaemonApplicationConfig } from "./config.js"

const { daemonConfig, localConfig, bindingRegistry } = await loadDaemonApplicationConfig()

startDaemonClient({
  config: daemonConfig,
  localConfig,
  bindingRegistry,
})
