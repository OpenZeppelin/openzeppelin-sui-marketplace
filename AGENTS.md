
# AGENTS.md

This file is guidance for AI coding agents working in this repository.
Keep changes minimal, aligned to existing patterns, and validated with the repo’s tooling.

## Project facts (read first)

- **Monorepo:** pnpm workspace (see `pnpm-workspace.yaml`).
- **Runtime:** Node **>= 22** (root `package.json`), ESM.
- **Language:** TypeScript, `strict: true`, `moduleResolution: NodeNext` (see `tsconfig.base.json`).
- **Formatting/Linting:** ESLint v9 + Prettier (root `eslint.config.mjs`).
- **Tests:** Vitest (unit + localnet integration).

## Workspace layering (explicit boundaries)

This repo is intentionally layered to keep browser-safe code free of Node built-ins.
Do not violate these boundaries; ESLint enforces them.

**Packages and intent** (see `docs/01-repo-layout.md`):

- `@sui-oracle-market/tooling-core` (packages/tooling/core): browser-safe utilities/types.
- `@sui-oracle-market/tooling-node` (packages/tooling/node): Node-only utilities (fs/process/CLI).
- `@sui-oracle-market/domain-core` (packages/domain/core): browser-safe domain SDK.
- `@sui-oracle-market/domain-node` (packages/domain/node): Node-only glue helpers.
- `packages/dapp`: scripts/CLI + Move package orchestration (Node).
- `packages/ui`: Next.js UI (browser).

**Hard rules** (enforced by ESLint):

- In `packages/domain/core` and `packages/tooling/core`: do **not** import `node:*` or Node built-ins.
- In `packages/ui` (and `packages/learn`): do **not** import Node built-ins or Node-only workspace packages.
- In `packages/tooling/node`: avoid importing from `@sui-oracle-market/domain-*`.

When implementing a feature, choose the lowest layer that can own it:

- Pure shared logic → `tooling-core` or `domain-core`.
- Node-only IO/CLI/process management → `tooling-node`.
- Localnet orchestration, scripts, publishing, seeding → `dapp`.
- UI behavior/components → `ui`.

## Coding style (repo conventions)

### General

- Prefer **small, composable functions** with meaningful names.
- Use **fully spelled, descriptive variable names**.
- Prefer **immutability**: `const` by default; avoid shared mutable module state.
- Prefer **composition over inheritance**; avoid deep class hierarchies.
- Keep functions **single-purpose**: parsing, normalization, validation, IO should be separate steps.
- Follow functional programming best practices
- Maximize reuse of existing helpers (search before writing new utilities).

### Functional programming bias

- Separate **pure** transformations from side effects.
- Favor helpers like `normalizeX`, `resolveX`, `parseX`, `buildX`, `assertX`, `requireX`.
- Keep dependencies explicit (pass `context`/`client`/`env` in rather than importing globals).

### TypeScript conventions

- This repo is **ESM**: keep import style consistent with nearby code.
- Prefer `type` imports for types (`import type { ... } from ...`).
- Avoid `any`; prefer narrow unions and helpers like `requireDefined` for runtime guards.
- Unused parameters/locals should be prefixed with `_` (ESLint ignores these).

### Predictable error handling

- Fail fast with actionable messages (include what input was missing/invalid).
- Prefer guard helpers (`assertX` / `requireX`) at boundaries:
	- CLI argument normalization
	- Network gating (e.g., localnet-only mocks)
	- Parsing script output
- Don’t swallow errors. If you catch, either:
	- add context and rethrow, or
	- convert to a typed/structured error that the caller handles explicitly.

## Tests (best practices for this repo)

### What to write

- Prefer **unit tests** for pure logic (fast, deterministic).
- Use **integration tests** only when behavior depends on localnet, scripts, publishing, or object ownership.

### Unit tests

- Domain unit tests: `pnpm --filter @sui-oracle-market/domain-core test:unit`.
- Dapp unit tests: `pnpm dapp test:unit`.
- Tooling unit tests: `pnpm tooling test:unit`.

Keep unit tests:

- deterministic (no real network)
- isolated (no shared state)
- explicit (assert on returned values/structures, not console output)

### Integration tests (localnet)

- Dapp integration: `pnpm dapp test:integration`.
- Tooling integration: `pnpm tooling test:integration`

Repo-standard patterns (see `docs/15-testing.md`):

- Use `createSuiLocalnetTestEnv({ mode: "suite" })` for suite-scoped localnet.
- Use `withTestContext(testId, async (context) => { ... })` for isolated test state.
- Prefer fixtures in `packages/dapp/src/utils/test-utils/helpers.ts` (e.g. `createShopFixture`,
	`createShopWithItemExamplesFixture`, `seedShopWithListingAndDiscount`).
- Prefer executing scripts via the script runner and parsing JSON output:
	- `runOwnerScriptJson` / `runBuyerScriptJson` wrappers
	- avoid log scraping
- Avoid sleeps; use deterministic waits and assertions (effects/events/ownership/object state).

Useful env toggles (integration):

- `SUI_IT_KEEP_TEMP=1` keep temp dirs/logs for debugging.
- `SUI_IT_WITH_FAUCET=0` disable faucet.
- `SUI_IT_SINGLE_THREAD=1` run integration tests single-threaded.

### Move tests

- Run Move tests via: `pnpm dapp move:test`.
- For oracle-related unit tests, prefer the Pyth mock’s test-only helpers as described in `docs/15-testing.md`.

## Linting, formatting, typecheck

From repo root:

- `pnpm lint` / `pnpm lint:fix`
- `pnpm typecheck`

Keep diffs focused:

- Don’t reformat unrelated files.
- Don’t change lockfiles unless dependencies change.

## Change checklist (agent workflow)

When you implement a change:

1. Identify the correct package/layer (core vs node vs dapp vs ui).
2. Reuse existing helpers/fixtures; keep new helpers small.
3. Add/adjust tests when behavior changes.
4. Run the narrowest validation that covers your change (then broader if needed):
	 - `pnpm --filter <pkg> test:unit`
	 - `pnpm --filter <pkg> test:integration` (when localnet is involved)
	 - `pnpm lint` and `pnpm typecheck`

