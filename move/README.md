Sui Oracle Market: EVM Dev Quickstart
=====================================

This is a short, Sui-first guide to the `sui_oracle_market::shop` module aimed at Solidity/EVM developers.

Mental Model Shift
------------------
- **Capabilities, not msg.sender:** Authority is explicit. Admin entry points require the `ShopOwnerCap` object minted by `create_shop`; buyers never handle capabilities during checkout.
- **Objects over contract storage:** The shop is a shared object; listings, accepted currencies, and discount templates are dynamic-field children. Edits touch only the relevant child, keeping transactions parallel.
- **Typed coins, no allowances:** Payment assets are `Coin<T>` resources. Callers move coins directly; the module splits what’s owed and refunds change in the same programmable transaction block (PTB).
- **On-chain oracles as objects:** Callers pass a refreshed `PriceInfoObject` so the module can verify feed identity and freshness on-chain (no off-chain lookups).
- **Events over storage reads:** Receipts and lifecycle events (`PurchaseCompleted`, `DiscountRedeem`, etc.) are emitted for indexers/UIs rather than stored arrays.

Object Graph (dynamic fields)
-----------------------------
```
Shop (shared)
├─ ItemListing (df: listing_id -> ItemListing)
│   └─ spotlight_discount_template_id: Option<ID>
├─ AcceptedCurrency (df: accepted_currency_id -> AcceptedCurrency)
│   └─ df: coin_type -> accepted_currency_id (index for lookups)
└─ DiscountTemplate (df: template_id -> DiscountTemplate)
    └─ df: claimer_address -> DiscountClaim (enforces one-claim-per-address)
```

Key Flows
---------
**Create shop**
```
pkg::Publisher (module-scoped) ──create_shop──> Shop (shared) + ShopOwnerCap (owned)
```
Only the package publisher can create curated shops; the capability is then transferred to the operator address for ongoing administration.

**Add listing**
```
ShopOwnerCap + Shop ──add_item_listing<T>──> ItemListing (df child)
```
Each listing is its own object, so inventory updates and purchases lock only that child.

**Register currency**
```
ShopOwnerCap + Currency<T> + PriceInfoObject ──add_accepted_currency<T>──> AcceptedCurrency (df)
```
Stores coin type info, Pyth feed ID, decimals, and symbol. Also writes a secondary df index: `coin_type -> accepted_currency_id`.

**Purchase (no discount)**
```
Buyer Coin<T> + AcceptedCurrency + ItemListing + PriceInfoObject
    └─ buy_item
         ├─ verify feed freshness & identity
         ├─ quote USD cents -> coin amount (μ-σ guardrail)
         ├─ split owed, transfer to shop.owner
         ├─ refund change to refund_extra_to
         └─ mint ShopItem receipt -> mint_to
```
Stock is decremented on the listing child; the shared `Shop` stays read-only for the purchase.

**Discounted purchase**
```
Option A: claim_discount_ticket -> DiscountTicket (owned) -> buy_item_with_discount
Option B: claim_and_buy_item_with_discount (claim + spend in one PTB)
```
Templates live under the shop; tickets are owned and burned on use. Claim limits are enforced by per-claimer child objects.

Best Practices (Sui-flavored)
-----------------------------
- Pass capabilities explicitly; never rely on `tx::sender` for admin paths.
- Keep shared-object mutations minimal. Use dynamic fields to isolate write locks to the smallest child object.
- Carry price info on-chain: require a fresh `PriceInfoObject`, validate feed ID, object ID, and age against the `Clock`.
- Keep caller-tunable guardrails (`max_price_age_secs`, `max_confidence_ratio_bps`) with sensible defaults.
- Emit events for observability; do not accumulate arrays of historical data in storage.
- Prefer explicit destinations (`mint_to`, `refund_extra_to`) so PTBs can represent gifting and custody flows safely.

Minimal PTB Examples
--------------------
**Create shop**
```
// Requires module publisher
create_shop(&publisher, &mut ctx);
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
    &usdc_currency,
    /* feed_id */ feed_id_bytes,
    /* pyth_object_id */ pyth_obj_id,
    &price_info_object,
    /* max_price_age_secs_cap */ none, // Optional tightenings; defaults enforce module caps.
    /* max_confidence_ratio_bps_cap */ none,
    /* max_price_status_lag_secs_cap */ none, // Allowed attestation/publish skew.
    &owner_cap,
    &mut ctx
);
```

**Buy with price guardrails**
```
buy_item<USDC>(
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

Reference
---------
- Module: `sui_oracle_market::shop`
- Key types: `Shop`, `ShopOwnerCap`, `ItemListing`, `AcceptedCurrency`, `DiscountTemplate`, `DiscountTicket`, `ShopItem`
- Events: `ShopCreated`, `ItemListingAdded`, `AcceptedCoinAdded`, `PurchaseCompleted`, `DiscountRedeem`, `MintingCompleted`, and related updates/toggles.
