# 09 - Currencies + Oracles

**Path:** [Learning Path](./) > 09 Currencies + Oracles

This chapter explains how the shop registers accepted currencies, ties them to Pyth feeds, and enforces oracle guardrails.

## 1. Learning goals
1. Register coin types as accepted currencies for a shop.
2. Understand why currencies are stored in `Table<TypeName, AcceptedCurrency>`.
3. Understand freshness/confidence/status-lag guardrails.

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

# Verify currencies on the shop
pnpm script buyer:currency:list --shop-id <shopId>
```

## 4. EVM -> Sui translation
1. **ERC-20 metadata -> coin registry + typed storage**: metadata comes from `coin_registry::Currency<T>`, and registration writes `AcceptedCurrency` into `shop.accepted_currencies: Table<TypeName, AcceptedCurrency>`.
2. **Oracle address -> PriceInfoObject ID**: feeds are objects, not addresses. `AcceptedCurrency` stores `pyth_object_id` + `feed_id` and checks both on-chain.
3. **Off-chain checks -> on-chain guardrails**: `quote_amount_for_price_info_object` enforces age/confidence/status-lag in Move.

## 5. Why `Table` over `Bag` / `TableVec`
The shop now stores accepted currencies in `Table<TypeName, AcceptedCurrency>` instead of raw dynamic fields or a separate currency object graph.

1. **Keyed lookup is the core operation**: checkout and removal need `coin type -> currency config` directly. `Table` gives typed `contains/borrow/remove` by key.
2. **Strong typing matches the domain**: keys are always `TypeName` and values are always `AcceptedCurrency`; `Bag` is better when key/value types vary.
3. **No index semantics needed**: `TableVec` is for index-based collection behavior. Currency access is by coin type, not by numeric position.
4. **Still dynamic-field backed under the hood**: `Table` compiles to dynamic-field storage but exposes a safer, clearer API in Move.

## 6. Concept deep dive: coins, registry, and oracles
- **`Coin<T>` as payment resource**: checkout consumes `Coin<T>` inputs; no `approve/transferFrom` model.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`process_purchase`, `split_payment`, `finalize_purchase_transfers`)
- **Coin registry metadata**: `coin_registry::Currency<T>` provides symbol/decimals copied into `AcceptedCurrency` during registration.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`add_accepted_currency`)
- **Strict oracle identity checks**: both `pyth_object_id` and `feed_id` must match the provided `PriceInfoObject`.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`assert_price_info_identity`)
- **Clock-based freshness**: age and status-lag are verified on-chain with `clock::Clock`.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`quote_amount_for_price_info_object`)
- **Guardrail caps**: sellers set per-currency caps and buyers may only tighten age/confidence.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`resolve_guardrail_cap`, `resolve_effective_guardrails`)

## 7. Code references
1. `packages/dapp/contracts/oracle-market/sources/shop.move` (`AcceptedCurrency`, `add_accepted_currency`, `remove_accepted_currency`, `quote_amount_for_price_info_object`)
2. `packages/domain/core/src/models/currency.ts` (table enumeration + currency summaries)
3. `packages/tooling/core/src/table.ts` (table helpers)
4. `packages/dapp/src/scripts/owner/currency-add.ts` (registration script)
5. `packages/dapp/src/scripts/owner/currency-remove.ts` (coin-type removal script)

**Code spotlight: register an accepted currency into the table**
`packages/dapp/contracts/oracle-market/sources/shop.move`
```move
entry fun add_accepted_currency<T>(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  currency: &coin_registry::Currency<T>,
  price_info_object: &price_info::PriceInfoObject,
  feed_id: vector<u8>,
  pyth_object_id: ID,
  max_price_age_secs_cap: Option<u64>,
  max_confidence_ratio_bps_cap: Option<u16>,
  max_price_status_lag_secs_cap: Option<u64>,
) {
  assert_owner_cap!(shop, owner_cap);

  let coin_type = currency_type<T>();
  validate_accepted_currency_inputs!(
    shop,
    &coin_type,
    &feed_id,
    &pyth_object_id,
    price_info_object,
  );

  let accepted_currency = new_accepted_currency(
    feed_id,
    pyth_object_id,
    coin_registry::decimals(currency),
    coin_registry::symbol(currency),
    resolve_guardrail_cap!(max_price_age_secs_cap, DEFAULT_MAX_PRICE_AGE_SECS),
    resolve_guardrail_cap!(max_confidence_ratio_bps_cap, DEFAULT_MAX_CONFIDENCE_RATIO_BPS),
    resolve_guardrail_cap!(max_price_status_lag_secs_cap, DEFAULT_MAX_PRICE_STATUS_LAG_SECS),
  );

  table::add(&mut shop.accepted_currencies, coin_type, accepted_currency);
}
```

**Code spotlight: owner script removes by coin type**
`packages/dapp/src/scripts/owner/currency-remove.ts`
```ts
const acceptedCurrency = await requireAcceptedCurrencyByCoinType({
  coinType: inputs.coinType,
  shopId: inputs.shopId,
  suiClient: tooling.suiClient
})

const removeCurrencyTransaction = buildRemoveAcceptedCurrencyTransaction({
  packageId: inputs.packageId,
  shop,
  ownerCapId: inputs.ownerCapId,
  coinType: inputs.coinType
})
```

## 8. Worked example: localnet mock USD registration
1. Open `packages/dapp/deployments/mock.localnet.json` and find `LocalMockUsd`.
2. Use its `coinType`, `feedIdHex`, and `priceInfoObjectId`:
```bash
pnpm script owner:currency:add \
  --coin-type <coinType> \
  --feed-id <feedIdHex> \
  --price-info-object-id <priceInfoObjectId>
```
Expected outcome: `buyer:currency:list` shows the registered currency for your shop.

## 9. Exercises
1. Add a currency with `--max-price-age-secs-cap 1`, wait >1s, then buy. Expected outcome: stale-price abort.
2. Run `pnpm script mock:update-prices` and retry. Expected outcome: buy succeeds with fresh price data.

## 10. Diagram: accepted currency storage
```
Shop (shared)
  accepted_currencies: Table<TypeName, AcceptedCurrency>
    key: coin type (TypeName)
    value: { feed_id, pyth_object_id, decimals, symbol, guardrail caps }
```

## 11. Further reading (Sui and Pyth docs)
- https://docs.sui.io/guides/developer/currency
- https://docs.sui.io/references/framework/sui_sui/coin_registry
- https://docs.sui.io/references/framework/sui/table
- https://docs.sui.io/guides/developer/app-examples/oracle
- https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/sui

## 12. Navigation
1. Previous: [08 Listings + Typed Receipts](./08-listings-receipts.md)
2. Next: [10 Discounts + Tickets](./10-discounts-tickets.md)
3. Back to map: [Learning Path Map](./)
