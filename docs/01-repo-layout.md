# 01 - Repo Layout + How to Navigate

**Path:** [Learning Path](./) > 01 Repo Layout + How to Navigate

Understand where Move code lives, how the CLI/scripts are organized, and how the workspace layering is enforced.

## 1. Repository layout

```
.
├── packages/
│   ├── dapp/
│   │   ├── contracts/                 # Move packages (oracle-market + mocks + examples)
│   │   │   ├── oracle-market/         # Main Move package (sui_oracle_market)
│   │   │   ├── pyth-mock/             # Local-only Pyth stub (dev/localnet)
│   │   │   ├── coin-mock/             # Local-only mock coins (dev/localnet)
│   │   │   └── item-examples/         # Example item types for listings/receipts
│   │   ├── src/
│   │   │   ├── scripts/               # CLI scripts (chain, owner, buyer)
│   │   │   └── utils/                 # Script-only helpers (e.g. CLI output formatting)
│   │   ├── deployments/               # Generated artifacts from scripts
│   │   ├── sui.config.ts              # Network + paths config for scripts
│   │   └── package.json               # Script entry points
│   ├── domain/
│   │   ├── core/                      # Browser-safe domain models + queries
│   │   └── node/                      # Node-only domain helpers (if needed)
│   ├── tooling/
│   │   ├── core/                      # Browser-safe utilities + types
│   │   └── node/                      # Node-only script helpers (fs/process/yargs/etc)
│   └── ui/
│       ├── src/app/                   # Next.js app router UI
│       ├── public/                    # Static assets
│       ├── dist/                      # Static export output (from `pnpm ui build`)
│       └── package.json               # UI scripts
├── pnpm-workspace.yaml                # Workspace definition
├── package.json                       # Root wrappers (`pnpm script`, `pnpm ui`)
├── tsconfig.json                      # TS project references
├── tsconfig.base.json                 # Shared TS config
├── tsconfig.node.json                 # Shared TS config for Node-only packages
└── eslint.config.mjs                  # Root lint config
```

What this means in practice:

- **`packages/dapp`** owns Move packages, CLI scripts, and generated state artifacts under `packages/dapp/deployments`.
- **`packages/domain/*`** is the domain SDK split into browser-safe `core` and Node-only `node`.
- **`packages/tooling/*`** is shared infra, script and integration test helpers split into browser-safe `core` and Node-only `node`.
- **`packages/ui`** is a Next.js UI that uses the same package IDs and Shop objects created by scripts.

## 2. Package intent and dependency rules

This workspace is intentionally layered so browser code stays browser-safe.

- **Base layer: `tooling-*`**
  - `@sui-oracle-market/tooling-core`: cross-environment utilities/types (browser-safe; no Node built-ins).
  - `@sui-oracle-market/tooling-node`: Node-only utilities (fs/process/CLI helpers). Must not import from `domain-*`.
- **Domain layer: `domain-*`**
  - `@sui-oracle-market/domain-core`: domain models, queries, and transaction builders usable in Node and UI.
  - `@sui-oracle-market/domain-node`: Node-only glue (artifact resolution, filesystem-backed helpers).
- **Application layers**
  - `packages/dapp`: scripts/CLI orchestration. May depend on `tooling-*` and `domain-*`.
  - `packages/ui`: browser-only app. Must depend only on `@sui-oracle-market/tooling-core` and `@sui-oracle-market/domain-core`.

## 3. Navigation

1. Previous: [00 Setup + Quickstart](./00-setup.md)
2. Next: [02 Mental Model Shift](./02-mental-model-shift.md)
3. Back to map: [Learning Path Map](./)
