# Architecture

## Overview

```text
Browser / Web App
        |
        v
Control Plane API
        |
        +--> PostgreSQL
        +--> AI Orchestrator
        +--> Workflow / Approvals
        |
        v
Authenticated WebSocket
        |
        v
Local Daemon
        |
        +--> Repository / filesystem
        +--> Git
        +--> approved commands
        +--> OpenCode
        +--> Codex
        +--> project-scoped tools
```

The central rule is simple:

**The control plane decides what should happen. The local daemon performs actions that require access to the developer machine.**

## Web app

Responsibilities:

- project onboarding and discovery
- project workspace
- work items and specs
- proposals and approvals
- agent run status/events
- diff/review UI
- settings for providers, daemon, and supported agents

The browser never talks directly to the local filesystem or shell.

## Control plane API

Responsibilities:

- authentication and ownership
- project planning state before bootstrap
- work-item state
- approvals
- run orchestration
- daemon connection management
- activity/audit events
- AI orchestration
- persistence of operational state

Use a small internal state machine. Do not build a generic visual workflow engine in V1.

Typical states may include:

```text
Draft
→ Discovery
→ Proposed
→ Awaiting Approval
→ Ready
→ Running
→ Reviewing
→ Needs Revision
→ Completed
→ Failed
```

Not every task uses every state.

## Local daemon

One daemon runs per developer machine and may manage multiple approved projects.

Responsibilities:

- establish an authenticated outbound connection to the control plane
- register/verify approved local repo roots
- expose narrow typed capabilities
- read/write approved repo paths
- run Git operations
- launch/supervise coding-agent CLIs
- execute approved checks/commands
- stream events/results back to the control plane

The daemon must not be an unrestricted remote shell.

## Protocol

Control plane ↔ daemon communication uses a versioned, typed WebSocket protocol.

Initial message categories should stay small:

```text
daemon.hello
daemon.ready
command.request
command.result
command.error
run.event
heartbeat
```

Runtime validation belongs in the shared protocol package.

The first supported command should be read-only Git status. Add capabilities only as required by later phases.

## Data model

Initial operational entities:

- `Project`
- `WorkItem`
- `Run`
- `Approval`
- `Daemon`
- `Event`

Do not create separate database entities for every repo document or skill in V1. Repo engineering files remain files unless they need an independent product lifecycle.

## Repository boundary

After bootstrap, repo files are authoritative for engineering context.

Expected durable files:

```text
AGENTS.md
docs/project.md
docs/architecture.md
docs/decisions.md
docs/roadmap.md
docs/progress.md
docs/specs/
```

The database may store derived summaries/indexes, but it should not silently overwrite conflicting repo state.

## Agent adapters

The orchestrator depends on a shared adapter contract rather than a specific coding agent.

Conceptual interface:

```text
checkAvailability()
startRun(context, instructions, permissions)
streamEvents()
cancelRun()
getResult()
```

Initial implementation order:

1. OpenCode
2. Codex
3. Claude Code later

V1 permits one write-capable run per project at a time.

## AI execution

Use Vercel AI SDK provider abstraction.

For personal use, `@gorav/openai-oauth` should allow ChatGPT subscription-backed model access.

Important boundary: model credentials should not be forced into the hosted control plane. Provider execution must be pluggable so sensitive/local credentials can remain on the local machine when needed.

## Monorepo direction

Initial packages/apps:

```text
apps/web
apps/api
apps/daemon

packages/protocol
packages/contracts
packages/db
packages/config
```

Add later only when needed:

```text
packages/ai
packages/agents
packages/agent-opencode
packages/agent-codex
packages/git
packages/repo
```

## Deployment model

### Managed SaaS

Hosted:

- web app
- control plane
- PostgreSQL
- orchestration services

Local:

- daemon
- repo
- Git
- coding-agent CLIs
- local/private provider credentials when configured that way

### Self-hosted OSS

Docker/self-hosted:

- web app
- API/control plane
- PostgreSQL

Developer machine:

- local daemon

Use the same architecture in both modes.
