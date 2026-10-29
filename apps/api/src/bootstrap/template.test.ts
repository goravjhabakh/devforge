import { describe, expect, it } from "vitest"

import { createBootstrapTemplate } from "./template.js"

describe("createBootstrapTemplate", () => {
  it("creates the deterministic V1 repository template", () => {
    const first = createBootstrapTemplate({
      projectName: "Example Project",
    })

    const second = createBootstrapTemplate({
      projectName: "Example Project",
    })

    expect(first).toEqual(second)

    expect(first.directories).toEqual(["docs", "docs/specs"])

    expect(first.files.map((file) => file.path)).toEqual([
      "README.md",
      "AGENTS.md",
      "docs/project.md",
      "docs/architecture.md",
      "docs/decisions.md",
      "docs/roadmap.md",
      "docs/progress.md",
      "docs/specs/README.md",
    ])
  })

  it("uses the project name in project-specific files", () => {
    const template = createBootstrapTemplate({
      projectName: "DevForge Demo",
    })

    const readme = template.files.find((file) => file.path === "README.md")

    expect(readme?.content).toContain("DevForge Demo")
  })
})
