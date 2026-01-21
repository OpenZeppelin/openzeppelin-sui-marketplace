Sui Oracle Market: EVM Dev Quickstart
=====================================

This is a short, Sui-first guide to the `sui_oracle_market::shop` module aimed at Solidity/EVM developers.

Where to start:
- If you are following the repo learning path, read `docs/08-listings-receipts.md` first, then come back here.
- For a concept map that links docs to code, see `docs/README.md`.

Mental Model Shift
------------------
- **Capabilities, not msg.sender:** Admin entry points require the owned `ShopOwnerCap`; buyers never handle capabilities during checkout. Payout rotation is explicit through `update_shop_owner`.
- **Permissionless instantiation:** `create_shop` takes a shop name and mints the shared `Shop` plus the `ShopOwnerCap` for the caller.
- **Objects over contract storage:** The shop is a shared object. Listings, accepted currencies, and discount templates are themselves shared objects indexed by lightweight dynamic-field markers under the shop (plus a coin-type index for currencies). Edits touch only the relevant object, keeping transactions parallel and minimizing contention.
- **Typed coins and receipts:** Payment assets are `Coin<T>` resources with no approvals; receipts are `ShopItem<TItem>` whose type must match the listing to keep downstream logic strongly typed. These receipts can be exchanged in a separate fulfillment or on-chain redemption flow for the actual `TItem`.
- **Clocked, guarded pricing:** Callers pass a refreshed `PriceInfoObject`; the module checks identity, freshness, confidence, and price-status lag against the shared `Clock` before quoting.
- **Events over historical arrays:** Lifecycle events (`PurchaseCompletedEvent`, `DiscountRedeemedEvent`, etc.) are emitted for indexers/UIs instead of storing growing arrays on-chain.

Object Graph (shared + dynamic-field index)
-------------------------------------------
```
Shop (shared)
├─ ItemListingMarker (df: listing_id -> ItemListingMarker)
├─ AcceptedCurrencyMarker (df: accepted_currency_id -> AcceptedCurrencyMarker)
│   └─ df: coin_type -> accepted_currency_id (index for lookups)
├─ DiscountTemplateMarker (df: template_id -> DiscountTemplateMarker)
└─ DiscountTemplate (shared)
    └─ df: claimer_address -> DiscountClaim (enforces one-claim-per-address)
ItemListing (shared)
└─ spotlight_discount_template_id: Option<ID>
AcceptedCurrency (shared)
```

Entry Points At A Glance
------------------------
- Shops: `create_shop` mints the shared `Shop` plus the owned `ShopOwnerCap`; `disable_shop` permanently disables buyer flows; `update_shop_owner` rotates the payout/owner fields without touching listings.
- Listings: `add_item_listing<T>` shares a listing object and registers a marker with USD-cent price, stock, and optional `spotlight_discount_template_id`; `update_item_listing_stock` changes inventory through the listing object; `remove_item_listing` removes the marker (delists) while keeping the shared listing addressable for history.
- Accepted currencies: `add_accepted_currency<T>` shares the `AcceptedCurrency` object, writes a marker under the shop, stores a `coin_type -> accepted_currency_id` index, and keeps feed metadata/guardrail caps; `remove_accepted_currency` removes the marker and type index (the shared currency object remains addressable for history).
- Discounts: `create_discount_template`, `update_discount_template` (only before claims/redemptions), and `toggle_discount_template` manage templates; `attach_template_to_listing`/`clear_template_from_listing` surface a spotlight template on a listing; `claim_discount_ticket`, `buy_item_with_discount`, `claim_and_buy_item_with_discount`, and `prune_discount_claims` (once finished) govern lifecycle and cleanup.
- Checkout: `buy_item<TItem, TCoin>` and `buy_item_with_discount<TItem, TCoin>` enforce listing/type matches, registered currency presence, oracle guardrails, and refund change in-line before minting a typed `ShopItem<TItem>` receipt (redemption for the underlying item happens elsewhere).

Oracle Guardrails
-----------------
- Feed identity is re-validated on-chain: 32-byte `feed_id`, matching `pyth_object_id`, and `PriceInfoObject` contents must align or the call aborts.
- Guardrails are two-tiered: sellers set caps per currency (`max_price_age_secs_cap`, `max_confidence_ratio_bps_cap`, `max_price_status_lag_secs_cap`), and buyers may only tighten them per call.
- Pricing is conservative: quotes use μ-σ and bound confidence ratio (default 10%: `DEFAULT_MAX_CONFIDENCE_RATIO_BPS = 1_000`) before converting USD cents to the payment coin, with overflow checks and a 38-decimal power limit.
- Status checks require the attestation time to be close to publish time (`DEFAULT_MAX_PRICE_STATUS_LAG_SECS = 5`), treating laggy feeds as unavailable.

Discount Lifecycle Notes
------------------------
- Templates track schedules (`starts_at`/`expires_at`), optional max redemptions, and activity flags; once claims or redemptions exist and the window is closed/maxed, updates are blocked.
- Spotlighting is explicit: listings can carry an optional template for UI promotion, and assertions ensure the template actually applies to that listing.
- Claim limits are enforced via per-claimer `DiscountClaim` children; `prune_discount_claims` only works after a template is irrevocably finished.
- Tickets are owned resources bound to the claimer and are burned on redemption to guarantee single-use semantics.

Shared Object + Marker Pattern (deep dive)
------------------------------------------
- What it is: the shop is a shared root. Each listing, accepted currency, and discount template is its own shared object. Under the shop, we store lightweight dynamic-field “markers” keyed by child IDs (plus a `coin_type -> accepted_currency_id` index for currencies). Claims stay as dynamic-field children under each template.
- How it works:
  - Discovery: UIs enumerate the shop’s dynamic fields to get child IDs, then fetch those shared objects directly by ID. The marker proves membership without storing full child data under the shop.
  - Auth: entry functions assert both marker presence and that the child’s embedded `shop_address` matches. Forged or foreign objects are rejected even if someone passes an arbitrary shared object.
  - Writes: admin ops mutate only the marker (add/remove) and the specific child object. Buyer flows read the shop (for markers) but mutate only the listing/template/currency involved. The coin-type index lets lookups skip scans.
  - Delisting: removing a marker unregisters the child; the shared child object remains addressable for history and analytics.
  - Claims: per-claimer `DiscountClaim` children live under the template, keeping “one claim per address” localized to the template without locking the shop.
- Why it helps:
  - Low contention: PTBs lock only the touched listing/template/currency (and marker when mutated), not a monolithic shop map. Different listings/currencies can update in parallel.
  - Stable addresses: listings/templates/currencies are first-class shared objects with stable IDs, so indexers/UIs can link to them even after delisting.
  - Lightweight discovery: dynamic-field enumeration is cheap; no need to borrow globals or scan large maps. The coin-type index avoids linear scans for currencies.
  - Cleaner auth and safety: marker + address checks enforce membership on-chain; no trusted off-chain registry is needed.
  - Composable cleanup: delisting/removal stops future use via the marker while preserving the object for audit/history.

Sui Move Principles, Applied
----------------------------
- Resource-first design: coins, tickets, receipts, and capabilities are owned objects moved in/out of entry functions instead of balances in contract storage.
- Capability-based auth: every admin path requires `ShopOwnerCap`.
- Shared-object composition: the `Shop` is shared; listings, currencies, and templates are shared objects indexed by lightweight markers (plus the coin-type index). PTBs lock only the touched listing/template/currency object.
- Strong typing over metadata: listings embed `TypeName` for runtime checks and UI metadata, while
  checkout asserts the `TItem` type to mint the correct `ShopItem<TItem>` with no opaque "token type" ints.
- Explicit data freshness: time comes from `Clock`, price data from `PriceInfoObject`, and both are validated inline so view-only RPC calls are unnecessary.
- Event-driven observability: analytics and UIs follow events instead of reading append-only storage arrays, keeping state lean.

Sui Fundamentals (EVM contrasts)
--------------------------------
- **Explicit capabilities over modifiers:** Admin flows require the owned `ShopOwnerCap` instead of `msg.sender` checks (`add_item_listing`, `update_shop_owner` in `move/sources/shop.move`). Docs: Move concepts (https://docs.sui.io/concepts/sui-move-concepts) and object ownership (https://docs.sui.io/guides/developer/objects/object-ownership). Compared to Solidity, callers must physically present the capability object, so auth is enforced by the type system.
- **Typed events for off-chain sync:** Events are structs with `has copy, drop` and are emitted explicitly (`event::emit` blocks across `move/sources/shop.move`), which indexers/GraphQL pick up without scanning storage. Solidity logs are untyped bytes; here the struct layout is part of the ABI. Docs: https://docs.sui.io/guides/developer/sui-101/using-events.
- **Object-oriented state and concurrency:** The `Shop` is shared; listings/templates/currencies are shared objects indexed by markers under the shop plus a coin-type index. PTBs lock only the specific listing/template/currency object involved, enabling parallelism versus EVM’s single storage map. Docs: https://docs.sui.io/guides/developer/objects/object-model and https://docs.sui.io/concepts/dynamic-fields.
- **Shared vs owned paths:** Checkout uses shared listings/currencies for discovery, but burns an owned `DiscountTicket` to keep redemption parallel. Sui’s fast path for owned objects has no consensus hop, unlike EVM where all state writes are sequenced in the same block. Docs: ownership and shared objects (https://docs.sui.io/guides/developer/objects/object-ownership).
- **Packages are objects (immutable code):** Publishing creates an immutable package object. There is no mutable “contract code” slot like `delegatecall` proxies in Solidity. Docs: packages (https://docs.sui.io/concepts/sui-move-concepts/packages).
- **Upgrading with UpgradeCap:** New versions are published alongside the old one; data migrations are explicit, gated by `UpgradeCap`, and callers opt into the new package ID. Solidity-style in-place proxy upgrades aren’t available. Docs: https://docs.sui.io/concepts/sui-move-concepts/packages/upgrade.
- **No inheritance, compose with modules/generics:** Move has no inheritance or dynamic dispatch; reuse is via modules, functions, and type parameters (e.g., `ShopItem<phantom TItem>`). Docs: https://docs.sui.io/concepts/sui-move-concepts
- **Coin registry integration instead of ERC-20 metadata:** `add_accepted_currency` pulls decimals/symbol from the shared `coin_registry` and stores them on the `AcceptedCurrency` object, avoiding the spoofed-decimals risk of unverified ERC-20s. See registry calls inside `move/sources/shop.move`. Docs: https://docs.sui.io/references/framework/sui_sui/coin_registry.
- **Oracle feeds as objects:** Prices come from a `price_info::PriceInfoObject` passed into the PTB;
  `quote_amount_with_guardrails` wraps `pyth::get_price_no_older_than` and enforces status/σ guards
  before converting. Unlike Chainlink address lookups, callers must present the feed object and
  recent update data. Docs: https://docs.sui.io/guides/developer/app-examples/oracle.
- **Data access stack (gRPC, indexer, custom):** Sui exposes fullnode gRPC/WebSocket streams plus a GraphQL indexer; custom indexers can process events like `PurchaseCompletedEvent` without managing RPC trace reorgs common on EVM. Docs: https://docs.sui.io/concepts/data-access/data-serving.
- **Transaction DAG and lifecycle:** Objects record the digest that last mutated them, forming a DAG that clients can traverse to reason about causality; combined with fast-path execution for owned objects, this removes many reentrancy patterns seen on EVM. Docs: https://docs.sui.io/concepts/transactions/transaction-lifecycle.
- **Consensus (Mysticeti) characteristics:** Shared-object transactions go through Sui’s consensus, which targets sub-second finality and high throughput by ordering a DAG of certificates rather than serial block mining. For this shop, shared writes (listing updates) wait for consensus while owned-coin spends in checkout can still batch in the same PTB. Docs: https://docs.sui.io/concepts/sui-architecture/consensus.
- **PTB composition:** Sui lets clients chain calls at runtime in a single PTB (up to 1,024 commands). This repo uses PTBs to update Pyth and purchase in one atomic flow. Docs: https://docs.sui.io/concepts/transactions/prog-txn-blocks.

Minimal PTB Examples
--------------------
**Create shop**
```
create_shop(b"Shop", &mut ctx);
```

**Rotate payout address**
```
update_shop_owner(
    &mut shop,
    &mut owner_cap,
    /* new_owner */ payout_address,
    &mut ctx
);
```

**List an item**
```
add_item_listing<ItemType>(
    &mut shop,
    b"Example Item",
    /* usd_cents */ 125_00,
    /* stock */ 10,
    /* spotlight template */ none,
    &owner_cap,
    &mut ctx
);
```

**Register USDC feed**
```
add_accepted_currency<USDC>(
    &mut shop,
    &owner_cap,
    &usdc_currency,
    /* feed_id */ feed_id_bytes,
    /* pyth_object_id */ pyth_obj_id,
    &price_info_object,
    /* max_price_age_secs_cap */ none, // Optional tightenings; defaults enforce module caps.
    /* max_confidence_ratio_bps_cap */ none,
    /* max_price_status_lag_secs_cap */ none, // Allowed attestation/publish skew.
    &mut ctx
);
```

**Buy with price guardrails**
```
buy_item<ItemType, USDC>(
    &shop,
    &mut listing,
    &accepted_usdc,
    &price_info_object,
    payment_coin,
    /* mint_to */ recipient,
    /* refund_extra_to */ payer,
    /* max_price_age_secs */ some(60),
    /* max_confidence_ratio_bps */ some(1_000),
    &clock,
    &mut ctx
);
```

**Claim and spend a discount in one PTB**
```
claim_and_buy_item_with_discount<ItemType, USDC>(
    &shop,
    &mut listing,
    &accepted_usdc,
    &mut discount_template,
    &price_info_object,
    payment_coin,
    /* mint_to */ recipient,
    /* refund_extra_to */ payer,
    /* max_price_age_secs */ none,
    /* max_confidence_ratio_bps */ none,
    &clock,
    &mut ctx
);
```

Reference
---------
- Module: `sui_oracle_market::shop`
- Entry functions: `create_shop`, `disable_shop`, `update_shop_owner`, `add_item_listing`, `update_item_listing_stock`, `remove_item_listing`, `add_accepted_currency`, `remove_accepted_currency`, `create_discount_template`, `update_discount_template`, `toggle_discount_template`, `attach_template_to_listing`, `clear_template_from_listing`, `claim_discount_ticket`, `prune_discount_claims`, `buy_item`, `buy_item_with_discount`, `claim_and_buy_item_with_discount`.
- Key types: `Shop`, `ShopOwnerCap`, `ItemListing`, `AcceptedCurrency`, `DiscountTemplate`, `DiscountTicket`, `ShopItem`
- Events: `ShopCreatedEvent`, `ShopOwnerUpdatedEvent`, `ShopDisabledEvent`, `ItemListingAddedEvent`, `ItemListingStockUpdatedEvent`, `ItemListingRemovedEvent`, `DiscountTemplateCreatedEvent`, `DiscountTemplateUpdatedEvent`, `DiscountTemplateToggledEvent`, `AcceptedCoinAddedEvent`, `AcceptedCoinRemovedEvent`, `DiscountClaimedEvent`, `DiscountRedeemedEvent`, `PurchaseCompletedEvent`, `MintingCompletedEvent`.

Vendored deps (Pyth/Wormhole)
----------------------------
For **testnet** builds/publishes, we intentionally vendor Pyth + Wormhole sources and patch their manifests.
This avoids resolver edge-cases (notably duplicate named-address definitions like `wormhole`) and keeps the Sui framework revision consistent.

Where the vendored packages live:
- `packages/dapp/move/pyth-upstream-patched`
- `packages/dapp/move/wormhole-upstream-patched`

How dependency resolution works:
- `packages/dapp/move/oracle-market` depends on the vendored Pyth by default.
- `localnet` swaps Pyth to `pyth-mock` via `dep-replacements`.

Update instructions
-------------------
When updating Pyth/Wormhole versions, do the following in order.

1) Refresh vendored sources
- Replace the contents of:
    - `packages/dapp/move/pyth-upstream-patched/sources/`
    - `packages/dapp/move/wormhole-upstream-patched/sources/`
    with the new upstream sources you want to pin to.

2) Keep these manifest invariants
- `packages/dapp/move/pyth-upstream-patched/Move.toml`
    - `edition = "legacy"`
    - MUST NOT define an `[addresses] wormhole = ...` entry (Wormhole owns the `wormhole` named address in this repo)
    - MUST define `[addresses] pyth = "<pyth package id>"`
    - MUST depend on the same Sui framework revision as the rest of the repo
    - MUST depend on local Wormhole: `[dependencies.Wormhole] local = "../wormhole-upstream-patched"`

- `packages/dapp/move/wormhole-upstream-patched/Move.toml`
    - `edition = "legacy"`
    - MUST define `[addresses] wormhole = "<wormhole package id>"`
    - MUST depend on the same Sui framework revision as the rest of the repo

3) Re-pin the lockfile
- From `packages/dapp/move/oracle-market`, run:
    - `sui move build -e testnet`
    - `sui move build -e localnet`
    This should update/validate `Move.lock` resolution per-environment.

4) Sanity check publish flow (testnet)
- From repo root:
    - `pnpm --filter dapp move:publish --package-path oracle-market --network testnet`

If you hit `Address 'wormhole' is defined more than once...`, re-check step (2): Pyth must not define the `wormhole` named address.
