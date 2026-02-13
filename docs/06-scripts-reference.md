# 06 - Scripts reference (CLI)

**Path:** [Learning Path](./) > 06 Scripts reference (CLI)

All backend scripts live under `packages/dapp/src/scripts`; mock chain scripts live under
`packages/dapp/src/scripts/mock`, and Move scripts live under `packages/dapp/src/scripts/contracts`.

Run from the repo root:
```bash
pnpm script <script-name> [--flags]
```

Common flag (applies to all scripts that use the standard runner):
- `--network <name>`: override the network from `packages/dapp/sui.config.ts` (defaults to `localnet`).

Exceptions:
- `pnpm script chain:localnet:stop` has no CLI flags.
- `pnpm script mock:get-currency` does not accept `--network` and is localnet-only.

---

**Code spotlight: standard script runner flow**
`packages/dapp/src/scripts/owner/shop-create.ts`
```ts
const shopPackageId = await resolveShopPackageId({
  networkName: tooling.network.networkName,
  shopPackageId: cliArguments.shopPackageId
})
const shopName = cliArguments.name ?? "Shop"

const createShopTransaction = buildCreateShopTransaction({
  packageId: shopPackageId,
  shopName
})

await tooling.executeTransactionWithSummary({
  transaction: createShopTransaction,
  signer: tooling.loadedEd25519KeyPair,
  summaryLabel: "create-shop",
  devInspect: cliArguments.devInspect,
  dryRun: cliArguments.dryRun
})
```

## Chain + localnet scripts (infra + inspection)

### `pnpm script chain:localnet:start`
- Boots `sui start`, waits for RPC health, logs a network snapshot, and (if `--with-faucet`) funds the configured signer after regenesis.
- Tracks the Sui CLI version in the config dir; default config dirs auto-regenesis on version changes, while explicit config dirs error to avoid deleting user-managed state.
- Flags:
	- `--check-only`: probe the RPC and exit without starting a node; fails if unreachable.
	- `--wait-seconds <n>`: readiness timeout while waiting for RPC (default `25`).
	- `--with-faucet`: start `sui start --with-faucet` (default `true`).
	- `--force-regenesis`: clears `packages/dapp/deployments/*.localnet*`, deletes the localnet config dir, runs `sui genesis`, then starts `sui start --network.config` (no `--force-regenesis` flag).
	- `--config-dir <path>`: localnet config dir passed to `sui start --network.config` (default `~/.sui/localnet`).

### `pnpm script chain:localnet:stop`
- Scans the process table for detached `sui start` processes and SIGTERMs them. No flags.

### `pnpm script mock:setup`
- Localnet-only seeding. Publishes/reuses `pyth-mock`, `coin-mock`, and `item-examples`, mints mock coins, transfers half of each minted coin to the buyer address, and creates two mock Pyth price feeds. Writes artifacts to `packages/dapp/deployments/mock.localnet.json`.
- Flags:
	- `--buyer-address <0x...>`: buyer address to receive half of each minted mock coin (required; alias `--buyer`).
	- `--coin-package-id <id>` / `--pyth-package-id <id>`: reuse existing mock package IDs instead of publishing.
	- `--coin-contract-path <path>` / `--pyth-contract-path <path>`: override Move package paths.
	- `--re-publish`: ignore existing artifacts; republish mocks and recreate feeds.

### `pnpm script move:publish`
- Builds and publishes a Move package under `packages/dapp/contracts`, skipping if a deployment artifact already exists unless `--re-publish` is set.
- Flags:
	- `--package-path <path>`: package folder relative to `packages/dapp/contracts` (required).
	- `--with-unpublished-dependencies`: allow unpublished deps (defaults to `true` on localnet; rejected on shared networks).
	- `--re-publish`: publish even if a deployment artifact already exists.
	- Use `--network <name>` to switch between `localnet`, `testnet`, etc; the script passes the matching Move `--environment` to the CLI.

### `pnpm script mock:get-currency`
- Localnet-only coin registry inspection. If `--coin-type` is omitted it reads coin types from `packages/dapp/deployments/mock.localnet.json`.
- Flags:
	- `--registry-id <id>`: coin registry shared object (defaults to Sui registry).
	- `--coin-type <type>`: coin type(s) to inspect (repeatable; defaults to mock artifact coins).

### `pnpm script mock:update-prices`
- Localnet-only refresh of mock Pyth `PriceInfoObject`s to keep freshness checks valid.
- The UI buy flow refreshes mock feeds automatically; use this script for CLI-driven buys or manual inspection flows.
- Flags:
	- `--pyth-package-id <id>`: override the Pyth mock package ID (defaults to the artifact).

### `pnpm script chain:describe-coin-balances`
- Lists all coin types + balances for an address.
- Flags:
	- `--address <0x...>`: address to inspect (defaults to the configured account).

### `pnpm script chain:describe-address`
- Summarizes an address: SUI balance, all coin balances, stake totals, and a truncated owned-object sample.
- Flags:
	- `--address <0x...>`: address to inspect (required by CLI).

### `pnpm script chain:describe-object`
- Fetches any object by ID and prints owner/version/digest plus content + display summaries.
- Flags:
	- `--object-id <id>`: target object ID (required; alias `--id`).

### `pnpm script chain:describe-dynamic-field-object`
- Resolves a dynamic field child under a shared parent and prints the child object details.
- Flags:
	- `--parent-id <id>`: shared parent object ID (required).
	- `--child-id <id>`: dynamic field name/child object ID (required; alias `--name`).

---

## Shop owner scripts (commerce flows)

Owner scripts default `--shop-package-id`, `--shop-id`, and `--owner-cap-id` from the latest entries in `packages/dapp/deployments/objects.<network>.json` when omitted.

### `pnpm script owner:shop:create`
- Calls `shop::create_shop` to create the shared `Shop` plus `ShopOwnerCap`.
- Flags:
	- `--name <string>`: shop name stored on-chain (defaults to `Shop`).
	- `--shop-package-id <id>`: published `sui_oracle_market` package ID (defaults to the latest `sui_oracle_market` entry in `packages/dapp/deployments/deployment.<network>.json`).

### `pnpm script owner:shop:seed`
- Creates a shop if one is missing, then seeds accepted currencies, listings, and discounts for fast UI testing.
- Network behavior:
	- **Testnet**: registers USDC + WAL using hardcoded Pyth feed IDs (no CLI overrides).
		- USDC feed: `0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722`
		- USDC PriceInfoObject: `0x9c4dd4008297ffa5e480684b8100ec21cc934405ed9a25d4e4d7b6259aad9c81`
		- WAL feed: `0xa6ba0195b5364be116059e401fb71484ed3400d4d9bfbdf46bd11eab4f9b7cea`
		- WAL PriceInfoObject: `0x52e5fb291bd86ca8bdd3e6d89ef61d860ea02e009a64bcc287bc703907ff3e8a`
	- **Localnet**: reads `packages/dapp/deployments/mock.localnet.json` for mock coins + feeds (requires `pnpm script mock:setup --buyer-address <0x...> --network localnet`).
- Seeded data:
	- 4 low-price listings (Car, Bike, ConcertTicket, DigitalPass).
	- 2 discount templates (10% percent + $2 fixed) and attaches the fixed discount to the Bike listing.
- Flags:
	- `--shop-package-id <id>`: only used if a shop needs to be created (when `--shop-id` or `--owner-cap-id` is missing).
	- `--shop-name <string>`: shop name stored on-chain when creating a new shop (defaults to `Shop`).
	- `--shop-id <id>` / `--owner-cap-id <id>`: seed an existing shop.
	- `--item-package-id <id>`: item-examples package ID for typed listings (defaults to the latest `item_examples` publish).
	- `--max-price-age-secs-cap <u64>` / `--max-confidence-ratio-bps-cap <u64>` / `--max-price-status-lag-secs-cap <u64>`: optional per-currency guardrails when registering AcceptedCurrency.

### `pnpm script owner:shop:update-owner`
- Rotates the shop owner/payout address via `shop::update_shop_owner`.
- Flags:
	- `--new-owner <0x...>`: address to become the new shop owner/payout recipient (required; aliases `--newOwner` / `--payout-address`).
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:coin:transfer`
- Splits a coin object and transfers the requested amount to a recipient address.
- Flags:
	- `--coin-id <id>`: coin object ID to transfer from (required).
	- `--amount <u64>`: amount to split and transfer (required).
	- `--recipient <0x...>`: address to receive the transfer (required; alias `--to`).
	- Example:
	  ```bash
	  pnpm script owner:coin:transfer --coin-id 0xCOIN_OBJECT_ID --amount 1000000 --recipient 0xd8e74f5ab0a34a05e45fb44bd54b323779b3208d599ae14d4c71b268a1de179f
	  ```

### `pnpm script owner:currency:add`
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

### `pnpm script owner:pyth:list`
- Lists available Pyth feeds for the current network and surfaces the fields needed to call `owner:currency:add` (feed id, PriceInfoObject id, coin registry matches).
	- By default, results are filtered to feeds whose base symbol matches at least one entry in the coin registry.
	- Use `--include-unregistered` to include feeds without a registry match.
	- Flags:
		- `--query <text>`: filter by symbol/description (Hermes query). Coin-type pairs like `0x2::sui::SUI/0x...::usdc::USDC` are parsed locally.
		- `--asset-type <type>`: filter by asset class (e.g. `crypto`, `fx`, `equity`, `commodity`).
		- `--quote <symbol>`: filter by quote symbol after Hermes results are loaded (e.g. `USD`).
		- `--coin <symbol-or-type>`: filter feeds that include a coin (symbol or full coin type).
		- `--limit <n>`: only show the first `n` feeds.
		- `--include-unregistered`: include feeds that do not match any coin registry entries.
		- `--skip-price-info`: skip on-chain PriceInfoObject lookup for faster output.
		- `--skip-registry`: skip coin registry matching for faster output (implies `--include-unregistered` and omits currency ids/coin types).
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

### `pnpm script owner:currency:remove`
- Deregisters an accepted currency. Provide either the `AcceptedCurrency` object ID or a coin type to resolve it.
- Flags:
	- `--accepted-currency-id <id>`: specific AcceptedCurrency object ID to remove.
	- `--coin-type <0x...::Coin>`: coin type to resolve/remove when `--accepted-currency-id` is omitted.
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.
	- One of `--accepted-currency-id` or `--coin-type` is required.

### `pnpm script owner:item-listing:add`
- Creates an item listing with a USD price, stock count, Move item type, and optional spotlighted discount template.
- Flags:
	- `--name <string>`: item name (required; UTF-8 encoded).
	- `--price <usd-or-cents>`: USD string (`12.50`) or integer cents (`1250`) (required).
	- `--stock <u64>`: initial inventory (>0) (required).
	- `--item-type <0x...::Type>`: fully qualified item type (required).
	- `--spotlight-discount-id <id>`: optional discount template to spotlight on creation.
	- `--publisher-id <id>`: optional metadata-only field; not passed on-chain.
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:item-listing:remove`
- Delists the item by removing its marker under the Shop. The shared `ItemListing` object remains
  addressable for history and analytics.
- Flags:
	- `--item-listing-id <id>`: listing object ID to remove (required).
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:item-listing:update-stock`
- Updates inventory for an existing listing; setting `0` pauses sales without removing the listing.
- Flags:
	- `--item-listing-id <id>`: listing object ID (required).
	- `--stock <u64>`: new quantity (required; can be zero).
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:discount-template:create`
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

### `pnpm script owner:discount-template:update`
- Rewrites a template’s rule/schedule/redemption cap using the on-chain clock.
- Flags:
	- `--discount-template-id <id>`: template object ID (required).
	- `--rule-kind <fixed|percent>` / `--value <amount>`: new rule type and value (required).
	- `--starts-at <epoch-seconds>`: new start time (defaults to now).
	- `--expires-at <epoch-seconds>`: optional new expiry.
	- `--max-redemptions <u64>`: optional new redemption cap.
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:discount-template:toggle`
- Toggles a discount template’s active flag.
- Flags:
	- `--discount-template-id <id>`: template object ID (required).
	- `--active` / `--no-active`: desired activation state (required boolean flag).
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:discount-template:prune-claims`
- Removes per-wallet claim markers for a finished template (expired or maxed).
- Flags:
	- `--discount-template-id <id>`: template object ID (required).
	- `--claimers <addr,addr,...>` / `--claimer <addr>`: claimer addresses to prune (required).
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:item-listing:attach-discount-template`
- Attaches a discount template to a listing for spotlighting.
- Flags:
	- `--item-listing-id <id>`: listing object ID to attach to (required).
	- `--discount-template-id <id>`: template object ID to attach (required).
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

### `pnpm script owner:item-listing:clear-discount-template`
- Clears the spotlighted template from a listing (does not delete the template).
- Flags:
	- `--item-listing-id <id>`: listing object ID to clear (required).
	- `--shop-package-id <id>` / `--shop-id <id>` / `--owner-cap-id <id>`: override artifact defaults.

---

## Buyer + discovery scripts

### `pnpm script buyer:shop:view`
- Fetches the shop overview and prints listings, accepted currencies, and discount templates in one call.
- Flags:
	- `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

### `pnpm script buyer:currency:list`
- Lists all `AcceptedCurrency` entries for a shop.
- Flags:
	- `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

### `pnpm script buyer:item-listing:list`
- Lists all item listings under a shop.
- Flags:
	- `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

### `pnpm script buyer:discount-template:list`
- Lists all discount templates under a shop.
- Flags:
	- `--shop-id <id>`: shop to inspect; defaults to the latest Shop artifact.

### `pnpm script buyer:discount-ticket:list`
- Lists DiscountTickets owned by an address (default: configured account) with optional shop filtering.
- Flags:
	- `--address <0x...>`: owner address to list; defaults to configured account.
	- `--shop-package-id <id>`: `sui_oracle_market` package ID for type filtering; inferred from artifacts when omitted.
	- `--shop-id <id>`: optional shop object ID filter.

### `pnpm script buyer:discount-ticket:claim`
- Claims a single-use DiscountTicket from a DiscountTemplate using the on-chain clock.
- Flags:
	- `--discount-template-id <id>`: template object ID to claim from (required).
	- `--shop-id <id>`: shop object ID (optional; inferred from artifacts when omitted).

### `pnpm script buyer:buy`
- Executes checkout with oracle guardrails and optional discounts.
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

### `pnpm script buyer:buy:list`
- Lists `ShopItem` receipts owned by an address (default: configured account) with optional shop filtering.
- Flags:
	- `--address <0x...>`: owner address to list; defaults to configured account.
	- `--shop-package-id <id>`: `sui_oracle_market` package ID for type filtering; inferred from artifacts when omitted.
	- `--shop-id <id>`: optional shop object ID filter.

---

## Development scripts (package-level)

### `pnpm script lint`
- Runs ESLint across `packages/dapp`.

### `pnpm script lint:fix`
- Runs ESLint with `--fix` across `packages/dapp`.

---

## State deployments

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

## 10. Navigation
1. Previous: [05 Localnet workflow (end-to-end)](./05-localnet-workflow.md)
2. Next: [07 Shop Object + Capability Auth](./07-shop-capabilities.md)
3. Back to map: [Learning Path Map](./)
