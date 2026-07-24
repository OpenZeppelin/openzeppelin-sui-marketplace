# 09 - Currencies + Oracles

**Path:** [Learning Path](./) > 09 Currencies + Oracles

This chapter explains how the shop registers accepted currencies, ties them to Pyth feeds, and enforces oracle guardrails.

## 1. Learning goals

1. Register coin types as accepted currencies for a shop.
2. Understand why currencies are stored in `Table<TypeName, AcceptedCurrency>`.
3. Understand freshness and confidence guardrails.

## 2. Prerequisites

1. Localnet running.
2. `sui_oracle_market` published.

## 3. Run it

```bash
# Localnet mock artifacts
pnpm script mock:setup --network localnet
cat packages/dapp/deployments/mock.localnet.json

# Register a currency (the price info object is resolved from the feed id;
# --price-info-object-id is optional and only cross-checked if provided)
pnpm script owner:currency:add \
  --coin-type <coinType> \
  --feed-id <feedIdHex>

# Verify currencies on the shop
pnpm script buyer:currency:list --shop-id <shopId>
```

## 4. EVM -> Sui translation

1. **ERC-20 metadata -> coin registry + typed storage**: metadata comes from `coin_registry::Currency<T>`, and registration writes `AcceptedCurrency` into `shop.accepted_currencies: Table<TypeName, AcceptedCurrency>`.
2. **Oracle address -> Pyth feed id**: feeds are objects, not addresses, but the shop binds a currency to its `feed_id` only. Clients resolve the correct `PriceInfoObject` from that feed id (via the Pyth SDK), and the on-chain check re-reads the feed id out of the supplied object. The object id is not stored or pinned, because the canonical `PriceInfoObject` can change.
3. **Off-chain checks -> on-chain guardrails**: `quote_amount_for_price_info_object` enforces price age and confidence bounds.

## 5. Why `Table` over `Bag` / `TableVec`

The shop now stores accepted currencies in `Table<TypeName, AcceptedCurrency>` instead of raw dynamic fields or a separate currency object graph.

1. **Keyed lookup is the core operation**: checkout and removal need `coin type -> currency config` directly. `Table` gives typed `contains/borrow/remove` by key.
2. **Strong typing matches the domain**: keys are always `TypeName` and values are always `AcceptedCurrency`; `Bag` is better when key/value types vary.
3. **No index semantics needed**: `TableVec` is for index-based collection behavior. Currency access is by coin type, not by numeric position.
4. **Still dynamic-field backed under the hood**: `Table` is implemented with dynamic fields but exposes a safer, clearer API in Move.

## 6. Concept deep dive: coins, registry, and oracles

- **`Coin<T>` as payment resource**: checkout consumes `Coin<T>` inputs; no `approve/transferFrom` model.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`buy_item`, `process_purchase`, `split_payment`)
- **Coin registry metadata**: `coin_registry::Currency<T>` provides symbol/decimals copied into `AcceptedCurrency` during registration.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`add_accepted_currency`)
- **Strict oracle identity check**: the `feed_id` read out of the provided `PriceInfoObject` must equal the currency's stored `feed_id`. Since the `PriceInfoObject` type is minted only by Pyth, that identifier proves which feed the object carries.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`assert_price_info_identity`)
- **One currency per feed**: a `feed_id` can back only one accepted currency. The shop keeps a reverse index `accepted_currency_feeds: Table<vector<u8>, TypeName>` and rejects a second registration that reuses a feed, so a shop cannot price two coins off the same feed.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`add_accepted_currency`, `currency_by_feed`)
- **Clock-based freshness**: age is verified on-chain with `clock::Clock`.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`quote_amount_for_price_info_object`)
- **Guardrail caps**: sellers set per-currency caps and buyers may only tighten age/confidence.
  Code: `packages/dapp/contracts/oracle-market/sources/currency.move` (`resolve_guardrail_cap`, `quote_amount_with_guardrails`)

## 7. Code references

1. `packages/dapp/contracts/oracle-market/sources/shop.move` (`AcceptedCurrency`, `add_accepted_currency`, `remove_accepted_currency`, `quote_amount_for_price_info_object`)
2. `packages/domain/core/src/models/currency.ts` (table enumeration + currency summaries)
3. `packages/tooling/core/src/table.ts` (table helpers)
4. `packages/dapp/src/scripts/owner/currency-add.ts` (registration script)
5. `packages/dapp/src/scripts/owner/currency-remove.ts` (coin-type removal script)

**Code spotlight: register an accepted currency into the table**
`packages/dapp/contracts/oracle-market/sources/shop.move`

```move
public fun add_accepted_currency<C>(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  currency: &Currency<C>,
  price_info_object: &PriceInfoObject,
  feed_id: vector<u8>,
  max_price_age_secs_cap: Option<u64>,
  max_confidence_ratio_bps_cap: Option<u16>,
) {
  assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

  let coin_type = type_name::with_defining_ids<C>();
  // One accepted currency per coin type and one per feed.
  assert!(!shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyExists);
  assert!(!shop.accepted_currency_feeds.contains(feed_id), EAcceptedCurrencyExists);

  // Validate oracle identity (feed id read from the object) before mutating state.
  assert_price_info_identity!(feed_id, price_info_object);

  let accepted_currency = currency::create(
    feed_id,
    currency,
    max_price_age_secs_cap,
    max_confidence_ratio_bps_cap,
  );
  // Index by both coin type and feed id.
  shop.accepted_currencies.add(coin_type, accepted_currency);
  shop.accepted_currency_feeds.add(feed_id, coin_type);

  events::emit_accepted_coin_added(shop.id(), feed_id);
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
2. Use its `coinType` and `feedIdHex` (the price info object is resolved from the feed id):

```bash
pnpm script owner:currency:add \
  --coin-type <coinType> \
  --feed-id <feedIdHex>
```

Expected outcome: `buyer:currency:list` shows the registered currency for your shop.

## 9. Exercises

1. Add a currency with `--max-price-age-secs-cap 1`, wait >1s, then buy. Expected outcome: stale-price abort.
2. Run `pnpm script mock:update-prices` and retry. Expected outcome: buy succeeds with fresh price data.

## 10. Diagram: accepted currency storage

```text
Shop (shared)
  accepted_currencies: Table<TypeName, AcceptedCurrency>
    key: coin type (TypeName)
    value: { feed_id, decimals, symbol, guardrail caps }
  accepted_currency_feeds: Table<vector<u8>, TypeName>
    key: Pyth feed id (bytes)
    value: coin type (TypeName)   // enforces one currency per feed
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
