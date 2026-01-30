# 09 - Currencies + Oracles

**Path:** [Learning Path](./) > 09 Currencies + Oracles

This chapter wires accepted currencies to Pyth feeds and guardrails.

## 1. Learning goals
1. Register coins as accepted currencies for the shop.
2. Bind each currency to a Pyth PriceInfoObject.
3. Understand freshness and confidence guardrails.

## 2. Prerequisites
1. Localnet running.
2. `sui_oracle_market` published.

## 3. Run it
```bash
# Localnet mock artifacts
pnpm script mock:setup --buyer-address <0x...> --network localnet
cat packages/dapp/deployments/mock.localnet.json

# Register a currency
pnpm script owner:currency:add \
  --coin-type <coinType> \
  --feed-id <feedIdHex> \
  --price-info-object-id <priceInfoObjectId>

pnpm script buyer:currency:list --shop-id <shopId>
```

## 4. EVM -> Sui translation
1. **ERC-20 metadata -> coin registry**: coin decimals/symbol are fetched from the Sui coin registry. See `add_accepted_currency` in `packages/dapp/move/oracle-market/sources/shop.move`.
2. **Oracle address -> PriceInfoObject ID**: Pyth feeds are objects, not just addresses. The currency stores `pyth_object_id` and validates it on-chain. See `AcceptedCurrency` in `packages/dapp/move/oracle-market/sources/shop.move`.
3. **Staleness checks -> guardrails**: guardrails are enforced on-chain and can be tightened by buyers. See `quote_amount_for_price_info_object` in `packages/dapp/move/oracle-market/sources/shop.move`.

## 5. Concept deep dive: coins, registry, and oracles
- **`Coin<T>` as a resource**: payment is a `Coin<T>` object, not a balance. Move conventions
  recommend passing a coin with the exact amount by value for readability. This repo instead
  splits a payment coin and returns change, which is a deliberate deviation from that guidance.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`process_purchase`, `split_payment`, `finalize_purchase_transfers`)
- **Coin registry metadata**: `coin_registry::Currency<T>` provides trusted decimals/symbols.
  This avoids spoofed ERC-20 metadata. The module copies metadata into `AcceptedCurrency`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`add_accepted_currency`)
- **Pyth PriceInfoObject**: oracles are objects. The shop stores a specific `pyth_object_id` and
  checks the feed_id bytes to prevent spoofing. Clients pass the refreshed object into the PTB, and
  the module validates identity and freshness on-chain.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ensure_price_info_matches_currency`)
- **Feed identity is strict**: feed IDs must be 32 bytes, and the `pyth_object_id` must match the
  actual PriceInfoObject you pass in. Both are checked on-chain to block forged inputs.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`assert_price_info_identity`)
- **Clock-based freshness**: `clock::Clock` is a shared object that supplies trusted time for
  guardrails. Price age and status lag are verified on-chain so the UI cannot bypass them.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`quote_amount_for_price_info_object`)
- **Guardrail caps**: sellers set per-currency caps; buyers can only tighten
  `max_price_age_secs`/`max_confidence_ratio_bps`. Status-lag is enforced on-chain using the seller cap.
  This is a protocol-level safety check, not just a UI preference.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`resolve_guardrail_cap`, `resolve_effective_guardrails`)
- **Conservative pricing**: price conversion uses mu-sigma (price minus confidence interval) and
  enforces a max confidence ratio in basis points to avoid undercharging on noisy feeds.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`conservative_price_mantissa`)

## 6. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (AcceptedCurrency, add_accepted_currency, quote_amount_for_price_info_object)
2. `packages/domain/core/src/models/currency.ts` (coin type index + summaries)
3. `packages/domain/core/src/models/pyth.ts` (Pyth config + mock feeds)
4. `packages/dapp/src/scripts/owner/currency-add.ts` (script)
5. PTB builder definition: `packages/domain/core/src/ptb/currency.ts` (buildAddAcceptedCurrencyTransaction)

**Code spotlight: register an AcceptedCurrency**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
entry fun add_accepted_currency<T>(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  currency: &coin_registry::Currency<T>,
  price_info_object: &price_info::PriceInfoObject,
  feed_id: vector<u8>,
  pyth_object_id: obj::ID,
  max_price_age_secs_cap: Option<u64>,
  max_confidence_ratio_bps_cap: Option<u64>,
  max_price_status_lag_secs_cap: Option<u64>,
  ctx: &mut tx::TxContext,
) {
  assert_owner_cap(shop, owner_cap);
  validate_accepted_currency_inputs(
    shop,
    &currency_type<T>(),
    &feed_id,
    &pyth_object_id,
    price_info_object,
  );
  // ...metadata + guardrail setup...
}
```

**Code spotlight: strict oracle identity checks**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
fun assert_price_info_identity(
  expected_feed_id: &vector<u8>,
  expected_pyth_object_id: &obj::ID,
  price_info_object: &price_info::PriceInfoObject,
) {
  let confirmed_price_object = price_info::uid_to_inner(price_info_object);
  assert!(
    confirmed_price_object == *expected_pyth_object_id,
    EPythObjectMismatch,
  );
  let price_info = price_info::get_price_info_from_price_info_object(
    price_info_object,
  );
  let identifier = price_info::get_price_identifier(&price_info);
  let identifier_bytes = price_identifier::get_bytes(&identifier);
  assert!(bytes_equal(expected_feed_id, &identifier_bytes), EFeedIdentifierMismatch);
}
```

**Code spotlight: owner script validates + loads currency inputs**
`packages/dapp/src/scripts/owner/currency-add.ts`
```ts
const existingAcceptedCurrency = await findAcceptedCurrencyByCoinType({
  coinType: inputs.coinType,
  shopId: inputs.shopId,
  suiClient: tooling.suiClient
})
if (existingAcceptedCurrency) {
  logExistingAcceptedCurrency({
    coinType: inputs.coinType,
    existingAcceptedCurrency
  })
  return
}

const shopSharedObject = await tooling.getMutableSharedObject({
  objectId: inputs.shopId
})
const currencySharedObject = await tooling.getImmutableSharedObject({
  objectId: inputs.currencyId
})
const priceInfoSharedObject = await tooling.getImmutableSharedObject({
  objectId: inputs.priceInfoObjectId
})
```

## 7. Worked example: localnet mock USD registration
1. Open `packages/dapp/deployments/mock.localnet.json` and find the entry that matches `LocalMockUsd`.
2. Use its `coinType`, `feedIdHex`, and `priceInfoObjectId`:
```bash
pnpm script owner:currency:add \
  --coin-type <coinType> \
  --feed-id <feedIdHex> \
  --price-info-object-id <priceInfoObjectId>
```
Expected outcome: `buyer:currency:list` shows the mock USD currency for your Shop.

## 8. Exercises
1. Add a currency with a very low `--max-price-age-secs-cap 1` and wait >1s, then try a buy. Expected outcome: the buy aborts due to stale price.
2. Run `pnpm script mock:update-prices` and retry. Expected outcome: the buy succeeds with a fresh price.

## 9. Diagram: currency registration
```
AcceptedCurrency (shared)
  coin_type -> TypeName
  feed_id -> vector<u8>
  pyth_object_id -> ID
  guardrails -> max age / confidence / status lag
```

## 10. Further reading (Sui and Pyth docs)
- https://docs.sui.io/guides/developer/currency
- https://docs.sui.io/references/framework/sui_sui/coin_registry
- https://docs.sui.io/concepts/dynamic-fields
- https://docs.sui.io/guides/developer/app-examples/oracle
- https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/sui

## 11. Navigation
1. Previous: [08 Listings + Typed Receipts](./08-listings-receipts.md)
2. Next: [10 Discounts + Tickets](./10-discounts-tickets.md)
3. Back to map: [Learning Path Map](./)
