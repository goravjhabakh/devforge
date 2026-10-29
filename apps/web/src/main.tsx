import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { loadWebConfig } from "@devforge/config"

import { App } from "./App.js"
import "./styles.css"

const config = loadWebConfig(import.meta.env)
const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

createRoot(root).render(
  <StrictMode>
    <App apiBaseUrl={config.VITE_API_BASE_URL} />
  </StrictMode>
)
