# AI Development Workspace

An AI-assisted development workspace that helps developers turn an idea into a structured software project and continue building it through adaptive specs, agent orchestration, and repo-as-memory.

The product is designed for personal use first, with a path toward open source, self-hosting, managed SaaS, and team workflows later.

## Core ideas

1. **Spec-Driven Development** — use the right amount of specification for the size and risk of the task.
2. **Agent Orchestration** — dynamically choose planning, implementation, review, and tool steps instead of forcing one fixed workflow.
3. **Repo-as-Memory** — keep durable engineering context inside the repository so fresh agent sessions can recover project state.

## V1 product shape

```text
Web workspace
    ↓
Control plane API
    ↓
Local daemon
    ↓
Repository / Git / terminal / coding agents
```

The control plane decides what should happen. The local daemon performs actions that require access to the developer machine.

## V1 scope

V1 focuses on:

- creating a new project from a vague idea
- AI-assisted discovery and project shaping
- architecture and stack proposals with user approval
- approval-first repo bootstrap
- work items with adaptive specs
- OpenCode and Codex execution through adapters
- review, verification, and repo-memory updates
- local Git workflows
- Docker-friendly self-hosting

Not in V1:

- full IDE/editor
- existing repository import
- GitHub/PR automation
- organizations and teams
- parallel write-capable agents
- generic visual workflow builder
- remote cloud development environments

## Initial stack

- TypeScript + Node.js
- React + Vite
- TanStack Router, Query, and Form
- Tailwind CSS + shadcn/ui
- Fastify + Zod
- REST + OpenAPI + Scalar
- PostgreSQL + Drizzle ORM
- Better Auth
- WebSocket control-plane ↔ daemon connection
- Vercel AI SDK
- `@gorav/openai-oauth` for personal ChatGPT subscription access
- pnpm workspaces
- Vitest + focused Playwright tests
- Biome
- Docker / Docker Compose
- GitHub Actions

## Repository layout

```text
apps/
  web/
  api/
  daemon/

packages/
  protocol/
  contracts/
  db/
  config/

  # added only when needed
  ai/
  agents/
  agent-opencode/
  agent-codex/
  git/
  repo/

docs/
  project.md
  architecture.md
  decisions.md
  roadmap.md
  progress.md
  specs/

.agents/
  skills/

AGENTS.md
README.md
```

## Development approach

Development is phase-based and vertical-slice-first. Do not scaffold infrastructure only because it may be useful later.

Start with the smallest slice that proves the architecture:

```text
Browser
→ API
→ authenticated local daemon
→ local git status
→ persisted event
→ UI update
```

Then add repo bootstrap, work items/specs, AI shaping, and coding-agent execution incrementally.

See `AGENTS.md` and the files in `docs/` before implementing changes.
