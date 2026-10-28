# Spec 002 — Daemon Git Status Vertical Slice

## 1. Goal

Prove the first real end-to-end boundary described in `docs/architecture.md` and Roadmap Phase 1:

```text
Web UI → Control Plane API → Local Daemon → local Git repository
       ← persisted activity/result ← Local Daemon
```

The slice must establish that the control plane can request one narrow, read-only local capability without exposing filesystem or shell access. It deliberately precedes AI, repository bootstrap, and coding-agent work.

## 2. User-visible outcome

For one pre-created project, a user can open a minimal project page, see whether its assigned daemon is connected, request Git status, and see either:

- branch and clean/dirty summary returned by the local repository; or
- a clear disconnected, unbound, timeout, Git-unavailable, or not-a-repository error.

The completed attempt appears in a persisted activity list and remains visible after a browser refresh.

## 3. Scope

- Convert `apps/web` to a minimal React + Vite app.
- Run `apps/api` as a Fastify control-plane service.
- Run `apps/daemon` as a Node.js process that initiates an authenticated outbound WebSocket connection.
- Use PostgreSQL through Drizzle for only projects, daemons, bindings, and activity events required by this slice.
- Define shared Zod schemas for HTTP payloads and the versioned daemon protocol.
- Support one daemon managing multiple explicitly configured project bindings.
- Execute one typed, read-only `git.status` capability through the local Git CLI.
- Persist request and terminal activity before returning the terminal result to the browser.
- Provide deterministic local seed/configuration for one daemon and at least two project bindings, with one project used by the minimal page.
- Add only the local PostgreSQL setup necessary to run and validate the slice.

The local binding is a Phase 1 test seam, not general existing-repository onboarding. The absolute repository path remains in daemon-local configuration; the API stores only an opaque binding ID associated with a project and daemon.

## 4. Non-goals

- AI orchestration, Vercel AI SDK, or `@gorav/openai-oauth`.
- OpenCode, Codex, or any coding-agent execution.
- Repository creation/bootstrap, filesystem writes, or repo-memory updates.
- Adaptive specs, work items, dynamic workflows, or a general approval engine.
- General existing-repository import/onboarding or a browser filesystem picker.
- GitHub integration.
- Git commits, staging, checkout, branch creation, or any other mutating Git operation.
- Arbitrary commands, terminal access, command strings supplied by the API, or shell execution.
- File contents, diffs, secrets, or absolute local paths leaving the daemon.
- Redis, BullMQ, Inngest, Trigger.dev, queues, or generic workflow infrastructure.
- Teams, organizations, production deployment, or self-hosting work.
- Dockerizing applications; a PostgreSQL-only Compose service is allowed for local development.
- A design system, TanStack libraries, Tailwind, shadcn/ui, Scalar UI, or broad application navigation unless separately justified.

## 5. Architecture / request flow

1. The daemon reads its identity, credential, control-plane URL, and `{ projectId, bindingId, repositoryRoot }` entries from validated local configuration.
2. It opens an outbound WebSocket to the API, authenticates during upgrade, sends `daemon.hello`, and receives `daemon.ready`. The API validates every message and keeps the live socket only in process memory.
3. `daemon.hello` advertises `git.status` and opaque project/binding IDs, never local paths. The API marks matching persisted bindings available and records `lastSeenAt`.
4. The web app loads `GET /api/projects/:projectId`, including current daemon availability and recent activity.
5. The user selects **Refresh Git status**. The web app sends `POST /api/projects/:projectId/git-status` with no command or path input.
6. The API verifies that the project has a matching connected daemon/binding, creates a `git.status.requested` event, generates a correlation ID, and sends a typed `command.request`.
7. The daemon verifies the requested project/binding against its local allowlist and invokes Git directly, without a shell, with fixed arguments equivalent to `git -C <root> status --porcelain=v2 --branch --untracked-files=normal`.
8. The daemon parses and reduces the output locally, then returns `command.result` or `command.error`. No file names or file contents are returned.
9. The API correlates the response to the pending request, validates it, persists `git.status.succeeded` or `git.status.failed`, and only then resolves the HTTP request.
10. The web app renders the response and refreshes project/activity data. Browser push, SSE, and browser WebSockets are unnecessary for this slice.

The POST may remain open while the command runs, with a short fixed API timeout. Pending requests are in memory; a process restart may fail the request, while already persisted activity remains durable. Retries and recovery are later hardening work.

## 6. Data model changes

Use UUIDs and UTC timestamps. Drizzle migrations are committed.

### `daemons`

- `id` — primary key; stable configured daemon ID.
- `name` — display label.
- `credentialHash` — hash of the pre-provisioned bearer credential; never store the plaintext credential.
- `lastSeenAt` — nullable timestamp updated on hello/heartbeat.
- `createdAt`, `updatedAt`.

`connected` is not persisted as truth; it is derived from the API's live connection registry. `lastSeenAt` is historical context.

### `projects`

- `id` — primary key.
- `name` — display name.
- `daemonId` — foreign key to `daemons`.
- `daemonBindingId` — opaque identifier that must match the daemon-local binding.
- `createdAt`, `updatedAt`.

Do not store `repositoryRoot` or any absolute path in PostgreSQL.

### `events`

- `id` — primary key.
- `projectId` — foreign key to `projects`.
- `daemonId` — nullable foreign key to `daemons`.
- `requestId` — correlation ID, indexed.
- `type` — initially `git.status.requested`, `git.status.succeeded`, or `git.status.failed`.
- `payload` — JSONB validated against event-specific Zod schemas before write and after read.
- `createdAt`.

Requested payloads contain no path. Success payloads contain the normalized status summary. Failure payloads contain a safe error code and user-facing message, not raw process environment or unrestricted stderr. Separate `WorkItem`, `Run`, and `Approval` tables are not needed.

## 7. Protocol messages and payload responsibilities

`packages/protocol` owns protocol version `1`, Zod schemas, and inferred TypeScript types for both directions. Every JSON message is a discriminated union with `version`, `type`, `messageId`, and a type-specific `payload`. Unknown versions, types, or invalid payloads are rejected and logged safely.

Initial messages:

- `daemon.hello` (daemon → API): `daemonId`, supported protocol versions, capability list, and registered `{ projectId, bindingId }` pairs. It contains no paths or credential.
- `daemon.ready` (API → daemon): selected protocol version and accepted `{ projectId, bindingId }` pairs. Rejected pairs remain unusable.
- `command.request` (API → daemon): `requestId`, `projectId`, `bindingId`, and the literal command `{ type: "git.status" }`. There is no executable, argument, working-directory, or free-form options field.
- `command.result` (daemon → API): matching IDs, literal command type, normalized `GitStatus`, `startedAt`, and `completedAt`.
- `command.error` (daemon → API): matching IDs, literal command type, safe error code, safe message, and timestamps.
- `heartbeat` / `heartbeat.ack`: liveness identifiers/timestamps only.

`GitStatus` is shared by protocol and HTTP contracts and contains:

- `branch.head: string | null` and `branch.detached: boolean`;
- optional `branch.upstream`, `ahead`, and `behind` values when Git reports them;
- integer counts for `staged`, `unstaged`, `untracked`, and `conflicted` entries;
- derived `clean: boolean`.

No changed-file paths, file contents, raw stdout, or raw stderr cross the daemon boundary. `packages/contracts` owns Zod schemas for project detail, activity, and Git-status HTTP responses; it may import the shared Git-status schema from `packages/protocol` rather than duplicate it.

## 8. API responsibilities

- Start Fastify with validated configuration and a PostgreSQL connection.
- Authenticate the daemon WebSocket upgrade, negotiate protocol v1, and enforce one active connection per daemon ID; the newest valid connection replaces the stale one.
- Maintain an in-memory registry of connected daemon IDs, accepted bindings, sockets, and pending request resolvers.
- Validate the daemon's advertised bindings against persisted project assignment before accepting them.
- Expose:
  - `GET /api/health`;
  - `GET /api/projects/:projectId` for project, live daemon state, latest status, and recent activity;
  - `POST /api/projects/:projectId/git-status` with no user-controlled execution payload.
- Reject unknown projects, unbound/mismatched projects, disconnected daemons, duplicate in-flight requests for the same project, and malformed protocol messages.
- Persist the requested event before dispatch, and persist success/failure before completing the HTTP response.
- Apply a fixed command timeout, clear pending requests on disconnect, and translate failures to stable HTTP/protocol error codes.
- Avoid logging credentials, local paths, raw Git output, or sensitive WebSocket payloads.
- Provide a narrow seed command for development records; do not add project-management CRUD.

## 9. Daemon responsibilities

- Validate local configuration at startup and fail clearly on duplicate IDs, missing credentials, or invalid roots.
- Initiate and maintain the outbound WebSocket with bounded reconnect backoff and heartbeat handling.
- Keep the `projectId → { bindingId, canonical repositoryRoot }` allowlist local.
- Accept only protocol v1 messages and only the literal `git.status` command for an accepted binding.
- Re-resolve/canonicalize the configured root before execution and reject any binding that no longer resolves to the registered root or is not a Git working tree.
- Spawn the Git executable directly with a fixed argument array, `shell: false`, a timeout, output-size limits, and no API-provided path or arguments.
- Parse porcelain v2 output locally into `GitStatus`; do not transmit names, contents, raw output, environment values, or the repository root.
- Map expected failures to stable codes such as `BINDING_NOT_ALLOWED`, `GIT_NOT_FOUND`, `NOT_A_GIT_REPOSITORY`, `COMMAND_TIMEOUT`, `OUTPUT_LIMIT_EXCEEDED`, and `GIT_STATUS_FAILED`.
- Support multiple configured project bindings without adding a plugin/capability framework or a new `packages/git` package in this slice.

## 10. Web responsibilities

- Use React + Vite for one minimal project-status page.
- Load project detail and recent activity from the API.
- Display connected/disconnected daemon state and disable refresh when the binding is unavailable.
- Trigger the fixed Git-status endpoint, prevent duplicate submission, and show pending, success, and safe failure states.
- Display branch, clean/dirty state, staged/unstaged/untracked/conflicted counts, timestamp, and persisted activity.
- Refresh from API state after completion; do not talk to the daemon, filesystem, or shell directly.
- Use plain React state and `fetch` unless a later approved requirement justifies TanStack Router/Query/Form or a component system.

## 11. Security and trust boundaries

- **Browser → API:** the browser supplies only a project ID through a fixed route. It cannot supply paths, executables, arguments, or protocol messages. Full user authentication/ownership is unresolved below; Phase 1 must not be presented as production-ready without it.
- **API → daemon:** authenticate the WebSocket before accepting messages. Validate every envelope and payload. The credential is provisioned out of band, sent only over TLS outside local development, and stored hashed by the API.
- **Daemon → repository:** only locally configured, canonical roots are allowed. Project and binding IDs must both match. Never derive a path from network input and never use a shell.
- **Data minimization:** local absolute paths, file names, file contents, diffs, raw Git output, secrets, and process environment remain local. The control plane receives only status metadata and safe errors.
- **Capability boundary:** `git.status` is an explicit capability, not a generic command abstraction. New commands require new schemas and handlers.
- **Availability:** connection state is live in memory and command execution has timeout/output limits. No queue or automatic command replay is introduced.

## 12. Planned files/packages to add or modify

No new workspace package is justified. Exact internal filenames may vary while retaining these boundaries.

```text
package.json                         # dev/migration scripts as needed
pnpm-lock.yaml
.env.example                        # non-secret placeholders only
compose.yaml                         # PostgreSQL only, if approved
vitest.config.ts

apps/web/
  package.json
  tsconfig.json
  index.html
  vite.config.ts
  src/main.tsx
  src/App.tsx
  src/api.ts
  src/styles.css
  src/*.test.tsx

apps/api/
  package.json
  src/index.ts
  src/app.ts
  src/routes/projects.ts
  src/daemon/connection-registry.ts
  src/daemon/websocket.ts
  src/*.test.ts

apps/daemon/
  package.json
  src/index.ts
  src/client.ts
  src/config.ts
  src/git-status.ts
  src/*.test.ts

packages/protocol/
  package.json
  src/index.ts
  src/messages.ts
  src/git-status.ts
  src/*.test.ts

packages/contracts/
  package.json
  src/index.ts
  src/projects.ts
  src/activity.ts
  src/*.test.ts

packages/db/
  package.json
  drizzle.config.ts
  src/index.ts
  src/client.ts
  src/schema.ts
  src/seed.ts
  migrations/*
  src/*.test.ts

packages/config/
  package.json
  src/index.ts
  src/api.ts
  src/daemon.ts
  src/web.ts
  src/*.test.ts
```

Implementation completion also updates `docs/progress.md`; `docs/architecture.md` or `docs/decisions.md` should change only if approval resolves an ambiguity into a durable architectural decision.

## 13. Implementation sequence

1. Approve the decisions in section 16, especially authentication and local binding configuration.
2. Add dependencies/configuration and define protocol, HTTP, configuration, and event schemas with unit tests.
3. Add Drizzle schema, initial migration, PostgreSQL development setup, and deterministic seed data.
4. Implement and integration-test the Fastify project routes, daemon authentication, connection registry, correlation, persistence, timeout, and disconnect behavior using a fake daemon socket.
5. Implement and unit-test daemon configuration validation, binding checks, fixed Git invocation, porcelain parsing, safe errors, and protocol client/reconnect behavior.
6. Implement the React/Vite page against the HTTP contracts.
7. Run the complete system with a temporary local Git repository and verify success plus disconnected, mismatched-binding, and non-repository failures.
8. Run root quality checks, perform the focused browser flow, review the security boundary, and update repo memory.

## 14. Acceptance criteria

- A daemon initiates an authenticated outbound WebSocket and the UI accurately shows its live connection state.
- One daemon can advertise at least two configured project bindings, while a command is routed only to the binding assigned to the requested project.
- The browser can trigger only the fixed Git-status operation and never sends a local path or command arguments.
- The daemon rejects unknown/mismatched bindings before invoking Git.
- Git is invoked through the local Git CLI with fixed arguments and without a shell.
- A clean and a dirty test repository produce correct branch and aggregate status values.
- No local root, changed-file name, file content, raw Git output, secret, or process environment reaches the API, database, browser, or logs.
- Requested and terminal events are persisted and correlated; the terminal event is committed before the POST succeeds.
- Refreshing the browser reloads the latest result and activity from PostgreSQL.
- Disconnected daemon, timeout, missing Git, non-repository, malformed protocol, and daemon disconnect cases produce bounded, safe failures and persisted failure activity where a request was accepted.
- Invalid protocol messages do not execute Git or crash either process.
- No AI, agent, bootstrap, Git mutation, arbitrary command, queue, team, or production deployment functionality is introduced.
- Focused tests and all root quality checks pass.

## 15. Validation strategy / commands

Unit tests cover Zod schemas, protocol version/type rejection, porcelain parsing, aggregate counts, safe error mapping, config validation, and root/binding authorization. Integration tests cover Fastify routes with PostgreSQL, fake authenticated daemon connections, event ordering, correlation, timeout/disconnect cleanup, and malformed messages. One focused end-to-end test uses a temporary Git repository and the real daemon/Git CLI; one Playwright flow verifies connection state, triggering status, rendered result, and activity surviving reload.

Expected commands, finalized during implementation:

```sh
pnpm install --frozen-lockfile
docker compose up -d postgres           # only if Compose is approved
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm check
pnpm test:integration
pnpm test:e2e
```

Manual validation must also dirty the temporary repository without committing, rerun status, stop the daemon, and confirm both changed status and disconnected behavior. Tests must not depend on or modify the product repository.

## 16. Assumptions and decisions requiring approval

Approve or revise these before implementation:

1. **Phase 1 binding versus existing-repo non-goal:** use a daemon-local, manually configured binding only for pre-created/seeded projects. This proves the boundary without creating a general existing-repository onboarding flow.
2. **Path privacy:** store only `daemonId` and opaque `daemonBindingId` in PostgreSQL. Absolute roots remain in daemon-local configuration and are never advertised. This is stricter than the current docs, which do not decide where roots are stored.
3. **Binding configuration format:** use a validated local JSON configuration file for multiple bindings, with daemon URL/ID and credential supplied by environment variables. The file is user-authored and excluded from Git. A CLI/UI registration flow is deferred.
4. **Daemon authentication provisioning:** pre-provision one high-entropy bearer credential, store only its hash in PostgreSQL, and provide it to the daemon out of band. Pairing, rotation UI, and recovery are deferred; non-local connections require `wss://`.
5. **Browser authentication ambiguity:** `docs/architecture.md` assigns authentication/ownership to the API and `README.md` names Better Auth, but no auth behavior is specified. Recommended Phase 1 choice: keep the HTTP API local-development-only and loopback-bound, with a clearly documented single-user assumption; implement Better Auth before any hosted exposure. If hosted access is required for this slice, user auth/ownership must be added to scope first.
6. **Browser update mechanism:** resolve the triggering POST only after persistence, then refetch activity. Do not add browser WebSocket/SSE infrastructure yet.
7. **Status data minimization:** return aggregate counts and branch metadata, not changed-file paths. This satisfies status visibility while minimizing local metadata disclosure.
8. **Duplicate requests:** permit at most one in-flight Git-status request per project and return conflict for another; no queue is needed.
9. **Framework breadth:** use React/Vite, Fastify, Zod, PostgreSQL, and Drizzle now. Defer TanStack libraries, Tailwind/shadcn, OpenAPI/Scalar presentation, and Better Auth until their relevant behavior is approved. This narrows the broader README stack rather than replacing it.
10. **Local PostgreSQL:** add a PostgreSQL-only `compose.yaml` because a real database is essential to this slice; do not containerize web, API, or daemon.
11. **Protocol compatibility:** support protocol version 1 only and fail closed on incompatibility; backward compatibility is unnecessary before a released protocol exists.
12. **Git parser contract:** use porcelain v2 and derive aggregate status locally. Treat unusual/unsupported output as `GIT_STATUS_FAILED` rather than falling back to locale-dependent human output.
