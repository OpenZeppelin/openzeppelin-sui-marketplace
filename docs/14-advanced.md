# 14 - Advanced

**Path:** [Learning Path](./) > 14 Advanced

This chapter is the “why it works this way” layer: execution surface (entry vs view), shared-object
concurrency, upgrades/package IDs, and the fixed-point math patterns used by the shop.

## 1. Learning goals
1. Understand entry vs view functions and where each is used.
2. Understand shared-object contention and why this repo shards state.
3. Understand package immutability + upgrade mechanics (new package IDs).
4. Recognize the fixed-point patterns used for prices/discounts.

## 2. Prerequisites
1. Localnet running.
2. `sui_oracle_market` published.
3. A Shop created

## 3. Run it (quick inspection)
These are “read-only” workflows that help you build intuition without mutating state.

```bash
# Prints a full snapshot (shop + listings + currencies + discounts)
pnpm script buyer:shop:view
```

```bash
# Quotes a payment amount using dev-inspect (no mutation)
# (Triggered indirectly by the UI and domain SDK; see estimateRequiredAmount)
pnpm script buyer:buy --help
```

## 4. EVM -> Sui translation
1. **Single-threaded storage -> object-level parallelism**: shared objects lock independently. Listings/currencies/templates are separate shared objects to keep concurrency high. See `ItemListing`, `AcceptedCurrency`, and `DiscountTemplate` in `packages/dapp/move/oracle-market/sources/shop.move`.
2. **Proxy upgrades -> new package IDs**: upgrades publish a new package; callers opt into new IDs. See `packages/dapp/move/oracle-market/Move.toml` and `packages/dapp/src/scripts/move/publish.ts` for artifacts.
3. **Blocks -> object DAG**: each object records the last transaction digest that mutated it, giving you causal history per object instead of global block history.

## 5. Concept deep dive: Move execution surface
- **Entry vs public functions**: PTBs can call `entry` functions; other Move modules can call
  `public` functions. Keep `entry` as the transaction surface and route into `public` or private
  helpers for reuse.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`create_shop`, `quote_amount_for_price_info_object`)
- **PTB limits**: a PTB can include up to 1,024 commands, which shapes how much work you can bundle
  into a single transaction. This matters most when you try to batch “admin seeding” or enumerate
  many dynamic-field children in one go.
- **Events**: events are typed structs emitted via `event::emit`. Indexers and UIs rely on them
  instead of scanning contract storage arrays.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (ShopCreated, PurchaseCompleted)
- **Object IDs and addresses**: object IDs are addresses (but not every address is an object ID). We
  still convert between `UID` and address forms for events and off-chain tooling via
  `obj::uid_to_address` and `obj::id_from_address`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (helper functions and events)
- **Transfers and sharing**: `txf::public_transfer` moves owned resources, and `txf::share_object`
  creates shared objects. This pattern replaces EVM-style factory deployments.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`create_shop`, `finalize_purchase_transfers`)
- **TxContext usage**: `tx::TxContext` is needed for object creation (`object::new`) and coin splits.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`split_payment`, `create_shop`)
- **Fixed-point math**: prices are stored in USD cents; discounts use basis points; conversion uses
  u128 scaling and a pow10 table to avoid floating point math.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`POW10_U128`, `quote_amount_with_guardrails`)
- **Fast path vs consensus**: owned-object transactions can execute without consensus ordering,
  while shared-object mutations require consensus. This is why the design splits listings/currencies
  into separate shared objects.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (shared object types)
- **Storage rebates**: destroying objects (e.g., zero-value coins) returns storage rebates, which is
  why `finalize_purchase_transfers` explicitly calls `coin::destroy_zero`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`finalize_purchase_transfers`)
- **Test-only helpers**: `#[test_only]` APIs expose helpers for Move unit tests without shipping
  them as production entry points.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (test_* functions)

## 6. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (entry/view functions, events, math)
2. `packages/domain/core/src/flows/buy.ts` (dev-inspect quote + PTB composition)
3. `packages/dapp/src/scripts/move/publish.ts` (publish artifacts and upgrade-cap capture)

**Code spotlight: view helpers used by dev-inspect**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
public fun listing_exists(shop: &Shop, listing_id: obj::ID): bool {
  dynamic_field::exists_with_type<ItemListingKey, ItemListingMarker>(
    &shop.id,
    ItemListingKey(listing_id),
  )
}

public fun accepted_currency_id_for_type(
  shop: &Shop,
  coin_type: TypeName,
): Option<obj::ID> {
  if (
    dynamic_field::exists_with_type<AcceptedCurrencyTypeKey, obj::ID>(
      &shop.id,
      AcceptedCurrencyTypeKey(coin_type),
    )
  ) {
    opt::some(
      *dynamic_field::borrow<AcceptedCurrencyTypeKey, obj::ID>(
        &shop.id,
        AcceptedCurrencyTypeKey(coin_type),
      )
    )
  } else {
    opt::none()
  }
}
```

## 7. Exercises
1. Find `quote_amount_for_price_info_object` and identify which parts are “identity checks” vs “pricing math”. Expected outcome: you can point to the function that binds feed bytes + object IDs.
2. Find `finalize_purchase_transfers` and explain why it destroys zero-value coins. Expected outcome: you can explain storage rebates at a high level.

## 8. Annotated diff: Solidity vs Move buy flow
```solidity
// Solidity (sketch)
function buy(uint256 listingId, address payToken) external {
  Listing storage listing = listings[listingId];
  require(listing.stock > 0);
  uint256 price = quoteWithOracle(payToken, listing.usdPrice);
  IERC20(payToken).transferFrom(msg.sender, owner, price);
  listing.stock -= 1;
  emit PurchaseCompleted(...);
}
```
```move
// Move (actual shape)
entry fun buy_item<TItem: store, TCoin>(
  shop: &Shop,
  listing: &mut ItemListing,
  accepted_currency: &AcceptedCurrency,
  price_info: &price_info::PriceInfoObject,
  payment_coin: coin::Coin<TCoin>,
  mint_to: address,
  refund_to: address,
  max_price_age_secs: Option<u64>,
  max_confidence_ratio_bps: Option<u64>,
  clock: &clock::Clock,
  ctx: &mut tx::TxContext
) {
  // listing + currency checks
  // oracle guardrails
  // payment coin moved in (convention prefers exact-amount coins; this repo may return change)
  // receipt minted as ShopItem<TItem>
  // events emitted
}
```
**Key differences**
1. Payment is a `Coin<TCoin>` object, not an allowance.
2. Oracle input is a `PriceInfoObject` object (its ID is verified on-chain), not a contract address.
3. The receipt is a typed object, not an event-only proof.

## 9. Diagram: shared vs owned objects in tests
```
Shared: Shop, ItemListing, AcceptedCurrency, DiscountTemplate
Owned: ShopOwnerCap, DiscountTicket, ShopItem
```

## 10. Further reading (Sui docs)
- https://docs.sui.io/guides/developer/sui-101/using-events
- https://docs.sui.io/references/framework/sui_sui/tx_context
- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://docs.sui.io/concepts/sui-move-concepts

## 11. Navigation
1. Previous: [13 Owner Console + Admin Flows](./13-owner-ui.md)
2. Next: [15 Testing (integration + unit + script framework)](./15-testing.md)
3. Back to map: [Learning Path Map](./)
