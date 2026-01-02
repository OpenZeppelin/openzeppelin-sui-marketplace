# Sui Oracle Market – End-to-End Developer Guide

The purpose of this the DApp is to illustrate an end-to-end example of a small online market selling items at a USD-pegged stablecoin but that can be bought in different currencies, using an oracle to get selling price of items in those different available currencies.

A practical onboarding guide for Solidity/EVM developers building and deploying the `sui_oracle_market` Move package. This repo is a pnpm workspace with Move packages, deployment scripts, and a Next.js UI. The README walks from a fresh clone to a full local flow (mock oracles + mock coins), then covers publishing to shared networks.

---

## Prerequisites

- **Node.js 22.19+** and **pnpm** for running scripts and the UI.
- **Rust toolchain** [`rustup`](https://rustup.rs/) on your `PATH`
- **Sui CLI** [`sui`](https://docs.sui.io/build/install) (recommanded installation with `suiup`) on your `PATH`.
- **Git** for version control.

### Note
Sui CLI version **1.63.x** (or newer) is recommended for this repo.

If you need a nightly build (for example, to match newer Move.lock/package-manager behavior), you can install it via:
```bash
rustup toolchain install nightly
suiup install sui@testnet --nightly
```

---

## Quickstart (TL;DR)

```bash
# 1) Clone and install
# (pnpm workspace install from the repo root)
git clone <your fork url> && cd sui-oracle-market
pnpm install

# 2) Create or reuse an address (this will be your shop owner address)
sui client new-address ed25519
sui client active-address   # ensure the desired address is active

# 3) Configure this address in Sui config file or export
export SUI_ACCOUNT_ADDRESS=<0x...>
export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>

# 4) Fund your created address
sui client faucet --address <0x...>

# 5) Start localnet (new terminal) (--with-faucet is recommended as some script auto fund address if fund is missing)
pnpm script chain:localnet:start --with-faucet

# 6) Seed mocks (coins + Pyth stub + price feeds)
pnpm script mock:setup --buyer-address <0x...>

# 7) Publish oracle-market (uses localnet dep replacements for mocks)
pnpm script move:publish --package-path oracle-market

# 8) To continue setting up the shop, listings, discounts, accepted currencies look at the scripts section
```

Optional run the UI (after publishing + creating a shop + updated UI environment variable config):
```bash
pnpm ui dev
```

---

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
  sui client faucet --address <0x...> # ensure your address as some fund
  ```
- Optional: export keys as env vars (used by scripts):
  ```bash
  export SUI_ACCOUNT_ADDRESS=<0x...>
  export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>
  ```
- The script config lives at `packages/dapp/sui.config.ts` (loaded automatically when you run `pnpm script ...`).
  - `defaultNetwork`: default network name used when `--network` is not passed (localnet by default).
  - `networks[networkName]`: per-network settings:
    - `url`: RPC endpoint for the fullnode. If omitted, tooling auto-resolves from `networkName`.
    - `networkName`: optional override; defaults to the key name (e.g., `testnet`).
    - `faucetUrl`: optional faucet override for `sui client faucet`.
    - `gasBudget`: default publish gas budget for that network.
    - `move`: Move-specific publish/build options:
      - `withUnpublishedDependencies`: localnet-only switch for unpublished dependencies; enables `--with-unpublished-dependencies`.
    - `pyth`: Pyth pull-oracle configuration:
      - `hermesUrl`: Hermes endpoint for price updates.
      - `pythStateId`: on-chain Pyth state object ID for the network.
      - `wormholeStateId`: on-chain Wormhole state object ID for the network.
      - `wormholePackageId`: Wormhole package ID on the network (optional metadata).
    - `account`: default signer configuration for scripts:
      - `keystorePath`: path to Sui CLI keystore (defaults to `~/.sui/sui_config/sui.keystore`).
      - `accountIndex`: index in the keystore (default `0`).
      - `accountAddress`: explicit address to use instead of keystore.
      - `accountPrivateKey`: private key for the signer (base64 or hex).
      - `accountMnemonic`: mnemonic for the signer.
    - `accounts`: optional named account map (same shape as `account`) for scripts that switch signer roles.
  - `paths`:
    - `move`: Move root (defaults to `packages/dapp/move` at runtime).
    - `deployments`: publish artifacts output directory.
    - `objects`: object artifacts output directory.
    - `artifacts`: alias for deployments (kept for compatibility).

Move environments (localnet/devnet/testnet/mainnet):
- All Move packages include `[environments]` so `--environment <name>` resolves chain IDs consistently.
- For localnet, we use `dep-replacements.localnet` to swap Pyth to the mock package without dev-mode flags.
- Chain IDs should match `sui client chain-identifier` for each CLI env. If you regenesis localnet, update its entry:
  ```bash
  sui client switch --env localnet
  sui client chain-identifier
  ```
  Then update `localnet = "<chain-id>"` in `packages/dapp/move/oracle-market/Move.toml` if it changed.

Environment overrides (optional):
- Network selection precedence: `--network` > `SUI_NETWORK` > `defaultNetwork` > `localnet`.
- `SUI_KEYSTORE_PATH`, `SUI_ACCOUNT_INDEX`, `SUI_ACCOUNT_ADDRESS`, `SUI_ACCOUNT_PRIVATE_KEY`, `SUI_ACCOUNT_MNEMONIC`: override the `account` fields above.

How it’s used:
- Scripts load `sui.config.ts` to decide RPC URL, account, and artifact paths.
- `--network <name>` switches networks without editing files; `SUI_NETWORK` applies when `--network` is omitted.
- Deploy artifacts are written under `packages/dapp/deployments`.

Quick decision table:
| Goal | Example command | Resulting network |
| --- | --- | --- |
| Local dev (default) | `pnpm script chain:localnet:start --with-faucet` | `localnet` |
| Local publish | `pnpm script move:publish --package-path oracle-market` | `localnet` |
| Testnet publish | `pnpm script move:publish --network testnet --package-path oracle-market` | `testnet` |
| Testnet scripts | `pnpm script buyer:shop-view --network testnet` | `testnet` |

### 3) Start localnet
```bash
pnpm script chain:localnet:start --with-faucet
```
- Spawns `sui start --with-faucet` and waits for RPC readiness.
- Uses the `localnet` RPC from `sui.config.ts` (or `--network localnet`).
- Initializes/uses a persistent localnet config dir (default `~/.sui/localnet`) so state survives restarts.
- If the config dir is missing, it runs `sui genesis --with-faucet --working-dir <dir>` once before starting.
- Records the Sui CLI version in the config dir (`sui-cli-version-<version>.txt`) for mismatch detection.
- If the CLI version changes and the config dir is the default (no `--config-dir` or env override), the script warns and recreates localnet state.
- If you pin a config dir yourself, a version mismatch throws to avoid deleting user-managed state; use `--force-regenesis` or a new `--config-dir`.

Note: running `sui start` without a stable config dir can regenesis and wipe local state; the script now deletes and recreates the config dir when you pass `--force-regenesis` or when a CLI version change is detected on the default config dir.

### 4) Seed mocks (coins + Pyth)
```bash
pnpm script mock:setup --buyer-address <0x...>
```
What it does:
- Publishes `packages/dapp/move/pyth-mock` and `packages/dapp/move/coin-mock` if needed.
- Mints mock coins via the coin registry, funds your signer, and transfers half of each minted coin to the buyer address.
- Publishes mock Pyth price feeds with fresh timestamps.
- Writes artifacts to `packages/dapp/deployments/mock.localnet.json` for reuse.

### 5) Publish oracle-market (localnet)
```bash
pnpm script move:publish --package-path oracle-market
```
What it does:
- Builds against the localnet dependency replacements and unpublished deps.
- Publishes via the Sui CLI.
- Writes results to `packages/dapp/deployments/deployment.localnet.json`.

---

## Workflow Cheat Sheet (Localnet end-to-end)

All commands are run from the repo root. These steps create a fully working local environment with mocks, a shop, listings, discounts, and buyer funding. Each script records artifacts so you can re-run without retyping IDs.

Defaults and artifacts:
- Owner scripts auto-fill `--shop-package-id`, `--shop-id`, and `--owner-cap-id` from `packages/dapp/deployments/deployment.<network>.json` and `packages/dapp/deployments/objects.<network>.json`.
- Buyer scripts that take `--shop-id` will default to the latest Shop object in `packages/dapp/deployments/objects.<network>.json`.

### 0) Prepare owner and buyer accounts
The scripts sign transactions with the configured account in `packages/dapp/sui.config.ts` (or `SUI_ACCOUNT_ADDRESS` / `SUI_ACCOUNT_PRIVATE_KEY` env vars). Use one address as the shop owner and another as the buyer.

```bash
# Create two addresses in the Sui CLI keystore (owner + buyer).
sui client new-address ed25519
sui client new-address ed25519

# Check which one is active (the active address is the signer for scripts).
sui client active-address

# Fun the 2 addresses
sui client faucet --address <0x...>
```

If you want to run buyer scripts as the buyer account, switch your active address or update sui.config file before running buyer scripts.

### 1) Start localnet
```bash
pnpm script chain:localnet:start --with-faucet
```
What it does:
- Starts `sui start` with a local config directory (default `~/.sui/localnet`) and waits for RPC readiness.
- Runs a faucet locally and funds the configured signer after any regenesis.
- Use `--force-regenesis` to reset the chain (clears `packages/dapp/deployments/*.localnet*` and recreates the localnet config dir before starting).
- If the default config dir is used and the Sui CLI version changes, the script warns and recreates localnet state automatically.

### 2) Seed local mocks (coins, Pyth feeds, example item types)
```bash
pnpm script mock:setup --buyer-address <0x...>
```
What it does:
- Publishes mock Move packages (`pyth-mock`, `coin-mock`, and `item-examples`) on localnet.
- Mints mock coins to the signer, transfers half of each minted coin to the buyer address, and creates two mock Pyth `PriceInfoObject`s.
- Writes mock artifacts to `packages/dapp/deployments/mock.localnet.json`.

Where to find values:
- `pythPackageId`, `coinPackageId`, `itemPackageId`: top-level fields in `mock.localnet.json`.
- `priceFeeds[].feedIdHex` and `priceFeeds[].priceInfoObjectId`: use these for `owner:currency:add`.
- `coins[].coinType`, `coins[].currencyObjectId`, `coins[].mintedCoinObjectId`: coin types and a mint for transfers.
- `itemTypes[].itemType`: sample item types (e.g., `...::items::Car`) for listings.

### 3) Publish the oracle-market package
```bash
pnpm script move:publish --package-path oracle-market
```
What it does:
- Publishes the main `sui_oracle_market` Move package to localnet using dep replacements (no dev-mode flags).
- Records publish artifacts in `packages/dapp/deployments/deployment.localnet.json`.

Where to find values:
- `deployment.localnet.json` entries include `packageId`, `packagePath`, and `packageName`.

### 4) Create the shop (shared Shop + ShopOwnerCap)
```bash
pnpm script owner:shop:create
```
Optional:
- `--name "Your Shop"` sets the on-chain shop name (defaults to `Shop`).

What it does:
- Calls `shop::create_shop` and creates a shared `Shop` plus a `ShopOwnerCap` capability.
- Records object artifacts in `packages/dapp/deployments/objects.localnet.json`.

Where to find values:
- `shopId`: look for `objectType` ending in `::shop::Shop` in `objects.localnet.json`.
- `ownerCapId`: look for `objectType` ending in `::shop::ShopOwnerCap` in the same file.
- The script logs the Shop ID, name, and owner address on success.

Optional shortcut (localnet + testnet):
```bash
pnpm script owner:shop:seed
```
This seeds accepted currencies, listings, and discounts in one run. On testnet it registers USDC + WAL with fixed Pyth feed IDs; on localnet it uses `mock.localnet.json`. If you use this, you can skip steps 5–8 below.

### 5) Register an accepted currency (link coin type to Pyth feed)
```bash
pnpm script owner:currency:add \
  --coin-type <COIN_TYPE> \
  --feed-id <FEED_ID_HEX> \
  --price-info-object-id <PRICE_INFO_OBJECT_ID>
```
What it does:
- Creates an `AcceptedCurrency` object and registers it on the Shop.
- Links your coin type to a Pyth `PriceInfoObject` for oracle pricing.

Where to find values:
- `COIN_TYPE`: `packages/dapp/deployments/mock.localnet.json` -> `coins[].coinType`
- `FEED_ID_HEX`: `mock.localnet.json` -> `priceFeeds[].feedIdHex`
- `PRICE_INFO_OBJECT_ID`: `mock.localnet.json` -> `priceFeeds[].priceInfoObjectId`
- Optional `--currency-object-id`: `mock.localnet.json` -> `coins[].currencyObjectId` (otherwise derived automatically)
- The resulting `AcceptedCurrency` ID is stored in `packages/dapp/deployments/objects.localnet.json` with `objectType` ending in `::shop::AcceptedCurrency`

### 6) Create a listing
```bash
pnpm script owner:item-listing:add \
  --name "Example Item" \
  --price 12.50 \
  --stock 10 \
  --item-type <ITEM_TYPE>
```
What it does:
- Creates a new `ItemListing` object with price (USD cents), stock, and item type metadata.
- Records the listing in `packages/dapp/deployments/objects.localnet.json`.

Where to find values:
- `ITEM_TYPE`: `packages/dapp/deployments/mock.localnet.json` -> `itemTypes[].itemType`
- `itemListingId`: `objects.localnet.json` entry with `objectType` ending in `::shop::ItemListing`
- The script logs the listing ID and its marker (dynamic field) ID.

### 7) Create a discount template
```bash
pnpm script owner:discount-template:create \
  --rule-kind fixed \
  --value 5.00
```
What it does:
- Creates a reusable `DiscountTemplate` object with schedule and rule settings.
- Optionally scope it to a listing with `--listing-id <ITEM_LISTING_ID>`.

Where to find values:
- `discountTemplateId`: `objects.localnet.json` entry with `objectType` ending in `::shop::DiscountTemplate`
- If you scoped the template, `--listing-id` should be the `itemListingId` from step 6.

### 8) Attach the discount template to a listing (spotlight)
```bash
pnpm script owner:item-listing:attach-discount-template \
  --item-listing-id <ITEM_LISTING_ID> \
  --discount-template-id <DISCOUNT_TEMPLATE_ID>
```
What it does:
- Updates the listing to reference the discount template so it is spotlighted.
- Logs the updated listing and template summaries.

Where to find values:
- `ITEM_LISTING_ID`: from step 6 (`objects.localnet.json` or script output)
- `DISCOUNT_TEMPLATE_ID`: from step 7 (`objects.localnet.json` or script output)

### 9) Transfer mock coins from owner to buyer
```bash
pnpm script owner:coin:transfer \
  --coin-id <COIN_OBJECT_ID> \
  --amount <U64_AMOUNT> \
  --recipient <BUYER_ADDRESS>
```
What it does:
- Splits a coin object owned by the signer and transfers the requested amount to the buyer address.

Where to find values:
- `COIN_OBJECT_ID`: `mock.localnet.json` -> `coins[].mintedCoinObjectId`, or run `pnpm script chain:describe-address --address <OWNER_ADDRESS>` and look for `::coin::Coin<...>` objects.
- `BUYER_ADDRESS`: output of `sui client new-address ed25519` (or any existing address).

### 10) Refresh mock prices (recommended before buys)
```bash
pnpm script mock:update-prices
```
What it does:
- Updates the mock Pyth `PriceInfoObject` timestamps so oracle freshness checks pass.
- Uses `packages/dapp/deployments/mock.localnet.json` to locate feeds.

### 11) View the full shop snapshot
```bash
pnpm script buyer:shop:view
```
What it does:
- Prints the shop overview plus listings, accepted currencies, and discount templates in one read-only snapshot.
- Uses the latest Shop artifact if `--shop-id` is omitted.

Where to find values:
- `shopId`: `packages/dapp/deployments/objects.localnet.json` entry with `objectType` ending in `::shop::Shop`

### Other useful scripts while iterating
- `pnpm script owner:pyth:list --quote USD`: list Pyth feeds for a quote currency and surface feed IDs + PriceInfoObject IDs.
- `pnpm script buyer:currency:list`: list accepted currencies for the shop.
- `pnpm script buyer:item-listing:list`: list all listings and their IDs.
- `pnpm script buyer:discount-template:list`: list all discount templates and their IDs.
- `pnpm script buyer:discount-ticket:claim --discount-template-id <ID>`: claim a DiscountTicket for a buyer.
- `pnpm script buyer:buy --item-listing-id <ID> --coin-type <COIN_TYPE>`: execute checkout (run `mock:update-prices` first on localnet).
- `pnpm script buyer:buy:list`: list ShopItem receipts owned by the buyer.
- `pnpm script mock:get-currency`: inspect mock coin registry entries (localnet only; uses `mock.localnet.json` by default).
- `pnpm script chain:describe-coin-balances --address <ADDR>`: list aggregate balances and coin object counts for an address.
- `pnpm script chain:describe-object --object-id <ID>`: inspect any on-chain object by ID.
- `pnpm script chain:describe-dynamic-field-object --parent-id <PARENT> --child-id <CHILD>`: inspect dynamic field entries.
- `pnpm script chain:localnet:stop`: stop a detached localnet process.

---

## Repository Layout

```
.
├── packages/
│   ├── dapp/
│   │   ├── move/                     # Move packages (oracle-market + mocks + examples)
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

---

## Script Reference

All backend scripts live under `packages/dapp/src/scripts`; mock chain scripts live under
`packages/dapp/src/scripts/mock`, and Move scripts live under `packages/dapp/src/scripts/move`. Run with:
```bash
pnpm script <script-name> [--flags]
```

Common flag (applies to all scripts that use the standard runner):
- `--network <name>`: override the network from `packages/dapp/sui.config.ts` (defaults to `localnet`).

Exceptions:
- `pnpm script chain:localnet:stop` has no CLI flags.
- `pnpm script mock:get-currency` does not accept `--network` and is localnet-only.

### Chain + Localnet Scripts (infra + inspection)

#### `pnpm script chain:localnet:start`
- Boots `sui start`, waits for RPC health, logs a network snapshot, and (if `--with-faucet`) funds the configured signer after regenesis.
- Tracks the Sui CLI version in the config dir; default config dirs auto-regenesis on version changes, while explicit config dirs error to avoid deleting user-managed state.
- Flags:
  - `--check-only`: probe the RPC and exit without starting a node; fails if unreachable.
  - `--wait-seconds <n>`: readiness timeout while waiting for RPC (default `25`).
  - `--with-faucet`: start `sui start --with-faucet` (default `true`).
  - `--force-regenesis`: clears `packages/dapp/deployments/*.localnet*`, deletes the localnet config dir, runs `sui genesis`, then starts `sui start --network.config` (no `--force-regenesis` flag).
  - `--config-dir <path>`: localnet config dir passed to `sui start --network.config` (default `~/.sui/localnet`).

#### `pnpm script chain:localnet:stop`
- Scans the process table for detached `sui start` processes and SIGTERMs them. No flags.

#### `pnpm script mock:setup`
- Localnet-only seeding. Publishes/reuses `pyth-mock`, `coin-mock`, and `item-examples`, mints mock coins, transfers half of each minted coin to the buyer address, and creates two mock Pyth price feeds. Writes artifacts to `packages/dapp/deployments/mock.localnet.json`.
- Flags:
  - `--buyer-address <0x...>`: buyer address to receive half of each minted mock coin (required; alias `--buyer`).
  - `--coin-package-id <id>` / `--pyth-package-id <id>`: reuse existing mock package IDs instead of publishing.
  - `--coin-contract-path <path>` / `--pyth-contract-path <path>`: override Move package paths.
  - `--re-publish`: ignore existing artifacts; republish mocks and recreate feeds.

#### `pnpm script move:publish`
- Builds and publishes a Move package under `packages/dapp/move`, skipping if a deployment artifact already exists unless `--re-publish` is set.
- Flags:
  - `--package-path <path>`: package folder relative to `packages/dapp/move` (required).
  - `--with-unpublished-dependencies`: allow unpublished deps (defaults to `true` on localnet; rejected on shared networks).
  - `--re-publish`: publish even if a deployment artifact already exists.
  - Use `--network <name>` to switch between `localnet`, `testnet`, etc; the script passes the matching Move `--environment` to the CLI.

#### `pnpm script mock:get-currency`
- Localnet-only coin registry inspection. If `--coin-type` is omitted it reads coin types from `packages/dapp/deployments/mock.localnet.json`.
- Flags:
  - `--registry-id <id>`: coin registry shared object (defaults to Sui registry).
  - `--coin-type <type>`: coin type(s) to inspect (repeatable; defaults to mock artifact coins).

#### `pnpm script mock:update-prices`
- Localnet-only refresh of mock Pyth `PriceInfoObject`s to keep freshness checks valid.
- The UI buy flow now refreshes mock feeds automatically; use this script for CLI-driven buys or manual inspection flows.
- Flags:
  - `--pyth-package-id <id>`: override the Pyth mock package ID (defaults to the artifact).

#### `pnpm script chain:describe-coin-balances`
- Lists all coin types + balances for an address.
- Flags:
  - `--address <0x...>`: address to inspect (defaults to the configured account).

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
- Calls `shop::create_shop` to create the shared `Shop` plus `ShopOwnerCap`.
- Flags:
  - `--name <string>`: shop name stored on-chain (defaults to `Shop`).
  - `--shop-package-id <id>`: published `sui_oracle_market` package ID (defaults to the latest `sui_oracle_market` entry in `packages/dapp/deployments/deployment.<network>.json`).

#### `pnpm script owner:shop:seed`
- Creates a shop if one is missing, then seeds accepted currencies, listings, and discounts for fast UI testing.
- Network behavior:
  - **Testnet**: registers USDC + WAL using hardcoded Pyth feed IDs (no CLI overrides).
    - USDC feed: `0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722`
    - USDC PriceInfoObject: `0x9c4dd4008297ffa5e480684b8100ec21cc934405ed9a25d4e4d7b6259aad9c81`
    - WAL feed: `0xa6ba0195b5364be116059e401fb71484ed3400d4d9bfbdf46bd11eab4f9b7cea`
    - WAL PriceInfoObject: `0x52e5fb291bd86ca8bdd3e6d89ef61d860ea02e009a64bcc287bc703907ff3e8a`
  - **Localnet**: reads `packages/dapp/deployments/mock.localnet.json` for mock coins + feeds (requires `pnpm script mock:setup --buyer-address <0x...>`).
- Seeded data:
  - 4 low-price listings (Car, Bike, ConcertTicket, DigitalPass).
  - 2 discount templates (10% percent + $2 fixed) and attaches the fixed discount to the Bike listing.
- Flags:
  - `--shop-package-id <id>`: only used if a shop needs to be created (when `--shop-id` or `--owner-cap-id` is missing).
  - `--shop-name <string>`: shop name stored on-chain when creating a new shop (defaults to `Shop`).
  - `--shop-id <id>` / `--owner-cap-id <id>`: seed an existing shop.
  - `--item-package-id <id>`: item-examples package ID for typed listings (defaults to the latest `item_examples` publish).
  - `--max-price-age-secs-cap <u64>` / `--max-confidence-ratio-bps-cap <u64>` / `--max-price-status-lag-secs-cap <u64>`: optional per-currency guardrails when registering AcceptedCurrency.

#### `pnpm script owner:shop:update-owner`
- Rotates the shop owner/payout address via `shop::update_shop_owner`.
- Flags:
  - `--new-owner <0x...>`: address to become the new shop owner/payout recipient (required; aliases `--newOwner` / `--payout-address`).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

#### `pnpm script owner:coin:transfer`
- Splits a coin object and transfers the requested amount to a recipient address.
- Flags:
  - `--coin-id <id>`: coin object ID to transfer from (required).
  - `--amount <u64>`: amount to split and transfer (required).
  - `--recipient <0x...>`: address to receive the transfer (required; alias `--to`).
- Example:
  ```bash
  pnpm script owner:coin:transfer --coin-id 0xCOIN_OBJECT_ID --amount 1000000 --recipient 0xd8e74f5ab0a34a05e45fb44bd54b323779b3208d599ae14d4c71b268a1de179f
  ```

#### `pnpm script owner:currency:add`
- Registers an accepted currency by linking a coin type to a Pyth feed with optional guardrail caps.
- Flags:
  - `--coin-type <0x...::Coin>`: coin type to accept (required).
  - `--feed-id <hex>`: 32-byte Pyth feed ID as hex (required).
  - `--price-info-object-id <id>`: shared Pyth `PriceInfoObject` ID (required; also passed as `pyth_object_id`).
  - `--currency-object-id <id>`: coin registry `Currency` object (defaults to the derived `CurrencyKey<T>`).
  - `--max-price-age-secs-cap <u64>` / `--max-confidence-ratio-bps-cap <u64>` / `--max-price-status-lag-secs-cap <u64>`: optional guardrail caps.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

**Pyth setup flow (feed discovery → currency registration)**
- 1) Find the feed + PriceInfoObject:
  ```bash
  pnpm script owner:pyth:list --quote USD --limit 5
  ```
- 2) Register the currency using the feed + object IDs from step 1:
  ```bash
  pnpm script owner:currency:add \
    --coin-type 0x2::sui::SUI \
    --feed-id <PYTH_FEED_ID> \
    --price-info-object-id <PYTH_PRICE_INFO_OBJECT_ID>
  ```

#### `pnpm script owner:pyth:list`
- Lists all available Pyth feeds for the current network and surfaces the fields needed to call `owner:currency:add` (feed id, PriceInfoObject id, coin registry matches).
- Flags:
  - `--query <text>`: filter by symbol/description (Hermes query). Coin-type pairs like `0x2::sui::SUI/0x...::usdc::USDC` are parsed locally.
  - `--asset-type <type>`: filter by asset class (e.g. `crypto`, `fx`, `equity`, `commodity`).
  - `--quote <symbol>`: filter by quote symbol after Hermes results are loaded (e.g. `USD`).
  - `--coin <symbol-or-type>`: filter feeds that include a coin (symbol or full coin type).
  - `--limit <n>`: only show the first `n` feeds.
  - `--skip-price-info`: skip on-chain PriceInfoObject lookup for faster output.
  - `--skip-registry`: skip coin registry matching for faster output.
  - `--json`: output machine-readable JSON.
  - `--hermes-url <url>` / `--pyth-state-id <id>` / `--wormhole-state-id <id>`: override Pyth network config (defaults are set for testnet/mainnet).
- Example:
  ```bash
  pnpm script owner:pyth:list --quote USD --limit 10
  ```
  ```bash
  pnpm script owner:pyth:list --coin 0x...::usdc::USDC --quote USD --limit 10
  ```
  ```bash
  pnpm script owner:pyth:list --query 0x2::sui::SUI/0x...::usdc::USDC --limit 10
  ```

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
  - `--item-type <0x...::Type>`: fully qualified item type (required). Can be any published struct (not just from the shop package); see `packages/dapp/move/item-examples/sources/items.move` and `packages/dapp/deployments/mock.localnet.json` `itemTypes` for sample values like `0x...::items::Car`.
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
- Executes checkout with oracle guardrails and optional discounts. On localnet, run `pnpm script mock:update-prices` periodically for CLI-driven buys (the UI buy flow refreshes mock feeds automatically).
- Flags:
  - `--shop-id <id>`: shared Shop object ID; defaults to the latest Shop artifact.
  - `--item-listing-id <id>`: listing object ID to purchase (required).
  - `--coin-type <0x...::Coin>`: payment coin type (must be registered as an AcceptedCurrency) (required).
  - `--payment-coin-object-id <id>`: specific Coin object ID to use; otherwise the script picks the richest owned coin of that type.
  - `--mint-to <0x...>`: address that receives the ShopItem receipt (defaults to signer); redeeming the receipt for the actual item happens in a separate flow.
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
  - `dependencyAddresses`: named address aliases resolved from Move build artifacts (`BuildInfo.yaml`) and recorded for convenience.
  - `withUnpublishedDependencies` / `unpublishedDependencies`: flags and names when unpublished deps were allowed (localnet only).
  - `suiCliVersion`: Sui CLI version used during publish.

### `packages/dapp/deployments/mock.<network>.json`
- Captures local-only mocks produced by `mock:setup`.
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

## Frontend UI

### Prerequisite
- Install [Slush Wallet](https://slush.app/) in your browser
- Create a new key or import a key you have generated with SUI CLI (this will be your buyer address)

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

Localnet signing + execution (UI):
- The UI **always** signs on the wallet and **executes** via the app’s local RPC client when the app network is `localnet`. This avoids wallet execution on whatever network the wallet is configured for.
- Detection is app-driven (not wallet-driven): `useSuiClientContext()` supplies `network`, and the buy flow checks `network === localnet` before choosing the execution path.
- Localnet RPC is locked to `http://127.0.0.1:9000` and guarded so only `localhost/127.0.0.1` are accepted. See `packages/ui/src/app/config/network.ts` and `packages/ui/src/app/helpers/localnet.ts`.
- The buy flow also refreshes local mock Pyth feeds in the same PTB, so UI purchases do not require running `pnpm script mock:update-prices` first.

Why this matters:
- Wallet Standard distinguishes **sign-only** from **sign+execute**. Using `signTransaction` keeps the wallet from picking an RPC endpoint.
- For localnet we must ensure **all reads + writes** go to the same local node; otherwise you can sign on localnet but accidentally execute on devnet/testnet.

Implementation details:
- Buy flow branch is in `packages/ui/src/app/components/BuyFlowModal.tsx`.
  - Localnet uses `useSignTransaction` + `SuiClient.executeTransactionBlock`.
  - Non-local networks keep `useSignAndExecuteTransaction`.
- The local executor also dry-runs before signature and reports raw effects back to the wallet after execution.

### UI scripts (run from repo root with `pnpm ui ...`):

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

### Deployment scripts:
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
- **Localnet vs testnet/mainnet**: Localnet is your sandbox with unpublished deps; shared networks require linking dependencies to already-published package IDs via Move.toml `dep-replacements.<env>` (or Move registry/mvr).

---

## Moving to Testnet/Mainnet

### Get testnet SUI

Use a faucet to fund your testnet wallet before deploying or testing:

- Official Sui faucet: https://faucet.sui.io/
- Community faucets:
  - http://faucet.n1stake.com/
  - http://faucet.suilearn.io/

### Swap for testnet tokens

If you need a non-SUI coin for purchases, use FlowX on testnet:

- https://testnet.flowx.finance/

We recommend swapping some SUI into USDC on testnet.

One coin type currently registered in Sui's coin registry is:
`0xa7f7382f67ef48972ad6a92677f2a764201041f5e29c7a9e0389b75e61038cdf::usdc::USDC`.

Note: testnet coin package IDs can change over time. Always make sure the coin
type you acquire matches the accepted currency type configured in the store.

---

## Deep Dive: How It Maps to EVM Mental Models

| Topic | EVM | Sui |
| --- | --- | --- |
| Package/contract | Immutable bytecode at an address, often proxied | Immutable package object; upgrades publish new package + `UpgradeCap` |
| Auth | `msg.sender` + modifiers | Capability objects (e.g., `ShopOwnerCap`) must be presented |
| State | Contract storage slots | Owned/shared objects + dynamic fields; better parallelism |
| Tokens | ERC-20 approvals | `Coin<T>` types; metadata via coin registry; no approvals |
| Oracles | Chainlink contracts queried by address | Pyth `PriceInfoObject` passed into tx; freshness checked with `Clock` |
| Local dev | Hardhat/Anvil | `sui start` localnet with faucet; dep replacements supply mocks |
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

## Further Reading

- Sui docs home: https://docs.sui.io
- Move language book: https://move-language.github.io/move/
- Sui Move patterns: https://docs.sui.io/concepts/sui-move-concepts
- Oracle example: https://docs.sui.io/guides/developer/app-examples/oracle

Happy building! Once comfortable locally, pin real dependencies and ship to testnet/mainnet with confidence.
