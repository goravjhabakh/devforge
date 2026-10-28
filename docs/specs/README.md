# Specs

Implementation specs live here.

Use adaptive depth:

- trivial/local change: a formal spec may be unnecessary
- normal feature: lightweight spec
- architectural/risky/cross-cutting work: detailed spec

Suggested naming:

```text
001-repository-foundation.md
002-daemon-git-status-slice.md
003-repo-bootstrap.md
```

A spec should normally include:

- goal
- scope
- non-goals
- implementation requirements
- important constraints
- acceptance criteria
- checks/verification

Avoid repeating the entire project or architecture docs inside every spec. Link/reference them instead.
