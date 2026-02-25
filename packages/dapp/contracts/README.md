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
- **Objects over contract storage:** The shop is a shared object. Listings, currencies, and discount templates all live in typed collections on `Shop` (`Shop.listings`, `Shop.accepted_currencies`, `Shop.discount_templates`). Edits touch targeted collection entries instead of append-only arrays.
- **Typed coins and receipts:** Payment assets are `Coin<T>` resources with no approvals; receipts are `ShopItem<TItem>` whose type must match the listing to keep downstream logic strongly typed. These receipts can be exchanged in a separate fulfillment or on-chain redemption flow for the actual `TItem`.
- **Clocked, guarded pricing:** Callers pass a refreshed `PriceInfoObject`; the module checks identity, freshness, confidence, and price-status lag against the shared `Clock` before quoting.
- **Events over historical arrays:** Lifecycle events (`PurchaseCompletedEvent`, `DiscountRedeemedEvent`, etc.) are emitted for indexers/UIs instead of storing growing arrays on-chain.

Object Graph (shared + tables)
--------------------------------------
```text
Shop (shared)
├─ listings: TableVec<Option<ItemListing>>
├─ listing_indices: Table<ID, u64>
├─ accepted_currencies: Table<TypeName, AcceptedCurrency>
└─ discount_templates: Table<ID, DiscountTemplate>
   └─ DiscountTemplate (table value)
      └─ claims_by_claimer: Table<address, bool> (enforces one-claim-per-address)
ItemListing (table value under Shop.listings)
└─ fields: listing_id (ID), item_type, base_price_usd_cents, stock, spotlight_discount_template_id, active_bound_template_count
```

Entry Points At A Glance
------------------------
- Shops: `create_shop` mints the shared `Shop` plus the owned `ShopOwnerCap`; `disable_shop` permanently disables buyer flows; `update_shop_owner` rotates the payout/owner fields without touching listings.
- Listings: `add_item_listing<T>` inserts a listing row in `Shop.listings` with USD-cent price, stock, and optional `spotlight_discount_template_id`; `add_item_listing_with_discount_template<T>` atomically creates a listing plus a pinned spotlight template; `update_item_listing_stock`/`remove_item_listing` mutate listing rows by `listing_id: ID`.
- Accepted currencies: `add_accepted_currency<T>` stores an `AcceptedCurrency` value in `shop.accepted_currencies` keyed by `coin_type`, with feed metadata and guardrail caps; `remove_accepted_currency<TCoin>` removes the keyed entry.
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
- Claim limits are enforced via each template's `claims_by_claimer: Table<address, bool>` map; `prune_discount_claims` only works after a template is irrevocably finished.
- Tickets are owned resources bound to the claimer and are burned on redemption to guarantee single-use semantics.

Shared Object + Table Pattern (deep dive)
-----------------------------------------
- What it is: the shop is a shared root. Listings, accepted currencies, and discount templates are all stored in typed collections under the shop. Template claim markers are stored in each template's `claims_by_claimer` table.
- How it works:
  - Discovery: UIs enumerate listing/currency/template table entries. Table keys prove membership without storing large arrays under the shop.
  - Auth: entry functions assert table membership and shop linkage. Foreign rows/templates are rejected.
  - Writes: listing, currency, and template admin ops mutate shop-backed collections. Buyer flows mutate the touched listing and optional template entry state.
  - Delisting: removing a listing row unregisters that listing ID for checkout, but only when no active listing-bound templates remain for that listing.
  - Claims: per-claimer markers live in `claims_by_claimer`, keeping “one claim per address” localized to the template entry.
- Why it helps:
  - Structured state: tables keep lookup and validation logic explicit and typed instead of ad-hoc dynamic marker sets.
  - Stable primary keys: listings and templates both use object IDs, which remain indexer/UI-friendly across tombstoned deletions.
  - Lightweight discovery: table-entry enumeration avoids global scans.
  - Cleaner auth and safety: table membership checks enforce membership on-chain; no trusted off-chain registry is needed.

Sui Move Principles, Applied
----------------------------
- Resource-first design: coins, tickets, receipts, and capabilities are owned objects moved in/out of entry functions instead of balances in contract storage.
- Capability-based auth: every admin path requires `ShopOwnerCap`.
- Shared-object composition: the `Shop` is shared; listings/currencies/templates are table-backed collections under the shared root.
- Strong typing over metadata: listings embed `TypeName` for runtime checks and UI metadata, while
  checkout asserts the `TItem` type to mint the correct `ShopItem<TItem>` with no opaque "token type" ints.
- Explicit data freshness: time comes from `Clock`, price data from `PriceInfoObject`, and both are validated inline so view-only RPC calls are unnecessary.
- Event-driven observability: analytics and UIs follow events instead of reading append-only storage arrays, keeping state lean.

Sui Fundamentals (EVM contrasts)
--------------------------------
- **Explicit capabilities over modifiers:** Admin flows require the owned `ShopOwnerCap` instead of `msg.sender` checks (`add_item_listing`, `update_shop_owner` in `contracts/oracle-market/sources/shop.move`). Docs: Move concepts (https://docs.sui.io/concepts/sui-move-concepts) and object ownership (https://docs.sui.io/guides/developer/objects/object-ownership). Compared to Solidity, callers must physically present the capability object, so auth is enforced by the type system.
- **Typed events for off-chain sync:** Events are structs with `has copy, drop` and are emitted explicitly (`event::emit` blocks across `contracts/oracle-market/sources/shop.move`), which indexers/GraphQL pick up without scanning storage. Solidity logs are untyped bytes; here the struct layout is part of the ABI. Docs: https://docs.sui.io/guides/developer/sui-101/using-events.
- **Object-oriented state and concurrency:** The `Shop` is shared; listings/currencies/templates are keyed table entries under that shared root. PTBs mutate typed entries rather than monolithic arrays/maps. Docs: https://docs.sui.io/guides/developer/objects/object-model and https://docs.sui.io/concepts/dynamic-fields.
- **Shared vs owned paths:** Checkout mutates the shared `Shop` (listing row and optional template entry state) while burning an owned `DiscountTicket` to keep redemption single-use. Sui’s fast path for owned objects has no consensus hop, unlike EVM where all state writes are sequenced in the same block. Docs: ownership and shared objects (https://docs.sui.io/guides/developer/objects/object-ownership).
- **Packages are objects (immutable code):** Publishing creates an immutable package object. There is no mutable “contract code” slot like `delegatecall` proxies in Solidity. Docs: packages (https://docs.sui.io/concepts/sui-move-concepts/packages).
- **Upgrading with UpgradeCap:** New versions are published alongside the old one; data migrations are explicit, gated by `UpgradeCap`, and callers opt into the new package ID. Solidity-style in-place proxy upgrades aren’t available. Docs: https://docs.sui.io/concepts/sui-move-concepts/packages/upgrade.
- **No inheritance, compose with modules/generics:** Move has no inheritance or dynamic dispatch; reuse is via modules, functions, and type parameters (e.g., `ShopItem<phantom TItem>`). Docs: https://docs.sui.io/concepts/sui-move-concepts
- **Coin registry integration instead of ERC-20 metadata:** `add_accepted_currency` pulls decimals/symbol from the shared `coin_registry` and stores them on the `AcceptedCurrency` object, avoiding the spoofed-decimals risk of unverified ERC-20s. See registry calls inside `contracts/oracle-market/sources/shop.move`. Docs: https://docs.sui.io/references/framework/sui_sui/coin_registry.
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
```move
create_shop(b"Shop".to_string(), &mut ctx);
```

**Rotate payout address**
```move
update_shop_owner(
    &mut shop,
    &mut owner_cap,
    /* new_owner */ payout_address,
    &mut ctx
);
```

**List an item**
```move
add_item_listing<ItemType>(
    &mut shop,
    b"Example Item".to_string(),
    /* usd_cents */ 125_00,
    /* stock */ 10,
    /* spotlight template */ none,
    &owner_cap,
    &mut ctx
);
```

**Register USDC feed**
```move
add_accepted_currency<USDC>(
    &mut shop,
    &owner_cap,
    &usdc_currency,
    &price_info_object,
    /* feed_id */ feed_id_bytes,
    /* pyth_object_id */ pyth_obj_id,
    /* max_price_age_secs_cap */ none, // Optional tightenings; defaults enforce module caps.
    /* max_confidence_ratio_bps_cap */ none,
    /* max_price_status_lag_secs_cap */ none // Allowed attestation/publish skew.
);
```

**Buy with price guardrails**
```move
buy_item<ItemType, USDC>(
    &mut shop,
    /* listing_id */ listing_id,
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
```move
claim_and_buy_item_with_discount<ItemType, USDC>(
    &mut shop,
    /* listing_id */ listing_id,
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
- Entry functions: `create_shop`, `disable_shop`, `update_shop_owner`, `add_item_listing`, `add_item_listing_with_discount_template`, `update_item_listing_stock`, `remove_item_listing`, `add_accepted_currency`, `remove_accepted_currency`, `create_discount_template`, `update_discount_template`, `toggle_discount_template`, `attach_template_to_listing`, `clear_template_from_listing`, `claim_discount_ticket`, `prune_discount_claims`, `buy_item`, `buy_item_with_discount`, `claim_and_buy_item_with_discount`.
- Key types: `Shop`, `ShopOwnerCap`, `ItemListing`, `AcceptedCurrency`, `DiscountTemplate`, `DiscountTicket`, `ShopItem`
- Events: `ShopCreatedEvent`, `ShopOwnerUpdatedEvent`, `ShopDisabledEvent`, `ItemListingAddedEvent`, `ItemListingStockUpdatedEvent`, `ItemListingRemovedEvent`, `DiscountTemplateCreatedEvent`, `DiscountTemplateUpdatedEvent`, `DiscountTemplateToggledEvent`, `AcceptedCoinAddedEvent`, `AcceptedCoinRemovedEvent`, `DiscountClaimedEvent`, `DiscountRedeemedEvent`, `PurchaseCompletedEvent`.

Oracle Dependencies
-------------------
- `packages/dapp/contracts/oracle-market` depends on upstream Pyth + Wormhole via git in `Move.toml`.
- `test-publish` swaps Pyth to `pyth-mock` via `dep-replacements`.

Update instructions
-------------------
When updating Pyth/Wormhole revisions, do the following in order.

1) Update revisions
- Edit the `rev` (or branch/tag) in `packages/dapp/contracts/oracle-market/Move.toml`.

2) Re-pin the lockfile
- From `packages/dapp/contracts/oracle-market`, run:
    - `sui move build -e testnet`
    - `sui move build -e test-publish`
    This should update/validate `Move.lock` resolution per-environment.
