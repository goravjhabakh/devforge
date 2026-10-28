# Spec 001 — Repository Foundation

## Goal

Establish the smallest pnpm/TypeScript monorepo baseline for the initial apps and packages in Phase 0. Every workspace project must build, type-check, lint, format-check, and participate in the test command from the repository root.

This spec follows `docs/architecture.md` and the Phase 0 boundaries in `docs/roadmap.md`.

## Scope

- Configure a pnpm workspace for `apps/*` and `packages/*`.
- Add strict shared TypeScript settings and project-specific configurations.
- Add compile-only shells for:
  - `apps/web`
  - `apps/api`
  - `apps/daemon`
- Add buildable package shells for:
  - `packages/protocol`
  - `packages/contracts`
  - `packages/db`
  - `packages/config`
- Configure Biome for formatting and linting.
- Configure a Vitest baseline that discovers future `*.test.ts` files and succeeds before tests exist.
- Add root scripts for build, type-check, lint, formatting, tests, and the complete quality check.
- Add a minimal `.gitignore` and commit the pnpm lockfile.

## Non-goals

- Product behavior, UI components, HTTP/WebSocket servers, daemon capabilities, or protocol messages.
- Selecting or installing a web framework, API framework, database client/ORM, or runtime validation library.
- Database schemas, migrations, or a PostgreSQL container.
- Environment loading or application-specific environment variables.
- Docker Compose, CI workflows, deployment configuration, or release tooling. These remaining Phase 0 items can be specified separately when needed.
- Cross-package domain contracts or dependencies beyond the workspace structure.

## Planned files

```text
.gitignore
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
biome.json
vitest.config.ts

apps/
  web/
    package.json
    tsconfig.json
    src/main.ts
  api/
    package.json
    tsconfig.json
    src/index.ts
  daemon/
    package.json
    tsconfig.json
    src/index.ts

packages/
  protocol/
    package.json
    tsconfig.json
    src/index.ts
  contracts/
    package.json
    tsconfig.json
    src/index.ts
  db/
    package.json
    tsconfig.json
    src/index.ts
  config/
    package.json
    tsconfig.json
    src/index.ts
```

No `.env.example` is planned because this foundation introduces no environment variables. Add one with documented, non-secret placeholders when the first variable is introduced.

## Implementation steps

1. Create the private root `package.json`, pin pnpm through `packageManager`, declare the supported Node.js version, and add TypeScript, Biome, Vitest, and Node type definitions as development dependencies.
2. Add `pnpm-workspace.yaml` with only `apps/*` and `packages/*` workspace globs, then generate and commit `pnpm-lock.yaml` using a frozen dependency set.
3. Add `tsconfig.base.json` with strict TypeScript, ESM, modern Node-compatible output, consistent casing, declaration/source-map support where applicable, and safety options including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
4. Add one `tsconfig.json` per workspace project. The web config includes browser libraries; API and daemon configs include Node types; shared packages emit declarations. All emitted files go to project-local `dist/` directories.
5. Add private workspace manifests for the three apps and named workspace manifests for the four packages. Each project exposes local `build` and `typecheck` scripts; packages expose only their compiled public entry point.
6. Add minimal source entry points that contain no product behavior. Package entry points are empty public barrels until a later phase defines their contracts.
7. Configure Biome for repository-wide TypeScript/JSON formatting and linting while excluding generated output and dependencies.
8. Configure Vitest to discover TypeScript unit tests across apps and packages. The root test command uses `--passWithNoTests` only for this empty baseline; remove that flag when the first test is added.
9. Add root scripts with these responsibilities:
   - `build`: build every workspace project.
   - `typecheck`: type-check every workspace project without emitting.
   - `lint`: run Biome lint checks.
   - `format`: apply Biome formatting.
   - `format:check`: verify formatting without writes.
   - `test`: run Vitest once.
   - `check`: run formatting, linting, type-checking, tests, and builds from the root.
10. Add a minimal `.gitignore` for dependencies, build output, coverage, logs, local environment files, and common OS/editor artifacts. Keep `.env.example` explicitly committable.

## Acceptance criteria

- pnpm recognizes exactly the three initial apps and four initial packages as workspace projects.
- Every app and package has a strict TypeScript configuration and builds to its own `dist/` directory.
- Shared packages have explicit compiled entry points and declaration output; no package exposes source files as its runtime entry point.
- The web shell is browser-typed, while API and daemon shells are Node-typed.
- No app contains product behavior and no package contains premature domain, protocol, database, or configuration APIs.
- Biome checks all authored repository code and configuration without inspecting dependencies or generated files.
- Vitest is ready to discover tests anywhere under `apps/` and `packages/`.
- Root build and quality scripts run successfully on a clean install.
- Local secrets, `.env` files, dependencies, generated output, and coverage artifacts are ignored.
- No Docker, CI, framework, database, or runtime infrastructure is introduced.

## Validation commands

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm check
```

For clean-install verification, remove only generated dependency/build directories, reinstall with the frozen lockfile, and rerun `pnpm check`.

## Assumptions and decisions requiring approval

Approve these before implementation:

1. **Runtime baseline:** use Node.js 24.22.1 LTS and pnpm 12.16.1, pinned as `pnpm@12.16.1` in `packageManager`.
2. **Module format:** use ESM throughout the workspace.
3. **Framework-neutral shells:** Phase 0 will compile plain TypeScript entry points; React/Vite, an API server framework, and runnable development servers remain later decisions.
4. **Empty test baseline:** temporarily allow `pnpm test` to pass with no tests, and remove that allowance when the first meaningful test lands.
5. **No environment example yet:** omit `.env.example` until a real variable is required.
6. **Narrow Phase 0 slice:** Docker Compose and CI are listed in the broader roadmap phase but are intentionally outside this initial foundation spec.
