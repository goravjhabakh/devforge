# Decisions

Keep this file for decisions that materially affect architecture, product behavior, or development workflow. Do not record routine implementation details.

## D001 — Web workspace + local daemon

**Decision:** Use a browser-based workspace backed by a local daemon for machine-level execution.

**Why:** A pure SaaS application cannot safely access local repositories, Git, terminals, Docker, or coding-agent CLIs. A local daemon preserves a web/SaaS UX while keeping local execution on the developer machine.

## D002 — OSS/self-hostable core + managed SaaS

**Decision:** Design one architecture that can run as managed SaaS or self-hosted Docker deployment.

**Why:** Personal/self-hosted use is useful immediately, while managed hosting and teams are strong future product opportunities.

## D003 — Repository becomes authoritative after bootstrap

**Decision:** Before repo creation, the control-plane database owns planning state. After bootstrap, durable engineering context lives primarily in repo files.

**Why:** Coding agents need context close to the code, and the repository should remain usable without depending on the product database.

## D004 — Adaptive specs

**Decision:** Do not require a formal detailed spec for every change.

**Rule:**

- trivial work → direct implementation allowed
- normal work → lightweight spec
- large/risky/cross-cutting work → detailed spec

**Why:** SDD should improve discipline without creating unnecessary process.

## D005 — Dynamic workflow

**Decision:** Use opinionated default workflow stages but dynamically choose which steps are needed for each task.

**Why:** A bug fix and a new subsystem should not be forced through identical processes.

## D006 — AI proposes; user approves important decisions

**Decision:** AI can recommend architecture, stack, workflow, spec depth, and tools. Important/risky changes remain reviewable by the user.

**Why:** The product should increase developer leverage without hiding meaningful engineering decisions.

## D007 — Local Git first

**Decision:** V1 supports local Git workflows before GitHub integration.

**Why:** Git is required for core repo work; GitHub PRs/webhooks add integration complexity that is not required to prove the product.

## D008 — One write-capable agent run per project in V1

**Decision:** Do not support concurrent writing agents initially.

**Why:** This avoids coordination, locking, conflicting diffs, worktrees, and merge complexity before the core workflow is proven.

## D009 — OpenCode first, Codex second

**Decision:** Use a shared adapter contract; implement OpenCode first and Codex after the adapter model is proven.

**Why:** The product should not couple orchestration to one coding agent.

## D010 — No queue/workflow infrastructure initially

**Decision:** Do not start with Redis, BullMQ, Inngest, Trigger.dev, Kafka, or another workflow system.

**Why:** V1 has one write-capable run per project and can persist state in PostgreSQL. Add durable job infrastructure only when real failure/retry/concurrency needs justify it.

## D011 — TypeScript-first monorepo

**Decision:** Use TypeScript + Node.js across web, API, daemon, shared protocol, and initial agent integrations.

**Why:** Shared types/contracts reduce boundary friction and keep V1 understandable for a small team/solo developer.
