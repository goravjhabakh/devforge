# Project

## Summary

AI Development Workspace is an AI-assisted software-development workspace for developers who want more structure than a generic coding chat but do not need another full IDE.

It helps a developer move from a vague idea to a real project, then continue development through project shaping, adaptive specs, coding-agent execution, review, and durable repository memory.

## Target users

Primary V1 user:

- solo developer
- comfortable using AI coding agents
- wants AI assistance without giving up engineering discipline or decision control

Future users:

- open-source users running the system locally/self-hosted
- SaaS users using a managed control plane
- teams and organizations using shared projects, policies, roles, approvals, and agent/tool registries

Team features are a future product direction, not V1 scope.

## Product principles

### AI proposes; user controls important decisions

The AI may recommend architecture, stack, workflow, spec depth, and agent/tool choices. Important or risky decisions should be reviewable and revisable by the user.

### Adaptive, not bureaucratic

Small work should stay small. The system should increase planning/specification only when complexity, risk, or scope requires it.

### Repository becomes the engineering source of truth

Before repo creation, planning state lives in the control plane. After bootstrap, architecture, specs, decisions, and progress should be recoverable from repo files.

### Coding agents are execution engines

The product orchestrates development; it does not need to replace OpenCode, Codex, Claude Code, or other coding agents.

## Three core ideas

The user does not choose one of these. The system combines all three and adjusts their depth per task.

1. **Spec-Driven Development**
2. **Agent Orchestration**
3. **Repo-as-Memory**

Example:

```text
tiny fix
→ minimal planning + repo context + execution

normal feature
→ lightweight spec + implementation + verification

major subsystem
→ discovery + architecture decision + detailed spec + stronger review
```

## V1 capabilities

### Project creation

- accept a vague software idea
- ask focused discovery questions
- create project scope and proposal
- recommend architecture and stack
- allow user revisions and approval
- propose repo/files before writing them
- bootstrap the repository through the local daemon

### Development workflow

- create work items for features, fixes, and refactors
- classify complexity/risk
- choose workflow steps dynamically
- choose adaptive spec depth
- generate execution context for a coding agent
- track execution state and events

### Agent execution

- OpenCode support first
- Codex support after the first agent path works
- adapter-based design so Claude Code and others can be added later
- one write-capable agent run per project in V1

### Review and completion

- inspect results and diff
- run appropriate checks
- surface failures and revisions
- update repo memory
- require approval where product policy says it matters

## V1 non-goals

- full code editor / Cursor clone
- arbitrary remote shell access
- existing-repo onboarding
- GitHub PR automation
- teams/organizations
- parallel writing agents
- generic workflow-builder UI
- remote development environments
- heavyweight search/vector infrastructure by default

## Product model

The product should support both:

- **managed SaaS** — hosted web/control plane/database; user runs local daemon
- **self-hosted OSS** — web/control plane/database via Docker; user still runs local daemon where repo access is needed

The same component boundaries should support both modes.
