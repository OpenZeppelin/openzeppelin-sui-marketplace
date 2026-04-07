# Tooling Workspace Package

This folder contains shared tooling libraries used by scripts, tests, and SDK layers in this repository.

## Packages

- `@sui-oracle-market/tooling-core`
  - Browser-safe and Node-safe helpers.
  - Shared types, transaction builders, and chain data utilities.
- `@sui-oracle-market/tooling-node`
  - Node-only helpers.
  - Localnet orchestration, publish/build helpers, artifact IO, script execution, and integration test utilities.

## When to use each package

- Use `tooling-core` when code must run in both browser and Node environments.
- Use `tooling-node` for filesystem/process access, Sui CLI integration, and test harness utilities.

## Layout

```text
packages/tooling/
  core/
    src/
    test-unit/
  node/
    src/
    test-unit/
  deployments/
  test-helpers/
```

## Commands

Run from repository root:

```bash
pnpm tooling test:unit
pnpm tooling test:integration
pnpm --filter @sui-oracle-market/tooling-core test:unit
pnpm --filter @sui-oracle-market/tooling-node test:unit
```

## Related docs

- `docs/01-repo-layout.md`
- `docs/05-localnet-workflow.md`
- `docs/06-scripts-reference.md`
- `docs/15-testing.md`

## Notes

- This README intentionally stays high-level to reduce API drift.
- For exact exports and signatures, use TypeScript source in `packages/tooling/core/src` and `packages/tooling/node/src`.
