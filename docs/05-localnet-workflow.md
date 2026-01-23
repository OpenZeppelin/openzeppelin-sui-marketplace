# 05 - Localnet workflow (end-to-end)

**Path:** [Learning Path](./) > 05 Localnet workflow (end-to-end)

This chapter holds the “how to run it locally” content that is too detailed for the earlier chapters.

If you’re brand new, start with [00 Setup + Quickstart](./00-setup.md) and then follow the linear chapters in [Learning Path Map](./README.md).

---

## Environment Setup (from scratch)

### 1) Clone and install deps
```bash
git clone git@github.com:OpenZeppelin/sui-oracle-market.git sui-oracle-market
cd sui-oracle-market
pnpm install
```

### 2) Configure Sui CLI and config file
- Create or reuse an address (note the recovery phrase to import it later in your browser wallet):
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
| Testnet scripts | `pnpm script buyer:shop:view --network testnet` | `testnet` |

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
# Create two addresses in the Sui CLI keystore (owner + buyer) (note the private keys to import them later in your browser wallet).
sui client new-address ed25519
sui client new-address ed25519

# Check which one is active (the active address is the signer for scripts).
sui client active-address

# Fund the 2 addresses (ensure your localnet is started with faucet)
sui client faucet --address <0x...>
```

If you want to run buyer scripts as the buyer account, switch your active address or update sui.config file before running buyer scripts.

### 1) Start localnet
```bash
pnpm script chain:localnet:start --with-faucet
```

What it does:
- Starts `sui start` with a local config directory (default `~/.sui/localnet`) and waits for RPC readiness.
- The signer will get funded after any regenesis.
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

### 5) View the full shop snapshot
```bash
pnpm script buyer:shop:view
```

What it does:
- Prints the shop overview plus listings, accepted currencies, and discount templates in one read-only snapshot.
- Uses the latest Shop artifact if `--shop-id` is omitted.

Where to find values:
- `shopId`: `packages/dapp/deployments/objects.localnet.json` entry with `objectType` ending in `::shop::Shop`

### Other useful scripts while iterating
For a full script list and flags, see [06 Scripts reference (CLI)](./06-scripts-reference.md).

---

## How to run scripts in this repo

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

## 10. Navigation
1. Previous: [04 Localnet + Publish](./04-localnet-publish.md)
2. Next: [06 Scripts reference (CLI)](./06-scripts-reference.md)
3. Back to map: [Learning Path Map](./)
