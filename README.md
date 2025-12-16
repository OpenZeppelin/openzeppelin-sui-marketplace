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
- A machine that can run a local Sui fullnode and faucet (CPU/RAM similar to a local dev Ethereum node).

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

## Scripts Overview

- `pnpm start:localnet`: Runs `sui start`, waits for RPC, optionally `--force-regenesis`.
- `pnpm setup:local`: Publishes mocks, mints coins, seeds Pyth price feeds, writes mock artifacts.
- `pnpm publish:package`: Publishes any Move package under `move/`; accepts `--package-path`, `--dev`, `--re-publish`, `--no-claim-publisher`.
- `pnpm get:mock-currency`: Fetches mock coin metadata/objects from artifacts.
- `pnpm stop:localnet`: Stops localnet if scripted (optional).

Utilities (TS):
- `utils/publish.ts`: Builds Move packages, handles CLI/SDK publish, manages Move.lock dependency addresses.
- `utils/mock.ts`: Reads/writes mock artifacts for reuse.
- `utils/pyth.ts`: Helpers to publish mock price feeds and compute type strings.
- `utils/address.ts`: Faucets SUI and ensures sufficient gas coin objects.

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

## Common Pitfalls & Fixes

- **Build fails: “Name of dependency … does not match package name”**  
  Ensure `Move.toml` dependency alias matches the package’s declared name (Pyth is `Pyth`, not `pyth`).

- **Framework version mismatch**  
  On localnet/dev this is skipped; on shared networks ensure all `Move.lock` files (root + local deps) reference the same Sui framework commit (run `sui move update`).

- **`create_shop` fails asking for Publisher vs UpgradeCap**  
  The shop module needs the `0x2::package::Publisher` for the package, not the `UpgradeCap`. The publish script now claims the Publisher by default and records `publisherId` in `deployments/deployment.<network>.json`. If you used `--no-claim-publisher`, mint it manually with `sui client call --package 0x2 --module package --function claim --args <upgradeCapId>`.

- **`sui start` port errors on macOS**  
  Ensure no other Sui nodes running; retry with `--force-regenesis`; sometimes macOS sandboxing blocks port scans—restart terminal or adjust permissions.

- **Missing Move.lock on shared networks**  
  Generate with `sui move build --skip-fetch-latest-git-deps` and pin published addresses before publishing.

- **Unpublished dependencies on testnet/mainnet**  
  Do not pass `--with-unpublished-dependencies`; make sure dependency addresses are set in `Move.lock`.

---

## Workflow Cheat Sheet

- **Full local demo**: `pnpm start:localnet` → `pnpm setup:local` → `pnpm publish:package --package-path oracle-market --dev`
- **Re-seed mocks**: `pnpm setup:local --re-publish`
- **Publish to testnet** (after pinning real deps): `pnpm publish:package --package-path oracle-market --network testnet`

---

## What Gets Written Where

- `deployments/mock.localnet.json`: Mock package IDs, coins, price feed objects.
- `deployments/deployment.<network>.json`: Published package artifacts (packageId, upgradeCap, digest).
- `move/*/Move.lock`: Dependency pins; must include published addresses for shared networks.

---

## Further Reading

- Sui docs home: https://docs.sui.io
- Move language book: https://move-language.github.io/move/
- Sui Move patterns: https://docs.sui.io/concepts/sui-move-concepts
- Oracle example: https://docs.sui.io/guides/developer/app-examples/oracle

Happy building! If you’re coming from Solidity, lean on the parallels above and the scripts here to shorten the path to first publish. Once comfortable locally, pin real dependencies and ship to testnet/mainnet with confidence.
