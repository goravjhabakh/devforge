# Spec 003 — Repository Bootstrap and Approvals

## 1. Goal

Allow the control plane to propose a deterministic initial structure for a new project repository, show the exact effective operations to the developer, require explicit approval of an immutable plan, and have the local daemon apply and verify only that approved plan inside its configured project root.

This Phase 2 slice extends the Phase 1 typed daemon boundary with one narrow write capability. It does not create a general filesystem or approval framework.

## 2. User-visible outcome

For a project bound to a daemon-local, pre-created empty directory, the developer can:

1. generate a fixed bootstrap proposal;
2. inspect every relative directory, file path, complete UTF-8 file content, content hash, and the optional `git init` operation;
3. explicitly approve that exact plan;
4. see bootstrap progress and a persisted success or safe failure result; and
5. retry the same approved plan after a timeout or partial failure without approving it again.

No absolute local path is shown to or accepted from the browser or API.

## 3. Scope

- A deterministic, API-owned baseline repository template generated from persisted project metadata.
- Immutable, versioned bootstrap plans persisted with a canonical SHA-256 hash.
- Exact plan preview and explicit approval in the web app.
- A bootstrap-specific approval record and project bootstrap state.
- One typed `bootstrap.apply` daemon capability.
- Safe creation of approved directories and UTF-8 text files under the bound root.
- Optional direct Git initialization with the initial branch `main`.
- Strict path, root, symlink, junction, reparse-point, conflict, and size validation.
- Preflight checks, post-write verification, persisted activity, and safe partial-failure reporting.
- Exact-plan retry/resume behavior.

The destination is established out of band: the developer creates an empty directory and adds it to the daemon's existing local binding configuration. This is a Phase 2 setup seam, not existing-repository onboarding.

## 4. Non-goals

- AI project shaping or AI-generated architecture, stack, files, or content.
- User-authored or arbitrary file plans.
- Existing-repository import, merge, migration, or onboarding.
- Work items, adaptive specs, coding-agent execution, or a generic workflow engine.
- Arbitrary filesystem editing, path selection in the browser, shell commands, or terminal access.
- Git commits, configuration, hooks, remotes, push, GitHub integration, or branch management beyond initial `main`.
- Teams, roles, policies, reusable approval rules, or production authentication work.
- Binary files, permissions/mode changes, deletes, renames, overwrites, or file reads outside verification of this plan.
- Complex transactional rollback, snapshots, backups, or cleanup of partial results.
- Template marketplace, plugins, or a general template system.

## 5. Architecture / request flow

1. The daemon starts with the existing local `{ projectId, bindingId, repositoryRoot }` configuration. The bootstrap root must already exist as a real, empty directory and must not be a symlink, junction, or other reparse point.
2. `daemon.hello` advertises `bootstrap.apply` in addition to existing capabilities. The API accepts the binding only when project, daemon, and opaque binding IDs match persisted assignment.
3. The web app requests a proposal for the project and chooses only whether Git initialization is included. It sends no paths, file operations, or file contents.
4. The API renders the fixed baseline template from persisted project metadata, validates it, creates the next immutable plan revision, computes its canonical hash, persists it as `awaiting_approval`, and supersedes any older unexecuted plan.
5. The web app retrieves and displays the complete plan. Relative paths and full file contents are visible; the local root is not.
6. The developer approves by submitting the displayed `planId` and `planHash`. The API atomically verifies that the plan is the latest approvable revision, stores an approval tied to that hash, and marks the plan `approved`.
7. The API persists `bootstrap.requested`, marks the plan `executing`, and sends a typed `bootstrap.apply` command containing the immutable plan and hash. The first dispatch uses `mode: "initial"`; later dispatches of the same approved plan use `mode: "resume"`.
8. The daemon verifies project/binding authorization, recomputes the hash, revalidates the configured root and every operation, and completes all possible preflight checks before writing.
9. The daemon creates only approved directories and files in operation order, optionally invokes Git directly with fixed arguments, and verifies the resulting tree and file hashes.
10. The daemon returns a typed success or safe failure with operation-level outcomes. It never returns an absolute path or file content.
11. The API correlates the response, persists terminal activity and plan state, then completes the HTTP request. The web app refetches persisted state and renders completion, failure, or retry availability.

As in Phase 1, the triggering HTTP request may remain open for a bounded command timeout. There is no queue or automatic replay. An API restart or timeout can make the outcome uncertain; the UI presents a safe failure and permits an explicit exact-plan retry after the original command timeout has elapsed.

## 6. Data model changes

Use UUIDs and UTC timestamps. Commit a Drizzle migration.

### `projects`

Add `bootstrapState` with values:

- `not_started`
- `awaiting_approval`
- `approved`
- `executing`
- `succeeded`
- `failed`

Existing Phase 1 seeded repositories migrate to `succeeded`. A new Phase 2 bootstrap fixture starts at `not_started`. This field is a current-state projection; plans, approvals, and events remain the durable history.

### `bootstrap_plans`

- `id` — UUID primary key.
- `projectId` — foreign key to `projects`.
- `revision` — positive integer, unique per project.
- `schemaVersion` — initially `1`.
- `planHash` — lowercase SHA-256 hex digest.
- `document` — JSONB validated with the shared HTTP plan schema before write and after read.
- `status` — `awaiting_approval`, `approved`, `executing`, `succeeded`, `failed`, or `superseded`.
- `attemptCount` — starts at zero and increments transactionally before each dispatch.
- `lastError` — nullable JSONB safe error summary; no local path or raw process output.
- `createdAt`, `updatedAt`, `completedAt` (nullable).

The document and hash are never updated. Status, attempt count, terminal metadata, and timestamps may change. Changing Git initialization or any generated operation creates a new revision and requires a new approval.

### `bootstrap_approvals`

- `id` — UUID primary key.
- `projectId` — foreign key to `projects`.
- `planId` — unique foreign key to `bootstrap_plans`.
- `planHash` — the exact approved hash.
- `approvedAt`.

V1 is explicitly single-user/local-development-only, so no actor or policy model is added. The approval exists only for this bootstrap plan and cannot authorize another revision.

### `events`

Reuse the existing activity table and correlation model. Add validated event payloads for:

- `bootstrap.plan_created` — plan ID, revision, and hash;
- `bootstrap.approved` — plan ID, revision, and hash;
- `bootstrap.requested` — plan ID, hash, attempt number, and mode;
- `bootstrap.succeeded` — plan ID, hash, attempt number, counts, and Git result;
- `bootstrap.failed` — plan ID, hash, attempt number, safe code/message, and completed operation counts.

Events contain relative path summaries only when useful for a failure; they never contain file contents or absolute roots.

## 7. Bootstrap plan model

`packages/contracts` owns the HTTP plan document schema and canonical serialization rules. `packages/protocol` reuses that schema for `bootstrap.apply` rather than defining a second shape.

```ts
type BootstrapPlanDocument = {
  schemaVersion: 1
  projectId: string
  bindingId: string
  operations: Array<
    | { type: "directory.create"; path: string }
    | {
        type: "file.write"
        path: string
        encoding: "utf8"
        content: string
        contentSha256: string
        sizeBytes: number
      }
    | { type: "git.init"; initialBranch: "main" }
  >
}
```

The fixed baseline contains no language/framework choice and creates:

```text
README.md
AGENTS.md
docs/
docs/project.md
docs/architecture.md
docs/decisions.md
docs/roadmap.md
docs/progress.md
docs/specs/
docs/specs/README.md
```

Directory operations are explicit even when later file operations would create their parents. Template contents are deterministic, minimal starter text based only on the project name, use LF line endings with a final newline, and contain no secrets. The template source is ordinary API code covered by snapshot/unit tests; it is not a plugin system.

The optional `git.init` operation is last. The preview explains that Git creates implementation-defined metadata under `.git`; Git-owned internal files are not modeled individually.

Canonical hashing uses UTF-8 bytes of a documented canonical JSON representation with recursively sorted object keys while preserving operation order. The hash covers `schemaVersion`, `projectId`, `bindingId`, and every operation including complete file content. Both API and daemon recompute it independently.

V1 limits are enforced by both API and daemon: at most 100 operations, 50 files, 256 KiB per file, 1 MiB total file content, and 240 UTF-8 bytes per relative path. Duplicate paths and case-insensitive path collisions are rejected.

## 8. Approval model

- Only the latest `awaiting_approval` plan for a project can be approved.
- The approval request includes both `planId` and the hash displayed by the UI.
- Approval creation and transition to `approved` occur in one database transaction.
- An approved plan document is immutable. No endpoint edits it.
- Creating a replacement plan marks an unexecuted prior plan `superseded`; an executing or succeeded plan cannot be replaced.
- Approval does not authorize arbitrary future operations. The daemon command must carry the same plan ID, document, and hash.
- Retry reuses the same approval only when the document and hash are unchanged.
- Only one bootstrap dispatch may be in flight per project. Duplicate approval or execution submissions return the current persisted state rather than dispatching a second command.

## 9. Protocol messages

Keep protocol version `1` during unreleased development and extend its strict discriminated unions. `daemon.hello.capabilities` may include `bootstrap.apply`.

### `command.request` — `bootstrap.apply`

Contains existing `requestId`, `projectId`, and `bindingId` correlation fields plus:

```ts
{
  type: "bootstrap.apply"
  planId: string
  planHash: string
  mode: "initial" | "resume"
  plan: BootstrapPlanDocument
}
```

There is no executable, working directory, absolute path, argument list, or free-form command field.

### `command.result` — `bootstrap.apply`

Returns matching correlation fields, `commandType: "bootstrap.apply"`, plan ID/hash, timestamps, verified operation counts, whether resume reused exact entries, and whether a valid `main` Git repository was initialized. It does not echo contents or local paths.

### `command.error` — `bootstrap.apply`

Returns matching correlation and plan fields, timestamps, completed/reused operation counts, and one safe code:

- `BINDING_NOT_ALLOWED`
- `ROOT_NOT_FOUND`
- `ROOT_NOT_DIRECTORY`
- `TARGET_NOT_EMPTY`
- `PLAN_HASH_MISMATCH`
- `PLAN_INVALID`
- `PLAN_LIMIT_EXCEEDED`
- `PATH_INVALID`
- `PATH_OUTSIDE_ROOT`
- `LINK_NOT_ALLOWED`
- `ENTRY_CONFLICT`
- `FILE_WRITE_FAILED`
- `GIT_NOT_FOUND`
- `GIT_INIT_FAILED`
- `VERIFICATION_FAILED`
- `BOOTSTRAP_FAILED`

Existing `git.status` message behavior remains typed and unchanged. Result/error schemas must be discriminated by command type instead of widening Git-status payloads with optional bootstrap fields.

## 10. API responsibilities

- Expose narrow endpoints equivalent to:
  - `POST /api/projects/:projectId/bootstrap/plans` with `{ initializeGit: boolean }` only;
  - `GET /api/projects/:projectId/bootstrap` for current plan, preview, approval, state, and recent activity;
  - `POST /api/projects/:projectId/bootstrap/plans/:planId/approve` with `{ planHash }`;
  - `POST /api/projects/:projectId/bootstrap/plans/:planId/execute` with `{ planHash }` for an approved plan that has not yet been dispatched;
  - `POST /api/projects/:projectId/bootstrap/plans/:planId/retry` with `{ planHash }`.
- Generate all operations server-side from the fixed template; reject client-supplied paths, operations, or contents.
- Validate file hashes/sizes, canonicalize the plan, compute its hash, and persist immutable revisions.
- Return complete file contents in the authenticated plan preview because exact content is required for meaningful approval. Do not log plan contents.
- Enforce plan state transitions, latest-revision approval, one in-flight dispatch per project, and unchanged-hash retry.
- Require a connected daemon with the matching accepted binding and `bootstrap.apply` capability before dispatch.
- Persist requested activity and increment `attemptCount` before dispatch. First attempt uses `initial`; all later attempts use `resume`.
- Correlate responses by request, daemon, project, binding, command type, plan ID, and plan hash.
- Persist terminal event and project/plan state before completing the HTTP request.
- Apply a bounded timeout and clear pending requests on disconnect. Never automatically replay a write command.
- Extend project detail only as needed to expose bootstrap state without returning the binding ID or local root to the browser.

Approval immediately dispatches the first attempt when prerequisites are available. If they are unavailable, approval remains valid, the plan remains `approved`, and the UI uses the execute endpoint when the daemon becomes available; no second approval is required. The execute endpoint is valid only while `attemptCount` is zero; later attempts use the retry endpoint and `mode: "resume"`.

## 11. Daemon responsibilities

- Advertise `bootstrap.apply` only when the implementation is available.
- Reuse the Phase 1 project/binding allowlist; accept no network-supplied root.
- At startup and before each bootstrap, require the configured root to exist and be a directory, canonicalize it, and reject a root that is a symlink, junction, or reparse point.
- Recompute and compare the canonical plan hash before any filesystem or Git operation.
- Validate the entire plan independently, including project/binding identity, operation types/order, paths, hashes, byte sizes, limits, duplicates, and collisions.
- Complete preflight before writes: root/link checks, initial emptiness or resume compatibility, parent relationships, Git availability when requested, and expected conflicts.
- Apply only the ordered typed operations. Create directories without recursion outside explicit planned parents. Create files exclusively from the approved UTF-8 bytes; never overwrite or append.
- Invoke Git directly with `shell: false` and fixed arguments equivalent to `git -C <root> init --initial-branch=main`, with timeout and output limits. Do not return raw output or stderr.
- Verify every planned directory, exact file byte hash and size, absence of unapproved top-level entries, and—when requested—a valid repository whose unborn/current branch is `main`. `.git` is the only allowed Git-created tree.
- Return bounded operation-level outcomes and safe errors. Never return file contents, absolute paths, environment values, or unrestricted process output.

## 12. Web responsibilities

- Add a focused bootstrap view to the existing minimal project page.
- Allow only the `Initialize Git repository` choice before generating a plan.
- Show plan revision/hash, every operation in execution order, full file contents, content hashes/sizes, and a clear explanation of Git metadata.
- Require a distinct **Approve and create repository** action; viewing or generating a plan is not approval.
- Submit the displayed plan ID/hash and prevent duplicate actions.
- Render states for loading, no plan, awaiting approval, approved/waiting for daemon, executing, succeeded, failed, and retrying.
- Disable approval if the displayed plan is stale or superseded. Any option change generates a new plan and returns the UI to awaiting approval.
- On failure, show the safe message, whether partial changes may remain, and offer retry only for the unchanged approved plan.
- Refetch persisted state after completion; do not communicate with the daemon or filesystem directly.

## 13. Filesystem/security boundaries

- Absolute repository paths remain solely in daemon-local configuration and never enter protocol, HTTP, database, browser state, activity, or logs.
- Plan paths use normalized relative POSIX separators. Reject empty/absolute paths, `.`, `..`, empty segments, backslashes, NUL/control characters, drive/UNC prefixes, trailing dot/space segments, Windows reserved device names, and non-portable path collisions.
- Resolve each candidate against the canonical configured root and require strict containment. String-prefix checks alone are insufficient.
- Use `lstat`-style checks on the root and each existing path component. Reject symbolic links, junctions, and reparse points rather than following them. Recheck parent containment immediately before creation and verify the result afterward.
- File creation uses exclusive semantics. Directory creation fails if an entry of another type exists. No operation follows a newly introduced link.
- These checks protect the remote-control boundary; portable Node.js filesystem APIs cannot make the full multi-file sequence atomic against a malicious concurrent local process. Concurrent local mutation of the bootstrap root is unsupported and causes best-effort failure, not a guarantee of race-proof isolation.
- File contents cross the API → daemon boundary only inside the explicitly approved `bootstrap.apply` plan. This is a deliberate expansion from Spec 002's Git-status data-minimization rule, not permission for general reads or writes.
- Fixed template contents are non-secret. Plans and previews must not be logged wholesale.

## 14. Conflict / overwrite / retry behavior

### Initial execution

- The target root must contain no entries at preflight, including `.git` and hidden/system entries.
- Any entry causes `TARGET_NOT_EMPTY`; nothing is written.
- There is no overwrite, merge, delete, backup, or force option.

### Resume execution

- Resume is allowed only for a previously dispatched, still-approved plan with the same hash.
- A planned directory already present as a real directory is reused.
- A planned file already present is reused only when its exact byte size and SHA-256 hash match the approved content.
- A missing operation is applied normally.
- Any different content/type, extra non-Git entry, link/reparse point, or incompatible Git state causes `ENTRY_CONFLICT` (or the more specific safe code) and no further operations run.
- If Git was requested and `.git` already exists, it is reused only if verification shows a valid repository rooted at this target with branch `main`; otherwise retry fails. If Git was not requested, any `.git` entry is a conflict.

### Partial failure

- Preflight minimizes partial writes, and Git initialization runs last, but filesystem/Git failures can still leave completed operations.
- V1 performs no rollback. Removing successfully written files could destroy concurrent local work and would add transactional complexity explicitly outside scope.
- The daemon stops at the first failure, verifies and reports bounded completed/reused counts, and the API persists `failed` state/activity.
- The UI clearly states that partial files may remain and offers exact-plan resume. A changed plan always requires a new empty target and new approval; it cannot adopt or overwrite partial output.

## 15. Planned files/packages

No new workspace package or infrastructure service is justified. Exact internal filenames may vary while preserving these boundaries.

```text
apps/web/
  src/App.tsx
  src/api.ts
  src/*.test.tsx

apps/api/
  src/routes/projects.ts
  src/routes/bootstrap.ts              # may be split from project routes
  src/bootstrap/template.ts
  src/bootstrap/plan.ts
  src/daemon/pending-requests.ts
  src/daemon/websocket.ts
  src/*.test.ts

apps/daemon/
  src/binding-registry.ts
  src/command-handler.ts
  src/bootstrap.ts
  src/git-init.ts
  src/*.test.ts

packages/contracts/
  src/bootstrap.ts
  src/projects.ts
  src/activity.ts
  src/index.ts
  src/*.test.ts

packages/protocol/
  src/messages.ts
  src/index.ts
  src/*.test.ts

packages/db/
  src/schema.ts
  src/seed.ts
  migrations/*
  src/*.test.ts

packages/config/
  src/daemon.ts                       # stricter bootstrap-root validation as needed

docs/progress.md                     # update after implementation only
docs/architecture.md / decisions.md  # update only for durable approved changes
```

## 16. Implementation sequence

1. Add shared bootstrap plan, preview, activity, API, and protocol schemas plus canonical hashing tests.
2. Add the database migration, fixed baseline template, immutable plan generation, and persistence/state-transition tests.
3. Add proposal, retrieval, approval, and retry routes using a fake daemon connection; verify transaction ordering, immutability, correlation, timeout, and duplicate handling.
4. Extend capability negotiation and pending-request correlation for command-specific bootstrap results/errors without weakening `git.status`.
5. Implement daemon plan validation, root/link/path checks, initial and resume preflight, exclusive writes, fixed Git initialization, and verification.
6. Add focused integration tests using temporary directories outside the product repository, including Windows junction/reparse coverage where supported.
7. Implement the exact-preview and approval UI with explicit pending, terminal, partial-failure, and retry states.
8. Run the complete flow with the real API, daemon, PostgreSQL, filesystem, and Git; perform browser verification.
9. Run root quality checks, review the security boundary and diff, and update repo-memory documents affected by the implementation.

## 17. Acceptance criteria

- The API generates only the fixed baseline plan and accepts no browser-supplied path, operation, or file content.
- The UI shows every effective relative operation and complete file content before enabling explicit approval.
- Approval is persisted against the exact immutable plan hash; changing any operation or option creates a new revision requiring approval.
- The daemon receives no absolute path and applies the plan only to the locally configured matching project/binding root.
- First execution rejects every non-empty target without writing or initializing Git.
- Invalid/traversing/non-portable paths, duplicate/colliding paths, plan/hash mismatches, limits, and symlink/junction/reparse-point cases fail before writes where detectable.
- Files are created exclusively with bytes matching the preview; no existing file is overwritten.
- Optional Git initialization uses direct fixed arguments, creates branch `main`, and performs no commit or other Git action.
- Post-write verification confirms exact planned directories/files and Git state before success is reported.
- Requested and terminal activity and plan/project states are persisted before the HTTP response completes.
- Timeout, disconnect, Git absence/failure, write failure, conflict, and verification failure produce bounded safe errors without leaking roots, contents, or raw process output.
- A retry of the same approved plan reuses exact completed operations, creates missing ones, and rejects every mismatch or extra entry.
- Partial failure performs no rollback and is clearly represented in persisted state and UI.
- Duplicate concurrent bootstrap dispatches are prevented and no write command is automatically replayed.
- Existing Git-status behavior remains functional for already bootstrapped Phase 1 projects.
- No AI, arbitrary editing/shell, existing-repo import, commit, remote, agent, queue, generic approval engine, or new workspace package is introduced.

## 18. Validation/testing strategy

### Unit tests

- Plan schema, deterministic template rendering, canonical JSON, and hash parity between API and daemon.
- Approval/state transitions, superseding, unchanged-hash retry, and duplicate submission behavior.
- Relative path normalization/rejection, containment, case collisions, reserved names, operation ordering, and limits.
- Initial empty-root and resume exact-match preflight.
- Safe error mapping and protocol discrimination for both `git.status` and `bootstrap.apply`.

### Integration tests

- Fastify routes with PostgreSQL and a fake authenticated daemon: event ordering, approval immutability, dispatch correlation, timeout/disconnect, and terminal persistence.
- Real daemon with temporary directories: successful bootstrap with and without Git, exact bytes, `main` branch, and post-write verification.
- Non-empty root, traversal, symlink, junction/reparse point where supported, file/type conflict, missing Git, write failure, partial failure, exact resume, mismatched resume, and extra-entry rejection.
- Tests never bootstrap into or modify the product repository.

### Browser test

One focused Playwright flow verifies proposal generation, full operation/content preview, explicit approval, executing/success UI, persisted state after reload, and a safe failed/retry state.

Expected commands remain the repository's existing focused test commands plus:

```sh
pnpm db:migrate
pnpm test
pnpm check
pnpm test:integration   # if introduced by implementation
pnpm test:e2e           # if introduced by implementation
```

## 19. Assumptions and approved decisions

1. **Destination:** bootstrap uses a pre-created empty daemon-local root in the existing opaque binding model. Phase 2 adds no path picker, workspace-root model, or registration flow.
2. **Initial conflicts:** the first attempt requires a strictly empty directory and never overwrites or merges.
3. **Proposal source:** the API generates one deterministic, framework-neutral baseline template. The browser controls only optional Git initialization.
4. **Retry:** later attempts resume only the exact approved plan, reuse exact matches, and fail on any mismatch.
5. **Links:** the configured bootstrap root and all entries/components must be real directories/files, not symlinks, junctions, or reparse points.
6. **Git:** optional initialization uses fixed direct Git arguments and initial branch `main`; there is no commit, config, hook, or remote behavior.
7. **Immutability:** canonical SHA-256 binds approval, dispatch, and result to the full effective plan. Any change creates a new revision and requires re-approval.
8. **Rollback:** V1 uses comprehensive preflight and exact resume, not transactional rollback.
9. **Persistence:** narrow bootstrap plan and approval records plus existing activity events are sufficient; no generic workflow/approval infrastructure is added.
10. **Authentication:** Phase 1's loopback, single-user development assumption remains. Phase 2 must not be presented as production-ready or hosted until browser authentication/ownership is implemented.
11. **File-content boundary:** unlike the read-only Git-status slice, approved bootstrap contents intentionally travel from API to daemon. Absolute roots and all unapproved local filesystem data remain daemon-local.
12. **No documentation conflict:** the implementation remains consistent with repository authority beginning after successful bootstrap. Until verification succeeds, the control-plane plan is authoritative; after success, the created repo-memory files become the durable engineering source of truth.
