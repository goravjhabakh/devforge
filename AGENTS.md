# AGENTS.md

This repository is built with AI coding agents, but the repo remains the engineering source of truth.

## Read this first

Before implementing a non-trivial change, read:

1. `docs/project.md`
2. `docs/architecture.md`
3. `docs/decisions.md`
4. `docs/progress.md`
5. the active file in `docs/specs/`, if one exists

Use `docs/roadmap.md` when work affects phase sequencing or scope.

## Working rules

- Keep changes focused on the current task or spec.
- Prefer the simplest design that satisfies current requirements.
- Do not add infrastructure for hypothetical future scale.
- Follow existing package boundaries instead of bypassing them.
- Keep control-plane logic separate from local-machine execution.
- The browser must never receive unrestricted filesystem or shell access.
- The control plane must not expose an unrestricted remote shell through the daemon.
- Validate network and protocol boundaries with shared schemas.
- Preserve the repo-as-memory documents when architecture or product behavior changes.
- Do not auto-commit unless explicitly requested.
- Do not rewrite unrelated code during a focused task.

## Development methodology

The project combines three ideas:

### Spec-driven development

Spec depth is adaptive:

- trivial/local change → direct implementation is acceptable
- normal feature → lightweight spec
- architectural, risky, or cross-cutting change → detailed spec

Do not create a large spec when the task does not justify one.

### Agent orchestration

The workflow is dynamic. Typical steps may include:

```text
discover → propose → approve → implement → verify → review → update memory
```

Not every task needs every step.

### Repo-as-memory

After repo bootstrap, durable engineering state lives primarily in the repository.

Update the relevant docs when a change affects:

- product scope → `docs/project.md`
- architecture → `docs/architecture.md`
- an important choice/trade-off → `docs/decisions.md`
- implementation sequencing → `docs/roadmap.md`
- current state / completed work / blockers → `docs/progress.md`

## Testing

Keep testing focused:

- unit tests for important pure logic and protocol validation
- integration tests for important boundaries
- a small number of meaningful end-to-end tests

Do not chase coverage percentage as a goal.

## Code quality

- TypeScript strict mode
- Zod at external/runtime boundaries
- Biome for formatting/linting
- clear error handling and useful logs
- avoid `any` unless justified
- prefer explicit contracts between packages

## Git

- use lightweight conventional commits when committing
- inspect the diff before committing
- do not commit secrets, tokens, generated credentials, or local machine state
- do not force-push or perform destructive Git actions without explicit approval

## Skills / MCPs / plugins

Do not load the entire tooling registry into every session.

Only enable tools relevant to the current work. Project-specific reusable skills may live under `.agents/skills/`.

Current likely capabilities include:

- system design / architecture
- spec-driven development
- MCP development
- agent security review
- browser/DevTools debugging
- AI evaluation when the AI workflow is implemented

Prefer a portable skill over a plugin, and a plugin over an MCP when no external system access is required.

## Completion checklist

Before declaring work complete:

- implementation matches the active task/spec
- relevant checks pass
- no obvious boundary/security regression was introduced
- docs were updated if behavior or architecture changed
- `docs/progress.md` reflects meaningful completed work
- summarize what changed, checks run, and any remaining limitations
