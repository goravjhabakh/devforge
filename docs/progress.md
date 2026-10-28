# Progress

## Current status

**Stage:** pre-implementation planning complete; repository bootstrap is next.

No implementation specs have been created yet.

## Completed planning

- product concept and target user defined
- three core development ideas locked:
  - spec-driven development
  - agent orchestration
  - repo-as-memory
- V1 user journey defined
- web workspace + local daemon architecture selected
- SaaS + self-hostable OSS product model selected
- source-of-truth boundary defined
- adaptive spec strategy selected
- dynamic workflow strategy selected
- OpenCode + Codex adapter direction selected
- local Git first selected
- one write-capable agent run per project selected
- V1 technology stack selected
- initial data model defined
- daemon protocol direction defined
- monorepo package boundaries defined
- implementation phases defined
- repository docs / agent-memory structure defined

## Current implementation target

Next milestone is **Phase 0 — Repository Foundation**.

Before implementation begins:

1. create the repository
2. add this documentation bundle
3. run `git init`
4. create Spec 001 for Phase 0
5. implement through the coding agent

## Current V1 architecture slice to prove

The first meaningful product milestone after foundation is:

```text
Browser
→ API
→ authenticated local daemon
→ local git status
→ persisted event
→ UI update
```

## Open items

These do not block Phase 0:

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
