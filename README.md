# Sui Oracle Market – End-to-End Developer Guide

A practical onboarding guide for Solidity/EVM developers building and deploying the `sui_oracle_market` Move package. This repo is a pnpm workspace with Move packages, deployment scripts, and a Next.js UI. The README walks from a fresh clone to a full local flow (mock oracles + mock coins), then covers publishing to shared networks.

---

## Quickstart (TL;DR)

```bash
# 1) Clone and install
# (pnpm workspace install from the repo root)
git clone <your fork url> && cd sui-oracle-market
pnpm install

# 2) Create or reuse an address
sui client new-address ed25519
sui client active-address   # ensure the desired address is active

# 3) Configure this address in Sui config file or export
export SUI_ACCOUNT_ADDRESS=<0x...>
export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>

# 4) Start localnet (new terminal)
pnpm script chain:localnet:start --with-faucet

# 5) Seed mocks (coins + Pyth stub + price feeds)
pnpm script chain:mock:setup

# 6) Publish oracle-market with dev dependencies (local mocks)
pnpm script chain:publish-package --package-path oracle-market --dev
```

Optional UI (after publishing + creating a shop):
```bash
pnpm ui dev
```

If you hit errors, keep reading—every step is explained in detail with troubleshooting tips.

---

## Prerequisites

- **Node.js 22.19+** and **pnpm** for running scripts and the UI.
- **Sui CLI** on your `PATH` (see https://docs.sui.io/build/install).
- **Rust toolchain** (`rustup`) if you build Sui locally.
- **Git** for cloning and managing patches.
- A machine that can run a local Sui full node and faucet.

---

## Repository Layout

```
.
├── packages/
│   ├── dapp/
│   │   ├── move/                     # Move packages (oracle-market + mocks)
│   │   │   ├── oracle-market/         # Main Move package (sui_oracle_market)
│   │   │   ├── pyth-mock/             # Local-only Pyth stub (dev/localnet)
│   │   │   └── coin-mock/             # Local-only mock coins (dev/localnet)
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
│       ├── firebase.json              # Firebase hosting config
│       └── package.json               # UI scripts
├── pnpm-workspace.yaml                # Workspace definition
├── package.json                       # Root wrappers (`pnpm script`, `pnpm ui`)
├── tsconfig.base.json                 # Shared TS config
├── tsconfig.node.json                 # Shared TS config for Node-only packages
└── eslint.config.mjs                  # Root lint config
```

What this means in practice:
- **`packages/dapp`** is the backend automation package. It owns the Move packages, the CLI scripts, and the artifact output in `packages/dapp/deployments`.
- **`packages/domain/*`** contains shared domain models and read/query helpers (split into browser-safe `core` and Node-only `node`).
- **`packages/tooling/*`** contains shared infrastructure helpers (split into browser-safe `core` and Node-only `node`).
- **`packages/ui`** is a static-exported Next.js UI that connects to the same Move package and shop objects created by the scripts.

### Package intent and dependency rules

This repo is structured as a strict layered workspace to keep **high cohesion** and **low coupling**, and to ensure the UI only consumes browser-safe code.

- **Base layer: `tooling-*`**
  - `@sui-oracle-market/tooling-core`: cross-environment utilities/types (browser-safe; no Node built-ins).
  - `@sui-oracle-market/tooling-node`: Node-only utilities (fs/process/CLI helpers). Must not import from `domain-*`.
- **Domain layer: `domain-*`**
  - `@sui-oracle-market/domain-core`: domain models, queries, and transaction builders that can be used in both Node and the UI.
  - `@sui-oracle-market/domain-node`: Node-only domain glue (e.g. artifact resolution, filesystem-backed helpers). May depend on `domain-core` and `tooling-*`.
- **Application layers**
  - `packages/dapp`: scripts/CLI orchestration. May depend on `tooling-*` and `domain-*`.
  - `packages/ui`: browser-only app. Must depend only on `@sui-oracle-market/tooling-core` and `@sui-oracle-market/domain-core`.

Enforcement:
- ESLint is configured to block forbidden cross-layer imports.

---

## How to Run Scripts in This Repo

All commands are designed to run from the repo root.

- **Backend scripts (Move + CLI tooling):**
  - `pnpm script <script-name> [--flags]`
  - This is a thin wrapper for `pnpm --filter dapp <script-name>` and runs inside `packages/dapp`.
- **Frontend UI scripts:**
  - `pnpm ui <script-name>`
  - This is a wrapper for `pnpm --filter ui <script-name>`.

Example:
```bash
pnpm script chain:localnet:start --with-faucet
pnpm ui dev
```

---

## Frontend UI

The UI lives in `packages/ui` and is a static-exported Next.js 16 app (`output: "export"`) that renders the shop, listings, discounts, and checkout flows.

Configuration:
- Network + contract IDs are read from `packages/ui/src/app/config/network.ts`.
- Use `.env.local` inside `packages/ui` (or env vars) to set package + shop IDs per network:
  ```bash
  NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
  NEXT_PUBLIC_LOCALNET_SHOP_ID=0x...
  NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID=0x...
  NEXT_PUBLIC_TESTNET_SHOP_ID=0x...
  ```
- App name/description can be overridden via `NEXT_PUBLIC_APP_NAME` and `NEXT_PUBLIC_APP_DESCRIPTION`.

UI scripts (run from repo root with `pnpm ui ...`):

- `pnpm ui dev`
  - Starts the Next.js dev server (default `http://localhost:3000`).
  - Use this after localnet is running and you have set `NEXT_PUBLIC_*` IDs for the network you want to view.
- `pnpm ui build`
  - Creates a static export of the site into `packages/ui/dist`.
  - Required before any of the deployment scripts.
- `pnpm ui start`
  - Runs `next start` for production-mode preview (useful for sanity checks before deploying).
- `pnpm ui lint`
  - Runs ESLint across the UI codebase.
- `pnpm ui format`
  - Formats `packages/ui/src` with Prettier (JS/TS/TSX).

Deployment scripts:
- `pnpm ui deploy:firebase:init`
  - Logs into Firebase and runs `firebase use --add` to select the hosting project.
- `pnpm ui deploy:firebase`
  - Deploys the static `dist` export to Firebase Hosting using `firebase.json`.
- `pnpm ui deploy:walrus:testnet`
  - Builds the UI, then deploys the static export to Walrus testnet via `walrus-sites-deploy`.
- `pnpm ui deploy:walrus:mainnet`
  - Builds the UI, then deploys to Walrus mainnet via `walrus-sites-deploy`.
- `pnpm ui deploy:arweave`
  - Builds the UI with `ARWEAVE_DEPLOYMENT=true`, then deploys `packages/ui/dist` to Arweave using `arkb`.
  - Expects an `arweave-keyfile.json` in `packages/ui`.

---

## Sui Concepts for EVM Developers

- **Packages are immutable objects**: Publishing creates a package object; upgrades publish a new package + `UpgradeCap`. No proxy pattern.
- **Capabilities instead of `msg.sender`**: Auth is proved by owning capability objects (e.g., `ShopOwnerCap`).
- **Objects, not contract storage**: State is stored as owned/shared objects and dynamic fields, improving parallelism.
- **Typed coins**: `Coin<T>` types replace ERC-20 approvals; metadata comes from the Sui coin registry.
- **Oracles as objects**: Pyth prices are delivered as `PriceInfoObject` + clock checks; no address lookups.
- **Localnet vs testnet/mainnet**: Localnet is your sandbox with unpublished deps; shared networks require published package IDs in `Move.lock`.

---

## Environment Setup (from scratch)

### 1) Clone and install deps
```bash
git clone <your fork url> sui-oracle-market
cd sui-oracle-market
pnpm install
```

### 2) Configure Sui CLI and config file
- Create or reuse an address:
  ```bash
  sui client new-address ed25519
  sui client active-address   # ensure the desired address is active
  ```
- Optional: export keys as env vars (used by scripts):
  ```bash
  export SUI_ACCOUNT_ADDRESS=<0x...>
  export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>
  ```
- The script config lives at `packages/dapp/sui.config.ts` (loaded automatically when you run `pnpm script ...`).
  - `defaultNetwork`: default network name used when `--network` is not passed (localnet by default).
  - `networks[networkName]`: per-network settings:
    - `url`: RPC endpoint (auto-resolved if omitted).
    - `faucetUrl`: optional faucet override.
    - `gasBudget`: default publish gas budget for that network.
    - `move.withUnpublishedDependencies`: localnet-only switch for dev builds.
    - `account`: account configuration (env overrides preferred):
      - `keystorePath` (defaults to `~/.sui/sui_config/sui.keystore`)
      - `accountIndex` (index in keystore, default `0`)
      - `accountAddress`, `accountPrivateKey`, `accountMnemonic` (direct credentials)
    - `accounts`: optional named account map.
  - `paths`:
    - `move`: Move root (defaults to `packages/dapp/move` at runtime).
    - `deployments`, `objects`, `artifacts`: artifact output directories (defaults to `packages/dapp/deployments`).

How it’s used:
- Scripts load `sui.config.ts` to decide RPC URL, account, and artifact paths.
- `SUI_NETWORK` or `--network <name>` switches networks without editing files.
- Deploy artifacts are written under `packages/dapp/deployments`.

### 3) Start localnet
```bash
pnpm script chain:localnet:start --with-faucet
```
- Spawns `sui start --with-faucet` and waits for RPC readiness.
- Uses the `localnet` RPC from `sui.config.ts` (or `--network localnet`).
- Initializes/uses a persistent localnet config dir (default `~/.sui/localnet`) so state survives restarts.
- If the config dir is missing, it runs `sui genesis --with-faucet --working-dir <dir>` once before starting.

Note: running `sui start` without a stable config dir can regenesis and wipe local state; use `--config-dir` or delete the dir to reset intentionally.

### 4) Seed mocks (coins + Pyth)
```bash
pnpm script chain:mock:setup
```
What it does:
- Publishes `packages/dapp/move/pyth-mock` and `packages/dapp/move/coin-mock` if needed.
- Mints mock coins via the coin registry and funds your signer.
- Publishes mock Pyth price feeds with fresh timestamps.
- Writes artifacts to `packages/dapp/deployments/mock.localnet.json` for reuse.

### 5) Publish oracle-market (local/dev)
```bash
pnpm script chain:publish-package --package-path oracle-market --dev
```
What it does:
- Builds with `--dev` and unpublished dependencies for localnet.
- Publishes via the Sui CLI.
- Writes results to `packages/dapp/deployments/deployment.localnet.json`.

---

## Moving to Testnet/Mainnet

1) Replace mocks with real published packages:
   - Update `Move.lock` in `packages/dapp/move/oracle-market` to published Pyth/OpenZeppelin math IDs.
   - Remove `--dev`/`--with-unpublished-dependencies` when publishing.
2) Fund the publisher address with enough SUI.
3) Publish:
   ```bash
   pnpm script chain:publish-package --package-path oracle-market --network testnet
   ```
4) Record the `packageId`, `UpgradeCap`, and `publisherId` from `packages/dapp/deployments/deployment.testnet.json`.

---

## Script Reference

All backend scripts live under `packages/dapp/src/scripts` and run with:
```bash
pnpm script <script-name> [--flags]
```

Common flag (applies to all scripts that use the standard runner):
- `--network <name>`: override the network from `packages/dapp/sui.config.ts` (defaults to `localnet`).

Exceptions:
- `pnpm script chain:localnet:stop` has no CLI flags.
- `pnpm script chain:mock:get-currency` does not accept `--network` and is localnet-only.

### Chain + Localnet Scripts (infra + inspection)

#### `pnpm script chain:localnet:start`
- Boots `sui start`, waits for RPC health, logs a network snapshot, and (if `--with-faucet`) funds the configured signer after regenesis.
- Flags:
  - `--check-only`: probe the RPC and exit without starting a node; fails if unreachable.
  - `--wait-seconds <n>`: readiness timeout while waiting for RPC (default `25`).
  - `--with-faucet`: start `sui start --with-faucet` (default `true`).
  - `--force-regenesis`: passes `--force-regenesis` to `sui start` and clears `packages/dapp/deployments/*.localnet*` first.
  - `--config-dir <path>`: localnet config dir passed to `sui start --network.config` (default `~/.sui/localnet`).

#### `pnpm script chain:localnet:stop`
- Scans the process table for detached `sui start` processes and SIGTERMs them. No flags.

#### `pnpm script chain:mock:setup`
- Localnet-only seeding. Publishes/reuses `pyth-mock` + `coin-mock`, mints mock coins, and creates two mock Pyth price feeds. Writes artifacts to `packages/dapp/deployments/mock.localnet.json`.
- Flags:
  - `--coin-package-id <id>` / `--pyth-package-id <id>`: reuse existing mock package IDs instead of publishing.
  - `--coin-contract-path <path>` / `--pyth-contract-path <path>`: override Move package paths.
  - `--re-publish`: ignore existing artifacts; republish mocks and recreate feeds.

#### `pnpm script chain:publish-package`
- Builds and publishes a Move package under `packages/dapp/move`, skipping if a deployment artifact already exists unless `--re-publish` is set.
- Flags:
  - `--package-path <path>`: package folder relative to `packages/dapp/move` (required).
  - `--dev`: build with dev-dependencies (defaults to `true` on localnet; rejected on shared networks).
  - `--with-unpublished-dependencies`: allow unpublished deps (defaults to `true` on localnet; rejected on shared networks).
  - `--re-publish`: publish even if a deployment artifact already exists.

#### `pnpm script chain:mock:get-currency`
- Localnet-only coin registry inspection. If `--coin-type` is omitted it reads coin types from `packages/dapp/deployments/mock.localnet.json`.
- Flags:
  - `--registry-id <id>`: coin registry shared object (defaults to Sui registry).
  - `--coin-type <type>`: coin type(s) to inspect (repeatable; defaults to mock artifact coins).

#### `pnpm script chain:mock:update-prices`
- Localnet-only refresh of mock Pyth `PriceInfoObject`s to keep freshness checks valid.
- Flags:
  - `--pyth-package-id <id>`: override the Pyth mock package ID (defaults to the artifact).

#### `pnpm script chain:describe-address`
- Summarizes an address: SUI balance, all coin balances, stake totals, and a truncated owned-object sample.
- Flags:
  - `--address <0x...>`: address to inspect (required by CLI).

#### `pnpm script chain:describe-object`
- Fetches any object by ID and prints owner/version/digest plus content + display summaries.
- Flags:
  - `--object-id <id>`: target object ID (required; alias `--id`).

#### `pnpm script chain:describe-dynamic-field-object`
- Resolves a dynamic field child under a shared parent and prints the child object details.
- Flags:
  - `--parent-id <id>`: shared parent object ID (required).
  - `--child-id <id>`: dynamic field name/child object ID (required; alias `--name`).

### Shop Owner Scripts (commerce flows)

Owner scripts default `--shop-package-id`, `--shop-id`, and `--owner-cap-id` from the latest entries in `packages/dapp/deployments/objects.<network>.json` when omitted.

#### `pnpm script owner:shop:create`
- Calls `shop::create_shop` using a `0x2::package::Publisher` to create the shared `Shop` plus `ShopOwnerCap`.
- Flags:
  - `--shop-package-id <id>`: published `sui_oracle_market` package ID (defaults to the latest `sui_oracle_market` entry in `packages/dapp/deployments/deployment.<network>.json`).
  - `--publisher-cap-id <id>`: `0x2::package::Publisher` object ID (defaults to the same latest publish entry, with a fallback to `packages/dapp/deployments/objects.<network>.json` for older artifacts; alias `--publisher-id`).

#### `pnpm script owner:shop:update-owner`
- Rotates the shop owner/payout address via `shop::update_shop_owner`.
- Flags:
  - `--new-owner <0x...>`: address to become the new shop owner/payout recipient (required; aliases `--newOwner` / `--payout-address`).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:currency:add`
- Registers an accepted currency by linking a coin type to a Pyth feed with optional guardrail caps.
- Flags:
  - `--coin-type <0x...::Coin>`: coin type to accept (required).
  - `--feed-id <hex>`: 32-byte Pyth feed ID as hex (required).
  - `--price-info-object-id <id>`: shared Pyth `PriceInfoObject` ID (required; also passed as `pyth_object_id`).
  - `--currency-object-id <id>`: coin registry `Currency` object (defaults to the derived `CurrencyKey<T>`).
  - `--max-price-age-secs-cap <u64>` / `--max-confidence-ratio-bps-cap <u64>` / `--max-price-status-lag-secs-cap <u64>`: optional guardrail caps.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:currency:remove`
- Deregisters an accepted currency. Provide either the `AcceptedCurrency` object ID or a coin type to resolve it.
- Flags:
  - `--accepted-currency-id <id>`: specific AcceptedCurrency object ID to remove.
  - `--coin-type <0x...::Coin>`: coin type to resolve/remove when `--accepted-currency-id` is omitted.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.
  - One of `--accepted-currency-id` or `--coin-type` is required.

#### `pnpm script owner:item-listing:add`
- Creates an item listing with a USD price, stock count, Move item type, and optional spotlighted discount template.
- Flags:
  - `--name <string>`: item name (required; UTF-8 encoded).
  - `--price <usd-or-cents>`: USD string (`12.50`) or integer cents (`1250`) (required).
  - `--stock <u64>`: initial inventory (>0) (required).
  - `--item-type <0x...::Type>`: fully qualified item type (required).
  - `--spotlight-discount-id <id>`: optional discount template to spotlight on creation.
  - `--publisher-id <id>`: optional metadata-only field; not passed on-chain.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:item-listing:remove`
- Removes an `ItemListing` object.
- Flags:
  - `--item-listing-id <id>`: listing object ID to remove (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:item-listing:update-stock`
- Updates inventory for an existing listing; setting `0` pauses sales without removing the listing.
- Flags:
  - `--item-listing-id <id>`: listing object ID (required).
  - `--stock <u64>`: new quantity (required; can be zero).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:discount-template:create`
- Creates a reusable discount template with scheduling and optional listing scoping.
- Flags:
  - `--rule-kind <fixed|percent>`: discount rule type (required).
  - `--value <amount>`: USD value (fixed) or percentage (percent) (required).
  - `--starts-at <epoch-seconds>`: activation time (defaults to now).
  - `--expires-at <epoch-seconds>`: optional expiry (must be > `starts-at` when set).
  - `--max-redemptions <u64>`: optional redemption cap.
  - `--listing-id <id>`: optional ItemListing to pin this template to.
  - `--publisher-id <id>`: optional metadata-only field; not passed on-chain.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:discount-template:update`
- Rewrites a template’s rule/schedule/redemption cap using the on-chain clock.
- Flags:
  - `--discount-template-id <id>`: template object ID (required).
  - `--rule-kind <fixed|percent>` / `--value <amount>`: new rule type and value (required).
  - `--starts-at <epoch-seconds>`: new start time (defaults to now).
  - `--expires-at <epoch-seconds>`: optional new expiry.
  - `--max-redemptions <u64>`: optional new redemption cap.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:discount-template:toggle`
- Toggles a discount template’s active flag.
- Flags:
  - `--discount-template-id <id>`: template object ID (required).
  - `--active` / `--no-active`: desired activation state (required boolean flag).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:discount-template:prune-claims`
- Removes per-wallet claim markers for a finished template (expired or maxed).
- Flags:
  - `--discount-template-id <id>`: template object ID (required).
  - `--claimers <addr,addr,...>` / `--claimer <addr>`: claimer addresses to prune (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:item-listing:attach-discount-template`
- Attaches a discount template to a listing for spotlighting.
- Flags:
  - `--item-listing-id <id>`: listing object ID to attach to (required).
  - `--discount-template-id <id>`: template object ID to attach (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:item-listing:clear-discount-template`
- Clears the spotlighted template from a listing (does not delete the template).
- Flags:
  - `--item-listing-id <id>`: listing object ID to clear (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### Buyer + Discovery Scripts

#### `pnpm script buyer:shop:view`
- Fetches the shop overview and prints listings, accepted currencies, and discount templates in one call.
- Flags:
  - `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

#### `pnpm script buyer:currency:list`
- Lists all `AcceptedCurrency` entries for a shop.
- Flags:
  - `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

#### `pnpm script buyer:item-listing:list`
- Lists all item listings under a shop.
- Flags:
  - `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

#### `pnpm script buyer:discount-template:list`
- Lists all discount templates under a shop.
- Flags:
  - `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

#### `pnpm script buyer:discount-ticket:list`
- Lists DiscountTickets owned by an address (default: configured account) with optional shop filtering.
- Flags:
  - `--address <0x...>`: owner address to list; defaults to configured account.
  - `--shop-package-id <id>`: `sui_oracle_market` package ID for type filtering; inferred from artifacts when omitted.
  - `--shop-id <id>`: optional shop object ID filter.

#### `pnpm script buyer:discount-ticket:claim`
- Claims a single-use DiscountTicket from a DiscountTemplate using the on-chain clock.
- Flags:
  - `--discount-template-id <id>`: template object ID to claim from (required).
  - `--shop-id <id>`: shop object ID (optional; inferred from artifacts when omitted).

#### `pnpm script buyer:buy`
- Executes checkout with oracle guardrails and optional discounts. On localnet, run `pnpm script chain:mock:update-prices` periodically so mock Pyth feeds stay fresh.
- Flags:
  - `--shop-id <id>`: shared Shop object ID; defaults to the latest Shop artifact.
  - `--item-listing-id <id>`: listing object ID to purchase (required).
  - `--coin-type <0x...::Coin>`: payment coin type (must be registered as an AcceptedCurrency) (required).
  - `--payment-coin-object-id <id>`: specific Coin object ID to use; otherwise the script picks the richest owned coin of that type.
  - `--mint-to <0x...>`: address that receives the ShopItem receipt (defaults to signer).
  - `--refund-to <0x...>`: address that receives any refund change (defaults to signer).
  - `--discount-ticket-id <id>`: redeem an existing DiscountTicket during checkout.
  - `--discount-template-id <id>` / `--claim-discount`: claim + redeem a ticket atomically in one PTB.
  - `--max-price-age-secs <u64>` / `--max-confidence-ratio-bps <u64>`: tighter oracle guardrails (cannot exceed per-currency caps).
  - `--skip-price-update`: skip Hermes price refresh (not recommended on shared networks).
  - `--hermes-url <url>`: override the Hermes endpoint for price updates.
  - Note: `--claim-discount` and `--discount-ticket-id` are mutually exclusive.

#### `pnpm script buyer:buy:list`
- Lists `ShopItem` receipts owned by an address (default: configured account) with optional shop filtering.
- Flags:
  - `--address <0x...>`: owner address to list; defaults to configured account.
  - `--shop-package-id <id>`: `sui_oracle_market` package ID for type filtering; inferred from artifacts when omitted.
  - `--shop-id <id>`: optional shop object ID filter.

### Development Scripts (package-level)

#### `pnpm script lint`
- Runs ESLint across `packages/dapp`.

#### `pnpm script lint:fix`
- Runs ESLint with `--fix` across `packages/dapp`.

---

## State Deployments

Artifacts land in `packages/dapp/deployments` after running scripts. Use them to reuse package IDs, shared objects, and mock assets across runs.

### `packages/dapp/deployments/deployment.<network>.json`
- Shape: array of publish artifacts (one per published package).
- Key fields:
  - `network` / `rpcUrl`: target network name and RPC used at publish time.
  - `packagePath` / `packageName` / `packageId`: Move package location, declared name, and resulting on-chain package object.
  - `upgradeCap`: `0x2::package::UpgradeCap` object ID returned by `sui client publish`.
  - `isDependency`: whether the publish was recorded as a dependency-only build.
  - `sender`: address that signed the publish transaction.
  - `digest` / `publishedAt` / `explorerUrl`: transaction digest, ISO timestamp, and explorer deep-link.
  - `modules`: base64-encoded compiled modules returned by the publish (ordered as emitted by Sui).
  - `dependencies`: array of on-chain addresses the package links against.
  - `dependencyAddresses`: resolved named addresses for any Move.toml aliases.
  - `withUnpublishedDependencies` / `unpublishedDependencies`: flags and names when unpublished deps were allowed (localnet only).
  - `suiCliVersion`: Sui CLI version used during publish.

### `packages/dapp/deployments/mock.<network>.json`
- Captures local-only mocks produced by `chain:mock:setup`.
- Key fields:
  - `pythPackageId` / `coinPackageId`: package IDs for the mock Pyth and coin Move packages.
  - `coins`: array of minted mock coins with `coinType`, `currencyObjectId`, and sample minted coin object IDs.
  - `priceFeeds`: array of mock Pyth feeds with `feedIdHex` and `priceInfoObjectId`.

### `packages/dapp/deployments/objects.<network>.json`
- List of on-chain objects created by owner scripts (shops, caps, listings, discounts).
- Key fields per entry:
  - `packageId` / `publisherId`: package that defines the object and its publisher object.
  - `signer`: address that created the object.
  - `objectId` / `objectType` / `objectName`: on-chain ID, full type tag, and a friendly label when available.
  - `owner`: structured owner info (`shared`, `address`, or `object`).
  - `initialSharedVersion` / `version`: creation and current versions.
  - `digest`: transaction digest that last mutated the object.
  - `dynamicFieldId`: present for dynamic-field entries.
  - `deletedAt` / `wrappedAt`: timestamps for removed or wrapped objects.

---

## Deep Dive: How It Maps to EVM Mental Models

| Topic | EVM | Sui |
| --- | --- | --- |
| Package/contract | Immutable bytecode at an address, often proxied | Immutable package object; upgrades publish new package + `UpgradeCap` |
| Auth | `msg.sender` + modifiers | Capability objects (e.g., `ShopOwnerCap`) must be presented |
| State | Contract storage slots | Owned/shared objects + dynamic fields; better parallelism |
| Tokens | ERC-20 approvals | `Coin<T>` types; metadata via coin registry; no approvals |
| Oracles | Chainlink contracts queried by address | Pyth `PriceInfoObject` passed into tx; freshness checked with `Clock` |
| Local dev | Hardhat/Anvil | `sui start` localnet with faucet; dev builds allow mocks |
| Migrations | Scripts calling contracts | Publish scripts that build/publish packages and seed objects |

Why this matters:
- Parallel execution: dynamic fields and owned objects avoid global contention seen in EVM storage maps.
- Strong typing: Move enforces types at compile time (`Coin<T>`, `ShopItem<TItem>`), reducing runtime checks.
- Capability-based auth: possession of a cap is required; no implicit caller context.

Docs links:
- Packages: https://docs.sui.io/concepts/sui-move-concepts/packages
- Objects & ownership: https://docs.sui.io/concepts/objects
- Coin registry: https://docs.sui.io/concepts/token#coin-registry
- Clock & oracles: https://docs.sui.io/guides/developer/app-examples/oracle
- Move overview: https://docs.sui.io/concepts/sui-move-concepts

---

## Workflow Cheat Sheet

- **Full local demo**: `pnpm script chain:localnet:start` → `pnpm script chain:mock:setup` → `pnpm script chain:publish-package --package-path oracle-market --dev`
- **Re-seed mocks**: `pnpm script chain:mock:setup --re-publish`
- **Publish to testnet** (after pinning real deps): `pnpm script chain:publish-package --package-path oracle-market --network testnet`

---

## Further Reading

- Sui docs home: https://docs.sui.io
- Move language book: https://move-language.github.io/move/
- Sui Move patterns: https://docs.sui.io/concepts/sui-move-concepts
- Oracle example: https://docs.sui.io/guides/developer/app-examples/oracle

Happy building! Once comfortable locally, pin real dependencies and ship to testnet/mainnet with confidence.
