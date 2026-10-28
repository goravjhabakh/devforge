# Roadmap

Development should be vertical-slice-first. Each phase should prove a useful system behavior before the next layer is added.

## Phase 0 — Repository foundation

Goal: establish the monorepo and engineering baseline.

Includes:

- pnpm workspace
- TypeScript configuration
- `apps/web`, `apps/api`, `apps/daemon`
- `packages/protocol`, `packages/contracts`, `packages/db`, `packages/config`
- Biome
- Vitest baseline
- environment/config conventions
- Docker Compose for local PostgreSQL where useful
- basic CI checks

Exit condition: all initial apps/packages build and quality checks run from the repo root.

## Phase 1 — First vertical slice

Goal: prove the browser → control plane → local daemon boundary.

```text
Browser
→ API
→ authenticated daemon
→ local git status
→ persisted event
→ UI update
```

Includes:

- project record
- daemon registration/connection
- shared WebSocket protocol
- local project/repo binding
- read-only `git status`
- event persistence
- simple activity UI

Exit condition: a user can trigger Git status from the web UI and see the local result return through the full architecture.

## Phase 2 — Repo bootstrap + approvals

Goal: safely create a new project repository from an approved plan.

Includes:

- bootstrap proposal
- file/structure preview
- approval state
- daemon file writes within allowed project root
- optional `git init`
- post-write verification

Exit condition: the app can propose and create the initial repo only after explicit approval.

## Phase 3 — Work items + adaptive specs

Goal: represent development work in a structured way.

Includes:

- work items
- task complexity/risk classification
- adaptive spec decision
- lightweight/detailed spec generation
- workflow state transitions
- approval checkpoints

Exit condition: a feature request can become an approved execution-ready work item/spec.

## Phase 4 — AI project shaper

Goal: turn a vague idea into a structured project proposal.

Includes:

- focused discovery conversation
- project definition
- stack/architecture recommendation
- user revision loop
- Vercel AI SDK integration
- `@gorav/openai-oauth` personal provider path

Exit condition: a vague idea can produce an approved project proposal ready for bootstrap.

## Phase 5 — OpenCode execution

Goal: execute an approved work item through the first coding-agent adapter.

Includes:

- shared agent adapter contract
- OpenCode availability check
- execution package
- run lifecycle
- event/log streaming
- cancellation
- result collection

Exit condition: an approved work item can be implemented by OpenCode and tracked from the workspace.

## Phase 6 — Review, verification, and repo memory

Goal: close the development loop.

Includes:

- diff collection
- focused checks/tests
- review summary
- revision loop
- completion approval where required
- updates to relevant repo-memory docs

Exit condition: a work item can go from request to implementation to verified completion with repo context updated.

## Phase 7 — Codex adapter

Goal: prove agent portability.

Includes:

- Codex adapter
- capability detection
- same run/event contract used by OpenCode
- agent selection/fallback rules

Exit condition: the same work-item orchestration can target either supported agent without control-plane rewrites.

## Phase 8 — Self-hosting and hardening

Goal: make V1 practical outside the developer machine.

Includes:

- Dockerized self-hosted control plane
- installation/setup docs
- daemon pairing/auth hardening
- security review
- logs/observability appropriate for V1
- failure/reconnect/recovery behavior
- basic release workflow

Exit condition: another developer can install the self-hosted stack, pair a daemon, and complete the core workflow.

## Later

Potential post-V1 work:

- existing-repo import/onboarding
- GitHub integration and PR workflows
- teams/organizations
- roles and policy-based approvals
- shared agent/tool registries
- parallel agents/worktrees
- richer SaaS hosting
- usage/billing
- configurable workflows
- remote development environments
