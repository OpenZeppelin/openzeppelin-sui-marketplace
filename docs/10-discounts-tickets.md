# 10 - Discounts

**Path:** [Learning Path](./) > 10 Discounts

Discounts are discount records stored under the shared `Shop`. Buyers apply a discount directly during checkout through `buy_item_with_discount`.

## 1. Learning goals
1. Create a discount with a schedule and rule.
2. Attach a discount to a listing for UI spotlight.
3. Redeem a discount directly at checkout.

## 2. Prerequisites
1. Localnet running.
2. `sui_oracle_market` published.
3. A Shop ID and a Listing ID.

## 3. Run it
```bash
pnpm script owner:discount:create \
  --rule-kind percent \
  --value 10 \
  --listing-id <listingId>

pnpm script owner:item-listing:attach-discount \
  --item-listing-id <listingId> \
  --discount-id <discountId>

pnpm script buyer:buy \
  --item-listing-id <listingId> \
  --discount-id <discountId>
```

## 4. EVM -> Sui translation
1. **Coupon codes -> discount records in shop storage**: discounts are stored under shared `Shop` in `discounts: Table<ID, Discount>`.
2. **Per-checkout apply -> direct discount arg**: checkout passes `discount_id` directly to `buy_item_with_discount`.
3. **Redemption limits -> on-discount counters**: `max_redemptions` and `redemptions` enforce bounds without separate ticket objects.

## 5. Lifecycle mechanics
- **Schedules and scoping**: `starts_at` is required; `expires_at` and `max_redemptions` are optional. When `max_redemptions` is set, it must be greater than `0`. Discounts may be listing-scoped via `applies_to_listing`.
- **Redemption guards**: checkout validates discount active state, time window, listing scope, and max redemptions.
- **Clock-based timing**: redemption checks use shared `Clock`, not client time.

## 6. Code references
1. `packages/dapp/contracts/oracle-market/sources/shop.move` (`Discount`, `buy_item_with_discount`)
2. `packages/domain/core/src/models/discount.ts` (rule parsing + status)
3. `packages/dapp/src/scripts/owner/discount-create.ts` (script)
4. `packages/dapp/src/scripts/buyer/buy.ts` (discount-aware checkout)

## 7. Exercises
1. Toggle a discount off with `pnpm script owner:discount:toggle --discount-id <id> --active false` and verify checkout with that discount fails.
2. Create a listing-scoped discount and try redeeming it on a different listing; verify checkout aborts.

## 8. Navigation
1. Previous: [09 Currencies + Oracles](./09-currencies-oracles.md)
2. Next: [17 PTBs + Gas + Fees](./17-ptb-gas.md)
3. Back to map: [Learning Path Map](./)
