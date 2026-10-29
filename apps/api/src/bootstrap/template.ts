export type BootstrapTemplateInput = {
  projectName: string
}

export type BootstrapTemplateFile = {
  path: string
  content: string
}

export type BootstrapTemplate = {
  directories: string[]
  files: BootstrapTemplateFile[]
}

export function createBootstrapTemplate(input: BootstrapTemplateInput): BootstrapTemplate {
  return {
    directories: ["docs", "docs/specs"],

    files: [
      {
        path: "README.md",
        content: `# ${input.projectName}

This repository is managed with DevForge.
`,
      },
      {
        path: "AGENTS.md",
        content: `# AGENTS.md

Follow the repository documentation before making non-trivial changes.

## Source of truth

Read:

- docs/project.md
- docs/architecture.md
- docs/decisions.md
- docs/roadmap.md
- docs/progress.md
- docs/specs/
`,
      },
      {
        path: "docs/project.md",
        content: `# Project

## Name

${input.projectName}

## Status

Initial repository bootstrap.
`,
      },
      {
        path: "docs/architecture.md",
        content: `# Architecture

Architecture decisions will be documented here.
`,
      },
      {
        path: "docs/decisions.md",
        content: `# Decisions

Project decisions will be documented here.
`,
      },
      {
        path: "docs/roadmap.md",
        content: `# Roadmap

Project roadmap will be documented here.
`,
      },
      {
        path: "docs/progress.md",
        content: `# Progress

Repository initialized.
`,
      },
      {
        path: "docs/specs/README.md",
        content: `# Specifications

Implementation specifications live in this directory.
`,
      },
    ],
  }
}
