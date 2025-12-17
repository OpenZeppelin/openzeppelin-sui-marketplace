# Sui Oracle Market – End-to-End Developer Guide

A comprehensive, opinionated onboarding guide for Solidity/EVM developers building and deploying the `sui_oracle_market` Move package. This README walks from a fresh clone to running a full local flow (mock oracles + mock coins), then publishing to a network. Along the way, it explains the Sui concepts behind each step and compares them with familiar EVM patterns.

---

## Quickstart (TL;DR)

```bash
# 1) Clone and install
git clone <your fork url> && cd sui-oracle-market
pnpm install

# 2) Start localnet (new terminal)
pnpm start:localnet --with-faucet

# 3) Seed mocks (coins + Pyth stub + price feeds)
pnpm setup:local

# 4) Publish oracle-market with dev dependencies (local mocks)
pnpm publish:package --package-path oracle-market --dev
```

If you hit errors, keep reading—every step is explained in detail with troubleshooting tips.

---

## Prerequisites

- **Node.js 18+** and **pnpm** for running deployment scripts.
- **Sui CLI** on your `PATH` (see Sui install docs: https://docs.sui.io/build/install).
- **Rust toolchain** (via `rustup`) if you need to build Sui locally.
- **Git** for cloning and managing patches.
- A machine that can run a local Sui full node and faucet (CPU/RAM similar to a local dev Ethereum node).

> Why Sui CLI? Publishing and object inspection rely on the CLI, and `sui start` bootstraps the localnet.

---

## Repository Layout

- `move/oracle-market`: Main Move package (`sui_oracle_market::shop`), depends on Pyth price feeds and OpenZeppelin math.
- `move/pyth-mock`: Local-only Pyth stub to mint `PriceInfoObject`s without VAAs (dev/test only).
- `move/coin-mock`: Local-only mock coins (USD, BTC) for demos.
- `src/scripts/chain/*`: Automation scripts for localnet, seeding mocks, and publishing.
- `deployments/`: Generated artifacts (package IDs, mock coin/feed objects) after running scripts.

---

## Sui Concepts for EVM Developers

- **Packages are immutable objects**: Publishing creates a package object; upgrades publish a new package + `UpgradeCap`. No proxy pattern. Docs: https://docs.sui.io/concepts/sui-move-concepts/packages
- **Capabilities instead of `msg.sender`**: Auth is proved by owning capability objects (e.g., `ShopOwnerCap`). Docs: https://docs.sui.io/concepts/sui-move-concepts/abilities
- **Objects, not contract storage**: State is stored as owned/shared objects and dynamic fields, improving parallelism. Docs: https://docs.sui.io/concepts/objects
- **Typed coins**: `Coin<T>` types replace ERC-20 approvals; metadata comes from the Sui coin registry. Docs: https://docs.sui.io/concepts/token#coin-registry
- **Oracles as objects**: Pyth prices are delivered as `PriceInfoObject` + clock checks; no address lookups. Docs: https://docs.sui.io/guides/developer/app-examples/oracle
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
- Configure `sui.config.ts` (defaults are prefilled for localnet). Fields mirror `SuiUserConfig`:
  - `defaultNetwork`: name of the network scripts use if `--network` is not passed (`localnet` by default).
  - `networks[networkName]`: per-network settings:
    - `url`: RPC endpoint (auto-resolved for localnet/devnet/testnet/mainnet if omitted).
    - `faucetUrl`: optional faucet override (otherwise defaults by network).
    - `gasBudget`: default publish gas budget for that network (e.g., `2_000_000_000`).
    - `move.withUnpublishedDependencies`: opt-in to publishing with unpublished deps (localnet only).
    - `account`: primary account settings (env overrides preferred):
      - `keystorePath` (defaults to `~/.sui/sui_config/sui.keystore`)
      - `accountIndex` (index in keystore, default `0`)
      - `accountAddress`, `accountPrivateKey`, `accountMnemonic` (direct credentials)
    - `accounts`: optional named account map; scripts can select by name.
  - `paths`: where scripts look for code/artifacts:
    - `move`: Move root (`move`)
    - `deployments`: deployment artifacts directory (`deployments`)
    - `objects`: object artifacts directory (`deployments`)
    - `artifacts`: mock/deployment artifact directory (`deployments`)

How it’s used:
- Scripts load `sui.config.ts` to decide which RPC URL and account to use, similar to Hardhat’s network config.
- Gas budgets and paths drive publish/build flows and artifact persistence.
- If you omit a network entry, `resolveRpcUrl` falls back to standard Sui endpoints for `localnet/devnet/testnet/mainnet`; custom networks must set `url`.

### 3) Start localnet
```
pnpm start:localnet --with-faucet
```
- Spawns `sui start --with-faucet`.
- Waits for RPC readiness at `http://127.0.0.1:9000`.
- Why: localnet lets you publish with `--dev` (uses mocks/unpublished deps) and faucet SUI automatically.

**Troubleshooting localnet**
- Port errors (macOS sandbox): ensure no other `sui` nodes are running; retry with `--force-regenesis`.
- RPC unreachable: check logs; ensure firewall isn’t blocking loopback.

### 4) Seed mocks (coins + Pyth)
```
pnpm setup:local
```
What it does:
- Publishes `move/pyth-mock` (Pyth stub) and `move/coin-mock` if not already recorded in `deployments/mock.localnet.json`.
- Mints mock coins via the coin registry and funds your signer.
- Publishes two mock Pyth price feeds (USD, BTC) with fresh timestamps using the on-chain clock.
- Writes artifacts to `deployments/mock.localnet.json` for reuse.

Flags:
- `--re-publish`: force republish mocks (overwrites IDs in artifacts).
- `--pyth-package-id` / `--coin-package-id`: reuse existing mocks instead of republishing.

Why needed:
- Oracle-market expects real Pyth and real coins on shared networks; locally we supply mocks with dev dependencies (`--dev` build) for a self-contained demo.

### 5) Publish oracle-market (local/dev)
```
pnpm publish:package --package-path oracle-market --dev
```
What it does:
- Builds with `--dev` and `--with-unpublished-dependencies` (allows local mocks).
- Uses `--ignore-chain` for dev builds so it doesn’t need an active RPC during build.
- Publishes via CLI and writes deployment artifacts to `deployments/deployment.localnet.json`.
- Claims the `0x2::package::Publisher` for the published package using the returned `UpgradeCap` (stored as `publisherId` in the deployment artifact). Disable with `--no-claim-publisher` if you manage publishers separately.
- If the package is already published and missing a `publisherId` in artifacts, rerunning `pnpm publish:package` will claim the Publisher (unless `--no-claim-publisher`).

Flags:
- `--re-publish`: force a new publish even if already recorded.
- `--with-unpublished-dependencies`: should stay `false` off-localnet; dev mode auto-enables it on localnet.
- `--no-claim-publisher`: skip claiming the Publisher after publish (defaults to claiming).

Why dev vs non-dev:
- `--dev` uses `[dev-dependencies]` (local mocks) and enables test-only modules. Shared networks must use published dependencies and omit `--dev`.

---

## Moving to Testnet/Mainnet

1) Replace mocks with real published packages:
   - Set `Move.lock` entries to published Pyth and OpenZeppelin math package IDs.
   - Remove `--dev`/`--with-unpublished-dependencies` when publishing.
2) Fund the publisher address with enough SUI (gas budget in `sui.config.ts` defaults to `2_000_000_000`).
3) Publish:
   ```
   pnpm publish:package --package-path oracle-market --network testnet
   ```
4) Record the `packageId`, `UpgradeCap`, and `publisherId` from `deployments/deployment.testnet.json`.

Key differences vs localnet:
- No unpublished deps; all dependency addresses must be in `Move.lock`.
- Dev-only code must not be relied on; use the real Pyth package.

---

## Script Reference

All scripts run from the repo root and honor `sui.config.ts` (or `--network <name>`) for RPC/account selection. When shop objects/caps are omitted, owner/buyer scripts try to reuse the latest artifacts from `deployments/objects.<network>.json`.

### Chain + Localnet Scripts (infra + inspection)

#### `pnpm start:localnet`
- Boots `sui start` with optional faucet, waits for RPC readiness, logs the protocol snapshot, and exits early if a node is already running. With `--force-regenesis` it also deletes `deployments/*.localnet*` artifacts and auto-faucets the configured signer when a faucet is available.
- Flags:
  - `--check-only`: probe the RPC and exit; fail if unreachable.
  - `--wait-seconds <n>`: readiness timeout (default 25s).
  - `--with-faucet`: start the faucet alongside the node (default true; required for auto-funding).
  - `--force-regenesis`: pass `--force-regenesis` to `sui start` and clear localnet deployment artifacts before booting.

#### `pnpm stop:localnet`
- Scans background processes for detached `sui start` instances (TTY `?` / `-`) and SIGTERMs them so you don’t accumulate orphaned local nodes. No flags.

#### `pnpm setup:local`
- Localnet-only seeding. Publishes or reuses `move/pyth-mock` and `move/coin-mock`, mints mock coins + registry entries, and creates two mock Pyth `PriceInfoObject`s with current timestamps. Writes results to `deployments/mock.localnet.json` and reuses recorded IDs unless `--re-publish` is set.
- Flags:
  - `--coin-package-id <id>` / `--pyth-package-id <id>`: reuse existing mock packages instead of publishing.
  - `--coin-contract-path <path>` / `--pyth-contract-path <path>`: override the Move package paths (defaults `move/coin-mock` and `move/pyth-mock`).
  - `--re-publish`: ignore recorded artifacts and republish + remint everything.

#### `pnpm publish:package`
- Builds and publishes a Move package under `move/`, funding the signer if balances are low, and records artifacts in `deployments/deployment.<network>.json`. Dev builds and unpublished deps are restricted to localnet; shared networks must use published deps.
- Flags:
  - `--package-path <path>`: package folder relative to `move/` (required).
  - `--dev`: build with dev-dependencies (localnet only; defaults to true on localnet).
  - `--with-unpublished-dependencies`: allow unpublished deps (localnet only).
  - `--re-publish`: publish even if the package already has an artifact entry.

#### `pnpm get:mock-currency`
- Localnet-only coin/registry inspection. Resolves coin types from `deployments/mock.localnet.json` when `--coin-type` is omitted, then prints metadata (name/symbol/decimals/icon), treasury/deny caps, supply, and any minted sample coins.
- Flags:
  - `--registry-id <id>`: coin registry shared object (default Sui registry).
  - `--coin-type <type>`: coin type(s) to inspect (repeatable; defaults to the artifact coins).

#### `pnpm describe:address`
- Summarizes an address: SUI balance, per-coin balances, stake totals, and a truncated sample of owned object types to avoid huge output. The CLI currently requires passing an address flag even if you want the configured account.
- Flags:
  - `--address <0x...>`: address to inspect (required).

#### `pnpm describe:object`
- Fetches any object by ID with type, owner, version, and display/content fields.
- Flags:
  - `--object-id <id>`: target object ID (required; aliases `--id`).

#### `pnpm describe:dynamic-field-object`
- Looks up the dynamic field object under a shared parent and fetches the child object, logging the resolved dynamic field object ID.
- Flags:
  - `--parent-id <id>`: shared parent object ID (required).
  - `--child-id <id>`: dynamic field name/child object ID (required; alias `--name`).

### Shop Owner Scripts (commerce flows)

#### `pnpm owner:create-shop`
- Calls `shop::create_shop` using a `0x2::package::Publisher` to create a shared `Shop` plus `ShopOwnerCap`; stores them in `deployments/objects.<network>.json`.
- Flags:
  - `--shop-package-id <id>`: published `sui_oracle_market` package ID (required).
  - `--publisher-cap-id <id>`: `0x2::package::Publisher` object ID (required; not the UpgradeCap).

#### `pnpm owner:add-currency`
- Registers an accepted currency by linking a coin type to a Pyth feed (`PriceInfoObject`) with optional freshness/confidence/status guardrails. Short-circuits if the currency already exists. Defaults package/shop/owner cap and registry currency ID from artifacts when omitted.
- Flags:
  - `--coin-type <0x...::Coin>`: coin type to accept (required).
  - `--feed-id <hex>`: 32-byte Pyth feed ID (required).
  - `--price-info-object-id <id>`: shared Pyth `PriceInfoObject` (required; also passed as `pyth_object_id`).
  - `--currency-id <id>`: coin registry `Currency` object (defaults to the derived `CurrencyKey` under the Sui registry).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.
  - `--max-price-age-secs-cap <u64>` / `--max-confidence-ratio-bps-cap <u64>` / `--max-price-status-lag-secs-cap <u64>`: optional guardrail caps (omit to use module defaults).

#### `pnpm owner:add-item-listing`
- Creates an item listing with a USD price (accepts dollars or cents), initial stock (>0), and Move type for the SKU; can spotlight a discount template. Uses artifact defaults for package/shop/cap.
- Flags:
  - `--name <string>`: item name (required).
  - `--price <usd-or-cents>`: price as USD (e.g., `12.50`) or cents (e.g., `1250`) (required).
  - `--stock <u64>`: initial inventory (>0) (required).
  - `--item-type <0x...::Type>`: fully qualified item type (required).
  - `--spotlight-discount-id <id>`: optional discount template to spotlight.
  - `--publisher-id <id>`: optional publisher object metadata field (not required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

#### `pnpm owner:remove-item-listing`
- Deletes an `ItemListing` object and logs the deletion digest. Uses artifact defaults for package/shop/cap when omitted.
- Flags:
  - `--item-listing-id <id>`: listing to remove (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

#### `pnpm owner:update-item-listing-stock`
- Updates inventory for an existing listing; `0` pauses sales without removing the listing. Uses artifact defaults for package/shop/cap.
- Flags:
  - `--item-listing-id <id>`: listing to update (required).
  - `--stock <u64>`: new quantity (required; can be zero).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

#### `pnpm owner:create-discount-template`
- Creates a reusable discount template with scheduling and optional SKU scoping; supports fixed USD or percent discounts. Records the created template in artifacts.
- Flags:
  - `--rule-kind <fixed|percent>`: discount rule type (required).
  - `--value <amount>`: USD value (fixed) or percentage (percent) (required).
  - `--starts-at <epoch-seconds>`: activation time (defaults to now).
  - `--expires-at <epoch-seconds>`: optional expiry.
  - `--max-redemptions <u64>`: optional redemption cap.
  - `--listing-id <id>`: optional SKU to scope the template to.
  - `--publisher-id <id>`: optional publisher object metadata field.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

#### `pnpm owner:update-discount-template`
- Rewrites an existing template’s rule, schedule, and redemption cap using the on-chain clock (`0x6::clock`) for validation. Uses artifact defaults for package/shop/cap.
- Flags:
  - `--discount-template-id <id>`: template to update (required).
  - `--rule-kind <fixed|percent>` / `--value <amount>`: new rule type and value (required).
  - `--starts-at <epoch-seconds>`: new start time (defaults to now).
  - `--expires-at <epoch-seconds>`: optional new expiry.
  - `--max-redemptions <u64>`: optional new redemption cap.
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

#### `pnpm owner:toggle-discount-template`
- Toggles a discount template’s active flag; use explicit boolean switches.
- Flags:
  - `--discount-template-id <id>`: template to toggle (required).
  - `--active` / `--no-active`: desired activation state (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

#### `pnpm owner:attach-discount-template`
- Attaches a discount template to an item listing for spotlighting. Validates that both objects belong to the same shop and that pinned templates are only attached to their designated listing.
- Flags:
  - `--item-listing-id <id>`: listing to attach to (required).
  - `--discount-template-id <id>`: template to attach (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

#### `pnpm owner:clear-discount-template`
- Removes the spotlighted discount template from a listing (does not delete the template itself). Confirms the listing belongs to the target shop before clearing.
- Flags:
  - `--item-listing-id <id>`: listing to clear (required).
  - `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: overrides for package/shop/cap artifacts.

### Buyer + Discovery Scripts

#### `pnpm buyer:list-currencies`
- Read-only listing of all `AcceptedCurrency` dynamic fields under a shop. Prints coin type, symbol/decimals (when present), Pyth feed ID/object, guardrail caps, and the dynamic field object ID so buyers can know what to pay with.
- Flags:
  - `--shop-id <id>`: shop to inspect; defaults to the latest `Shop` in `deployments/objects.<network>.json`.

Utilities (TS helpers):
- `src/utils/publish.ts`: Builds Move packages, handles CLI/SDK publish, manages `Move.lock` dependency addresses.
- `src/utils/mock.ts`: Reads/writes mock artifacts for reuse across runs.
- `src/utils/pyth.ts`: Publishes mock price feeds and computes type strings.
- `src/utils/address.ts`: Faucets SUI and ensures the signer has enough gas coin objects.

---

## State Deployments

Artifacts land in `deployments/` after running scripts. Use them to reuse package IDs, shared objects, and mock assets across runs.

### `deployments/deployment.<network>.json`
- Shape: array of publish artifacts (one per published package).
- Key fields:
  - `network` / `rpcUrl`: target network name and RPC used at publish time.
  - `packagePath` / `packageName` / `packageId`: Move package location, declared name, and resulting on-chain package object.
  - `upgradeCap`: `0x2::package::UpgradeCap` object ID returned by `sui client publish`.
  - `isDependency`: whether the publish was recorded as a dependency-only build.
  - `sender`: address that signed the publish transaction.
  - `digest` / `publishedAt` / `explorerUrl`: transaction digest, ISO timestamp, and handy explorer deep-link.
  - `modules`: base64-encoded compiled modules returned by the publish (ordered as emitted by Sui).
  - `dependencies`: array of on-chain addresses the package links against (SuiStd, MoveStd, SuiFramework, etc.).
  - `dependencyAddresses`: resolved named addresses for any Move.toml aliases (e.g., `openzeppelin_math`).
  - `withUnpublishedDependencies` / `unpublishedDependencies`: flags and names when the publish allowed unpublished deps (dev/localnet).
  - `suiCliVersion`: Sui CLI version used during publish (useful for reproducibility).

### `deployments/mock.<network>.json`
- Captures local-only mocks produced by `setup:local`.
- Key fields:
  - `pythPackageId` / `coinPackageId`: package IDs for the mock Pyth and mock coin Move packages.
  - `coins`: array of minted mock coins:
    - `label`: human-friendly tag used by scripts.
    - `coinType`: fully qualified Move coin type.
    - `currencyObjectId`: `0x2::coin_registry::Currency` object under the coin registry.
    - `treasuryCapId`: treasury cap for mint/burn authority.
    - `mintedCoinObjectId`: sample coin object minted to the signer for quick testing.
  - `priceFeeds`: array of mock Pyth feeds:
    - `label`: feed nickname.
    - `feedIdHex`: 32-byte feed ID hex string.
    - `priceInfoObjectId`: shared `PriceInfoObject` ID seeded on-chain.

### `deployments/objects.<network>.json`
- List of on-chain objects created by owner scripts (shops, caps, listings, discounts).
- Key fields per entry:
  - `packageId` / `publisherId`: package that defines the object and its publisher object (when claimed).
  - `signer`: address that created the object.
  - `objectId` / `objectType` / `objectName`: on-chain ID, full type tag, and a friendly label when available.
  - `owner`: structured owner info:
    - `ownerType`: `shared`, `address`, or `object`.
    - `address`: present when `ownerType` is `address`.
    - `objectId`: present when `ownerType` is `object` (dynamic field parent).
    - `initialSharedVersion`: present when the object is shared.
  - `initialSharedVersion` / `version`: creation and current versions as strings.
  - `digest`: transaction digest that last mutated the object.
  - `dynamicFieldId`: present for dynamic-field entries (the field object ID).
  - `deletedAt`: ISO timestamp if the object was later deleted (useful for pruning stale listings).
  - `wrappedAt`: ISO timestamp if the object was wrapped into another object (Sui `wrapped` effect), signaling it is no longer directly usable.

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
| Migrations | Scripts calling contracts | Publish scripts that build/publish packages and seed objects (price feeds, coins) |

Why this matters:
- Parallel execution: dynamic fields and owned objects avoid global contention seen in EVM single-storage maps.
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

- **Full local demo**: `pnpm start:localnet` → `pnpm setup:local` → `pnpm publish:package --package-path oracle-market --dev`
- **Re-seed mocks**: `pnpm setup:local --re-publish`
- **Publish to testnet** (after pinning real deps): `pnpm publish:package --package-path oracle-market --network testnet`

---

## Further Reading

- Sui docs home: https://docs.sui.io
- Move language book: https://move-language.github.io/move/
- Sui Move patterns: https://docs.sui.io/concepts/sui-move-concepts
- Oracle example: https://docs.sui.io/guides/developer/app-examples/oracle

Happy building! If you’re coming from Solidity, lean on the parallels above and the scripts here to shorten the path to first publish. Once comfortable locally, pin real dependencies and ship to testnet/mainnet with confidence.
