# 08 - Testing + Advanced Topics

**Path:** [Learning Path](./) > 08 Testing + Advanced Topics

This chapter covers tests, concurrency, upgrades, and a Solidity-vs-Move diff.

## 1. Learning goals
1. Run Move unit tests and script integration tests.
2. Understand shared-object contention and parallelism.
3. See a concrete Solidity -> Move purchase flow diff.

## 2. Prereqs
1. Sui CLI installed.
2. Localnet running (for integration tests).

## 3. Run it (tests)
```bash
pnpm script move:test --package-path oracle-market
pnpm test:integration
pnpm tooling test:unit
pnpm --filter @sui-oracle-market/domain-core test:unit
pnpm ui test:unit
```

## 4. EVM -> Sui translation
1. **Single-threaded storage -> object-level parallelism**: shared objects lock independently. Listings/currencies/templates are separate shared objects to keep concurrency high. See `ItemListing`, `AcceptedCurrency`, and `DiscountTemplate` in `packages/dapp/move/oracle-market/sources/shop.move`.
2. **Proxy upgrades -> new package IDs**: upgrades publish a new package; callers opt into new IDs. See `packages/dapp/move/oracle-market/Move.toml` and `packages/dapp/src/scripts/move/publish.ts` for artifacts.
3. **Blocks -> object DAG**: each object records the last transaction digest that mutated it, giving you causal history per object instead of global block history.

## 5. Concept deep dive: Move execution surface
- **Entry functions vs view functions**: `public entry fun` mutates state and can be called by
  transactions. `#[ext(view)]` functions are read-only and are typically called via dev-inspect.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`create_shop`, `quote_amount_for_price_info_object`)
- **PTB limits**: a PTB can include up to 1,024 commands, which shapes how much work you can bundle
  into a single transaction.
- **Events**: events are typed structs emitted via `event::emit`. Indexers and UIs rely on them
  instead of scanning contract storage arrays.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (ShopCreated, PurchaseCompleted)
- **Object IDs and addresses**: objects have IDs (`obj::UID`), but off-chain tooling often wants
  addresses. The module converts via `obj::uid_to_address` and `obj::id_from_address`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (helper functions and events)
- **Transfers and sharing**: `txf::public_transfer` moves owned resources, and `txf::share_object`
  creates shared objects. This pattern replaces EVM-style factory deployments.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`create_shop`, `refund_or_destroy`)
- **TxContext usage**: `tx::TxContext` is needed for object creation (`obj::new`) and coin splits.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`process_payment`, `create_shop`)
- **Fixed-point math**: prices are stored in USD cents; discounts use basis points; conversion uses
  u128 scaling and a pow10 table to avoid floating point math.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`POW10_U128`, `quote_amount_with_guardrails`)
- **Fast path vs consensus**: owned-object transactions can execute without consensus ordering,
  while shared-object mutations require consensus. This is why the design splits listings/currencies
  into separate shared objects.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (shared object types)
- **Storage rebates**: destroying objects (e.g., zero-value coins) returns storage rebates, which is
  why `refund_or_destroy` explicitly calls `coin::destroy_zero`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`refund_or_destroy`)
- **Test-only helpers**: `#[test_only]` APIs expose helpers for Move unit tests without shipping
  them as production entry points.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (test_* functions)

## 6. Code references
1. `packages/dapp/move/oracle-market/tests/shop_tests.move` (Move tests)
2. `packages/dapp/src/scripts/buyer/test-integration/buyer-scripts.test.ts` (script integration tests)
3. `packages/tooling/node/src/testing/localnet.ts` (localnet harness)

## 7. Exercises
1. Add a Move test that asserts `disable_shop` blocks purchases. Expected outcome: a failing test until you enforce the check, then a passing test.
2. Add a unit test for `resolveDiscountedPriceUsdCents` in `packages/domain/core/src/flows/buy.ts`. Expected outcome: discounts round correctly for fixed and percent cases.

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
public entry fun buy_item<TItem: store, TCoin>(
  shop: &Shop,
  listing: &mut ItemListing,
  accepted_currency: &AcceptedCurrency,
  price_info: &pyth::PriceInfoObject,
  payment_coin: coin::Coin<TCoin>,
  mint_to: address,
  refund_to: address,
  max_price_age_secs: option::Option<u64>,
  max_confidence_ratio_bps: option::Option<u64>,
  clock: &clock::Clock,
  ctx: &mut tx::TxContext
) {
  // listing + currency checks
  // oracle guardrails
  // payment coin moved in, change returned
  // receipt minted as ShopItem<TItem>
  // events emitted
}
```
**Key differences**
1. Payment is a `Coin<TCoin>` object, not an allowance.
2. Oracle input is a `PriceInfoObject` object ID, not an address.
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
1. Previous: [07 Owner Console + Admin Flows](./07-owner-ui.md)
2. Next: [09 Object Ownership + Versioning](./09-object-ownership.md)
3. Back to map: [Learning Path Map](./)
