# Progress

## Current status

**Stage:** Phase 1 first vertical slice complete.

Spec 001 — Repository Foundation has been implemented and verified.

Spec 002 — Daemon Git Status Vertical Slice has been implemented and verified.

## Completed implementation

- pnpm workspace and strict TypeScript baseline established
- React + Vite web application added
- Fastify control-plane API added
- PostgreSQL + Drizzle persistence added for daemons, projects, and activity events
- shared Zod HTTP contracts and versioned daemon protocol added
- authenticated outbound daemon WebSocket connection implemented
- one daemon supports multiple explicit local project bindings
- absolute repository paths remain daemon-local and are not stored by the API or database
- fixed read-only `git.status` capability implemented through the local Git CLI
- Git porcelain v2 output reduced locally to branch metadata and aggregate status counts
- requested and terminal Git-status activity persisted
- command correlation, timeout, disconnect, duplicate-request, and safe failure handling implemented
- bounded daemon reconnect backoff implemented
- minimal project-status UI implemented with persisted activity and refresh behavior
- focused protocol, contract, API, daemon, and web tests added

## Completed planning

- product concept and target user defined
- spec-driven development, agent orchestration, and repo-as-memory selected as core ideas
- web workspace + local daemon architecture selected
- SaaS + self-hostable OSS product model selected
- repository source-of-truth boundary defined
- adaptive spec and dynamic workflow strategies selected
- local Git first selected
- OpenCode first and Codex second adapter direction selected
- one write-capable agent run per project selected
- V1 technology stack and phase roadmap defined

## Phase 1 validation

The first end-to-end architecture slice is proven:

```text
Browser
→ API
→ authenticated local daemon
→ local git status
→ persisted activity
→ UI update
```

Verified behavior includes:

- clean, dirty, staged, and untracked Git states
- persisted latest status and activity surviving browser reload
- daemon connected/disconnected state
- binding availability
- non-Git repository failure
- binding mismatch rejection before Git execution
- duplicate in-flight request rejection
- timeout and daemon-disconnect cleanup
- reconnect after initial API connection refusal
- no repository roots, changed-file names, raw Git output/stderr, or credentials crossing the daemon boundary

Current verification:

- `pnpm test` — 74 tests passing
- `pnpm check` — passing

## Resolved implementation issues

- Daemon WebSocket handshake race: the message listener is attached before asynchronous authentication, with pre-authentication frames buffered and replayed so an immediate `daemon.hello` is not lost.
- Daemon startup connection refusal: bounded reconnect backoff allows the daemon to recover when the API becomes available later.

## Current implementation target

Phase 1 is complete.

Next milestone is **Phase 2 — Repo Bootstrap + Approvals**.

Before implementation begins:

1. create the Phase 2 spec
2. review and approve its scope and security boundaries
3. implement only the approved Phase 2 scope

## Open items

These do not block Phase 2:

- final product name
- final visual design system
- exact hosted deployment provider
- future organization/team model
- GitHub integration design
- Claude Code adapter testing
- durable background workflow infrastructure, if later required

## Update rule

Keep this file short.

After meaningful implementation sessions, update:

- what was completed
- current phase/spec
- notable blockers
- next concrete step

Do not turn this into a detailed changelog.
