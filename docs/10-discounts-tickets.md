# 10 - Discounts + Tickets

**Path:** [Learning Path](./) > 10 Discounts + Tickets

Discounts are first-class objects. Claiming a discount mints an owned `DiscountTicket`.

## 1. Learning goals
1. Create a discount template with a schedule and rule.
2. Attach a template to a listing for UI spotlight.
3. Claim a ticket and understand one-claim semantics.

## 2. Prerequisites
1. Localnet running.
2. `sui_oracle_market` published.
3. A Shop ID and a Listing ID.

## 3. Run it
```bash
pnpm script owner:discount-template:create \
  --rule-kind percent \
  --value 10 \
  --listing-id <listingId>

pnpm script owner:item-listing:attach-discount-template \
  --item-listing-id <listingId> \
  --discount-template-id <templateId>

pnpm script buyer:discount-ticket:claim --discount-template-id <templateId>
pnpm script buyer:discount-ticket:list
```

## 4. EVM -> Sui translation
1. **Coupon codes -> template objects**: templates are shared objects attached to the shop via markers. See `DiscountTemplate` and `create_discount_template` in `packages/dapp/move/oracle-market/sources/shop.move`.
2. **Allowlist of claimed addresses -> dynamic fields**: per-claimer `DiscountClaim` objects live under each template. See `DiscountClaim` and `claim_discount_ticket` in `packages/dapp/move/oracle-market/sources/shop.move`.
3. **Redeem with a receipt -> redeem with an owned ticket**: a `DiscountTicket` is an owned object that is burned on redemption. See `buy_item_with_discount` in `packages/dapp/move/oracle-market/sources/shop.move`.

## 5. Concept deep dive: discount lifecycle mechanics
- **Owned tickets as one-time rights**: a `DiscountTicket` is an owned object. Passing it by value
  to `buy_item_with_discount` consumes it, which enforces single-use redemption without extra
  storage or signatures. This is the Move-native way to model a coupon that cannot be reused.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`DiscountTicket`, `buy_item_with_discount`)
- **Dynamic field claims**: each claimer gets a `DiscountClaim` child under the template. This
  prevents multiple claims per wallet without locking the whole shop, and it keeps the one-claim
  rule entirely on-chain.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`claim_discount_ticket`, `DiscountClaim`)
- **Schedules and scoping**: `starts_at` is required, while `expires_at` and `max_redemptions` are
  optional. Templates can also be scoped to a specific listing via `applies_to_listing`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`DiscountTemplate` fields)
- **Claim + redemption caps**: max redemptions are enforced at both claim time and redemption time,
  so a template cannot be over-claimed and then over-redeemed.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`assert_template_claimable`, `assert_discount_redemption_allowed`)
- **Enums for rules and references**: `DiscountRule` and `DiscountRuleKind` encode fixed vs percent
  discounts at the type level to avoid ambiguous numeric inputs. `ReferenceKind` is a small enum
  used for internal lookup paths when validating IDs.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`DiscountRule`, `ReferenceKind`)
- **Clock for windows**: discount windows are checked against the shared `Clock`, not client time.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`assert_discount_redemption_allowed`)

## 6. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (DiscountTemplate, DiscountTicket, claim_discount_ticket)
2. `packages/domain/core/src/models/discount.ts` (rule parsing + status)
3. `packages/dapp/src/scripts/owner/discount-template-create.ts` (script)
4. `packages/dapp/src/scripts/buyer/discount-ticket-claim.ts` (script)
5. PTB builder definition: `packages/domain/core/src/ptb/discount-template.ts` (buildCreateDiscountTemplateTransaction)

**Code spotlight: create a shared DiscountTemplate**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
entry fun create_discount_template(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  applies_to_listing: Option<ID>,
  rule_kind: u8,
  rule_value: u64,
  starts_at: u64,
  expires_at: Option<u64>,
  max_redemptions: Option<u64>,
  ctx: &mut tx::TxContext,
) {
  assert_owner_cap(shop, owner_cap);
  let (
    discount_template,
    discount_template_id,
    discount_rule,
  ) = shop.create_discount_template_core(
    applies_to_listing,
    rule_kind,
    rule_value,
    starts_at,
    expires_at,
    max_redemptions,
    ctx,
  );
  txf::share_object(discount_template);
  let shop_address: ID = shop.id.uid_to_inner();
  event::emit(DiscountTemplateCreatedEvent {
    shop_address,
    discount_template_id,
    rule: discount_rule,
  });
}
```

**Code spotlight: claim a single-use ticket**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
entry fun claim_discount_ticket(
  shop: &Shop,
  discount_template: &mut DiscountTemplate,
  clock: &clock::Clock,
  ctx: &mut tx::TxContext,
): () {
  assert_shop_active(shop);
  assert_template_matches_shop(shop, discount_template);
  let now_secs: u64 = now_secs(clock);
  let (discount_ticket, claimer) = discount_template.claim_discount_ticket_with_event(
    now_secs,
    ctx,
  );
  txf::public_transfer(discount_ticket, claimer);
}
```

**Code spotlight: owner script validates rule + schedule**
`packages/dapp/src/scripts/owner/discount-template-create.ts`
```ts
const ruleKind = parseDiscountRuleKind(cliArguments.ruleKind)
const startsAt = parseNonNegativeU64(
  cliArguments.startsAt ?? defaultStartTimestampSeconds().toString(),
  "startsAt"
)
const expiresAt = parseOptionalU64(cliArguments.expiresAt, "expiresAt")

validateDiscountSchedule(startsAt, expiresAt)

return {
  packageId,
  shopId,
  ownerCapId,
  appliesToListingId: normalizeOptionalId(cliArguments.listingId),
  ruleKind,
  ruleValue: parseDiscountRuleValue(ruleKind, cliArguments.value),
  startsAt,
  expiresAt,
  maxRedemptions: parseOptionalU64(
    cliArguments.maxRedemptions,
    "maxRedemptions"
  )
}
```

**Code spotlight: buyer script loads shared inputs + clock**
`packages/dapp/src/scripts/buyer/discount-ticket-claim.ts`
```ts
const shopShared = await tooling.getMutableSharedObject({
  objectId: shopId
})
const discountTemplateShared = await tooling.getMutableSharedObject({
  objectId: discountTemplateId
})
const sharedClockObject = await tooling.getImmutableSharedObject({
  objectId: SUI_CLOCK_ID
})
```

## 6.1 Read this next (deep dive)
- [/reading/move-readme](/reading/move-readme) -> "Shared Object + Marker Pattern (deep dive)"

## 7. Exercises
1. Try claiming the same template twice. Expected outcome: a Move abort with `EDiscountAlreadyClaimed`.
2. Toggle the template off with `pnpm script owner:discount-template:toggle --discount-template-id <id> --active false`. Expected outcome: new claims are rejected while toggled off.

## 8. Diagram: ticket lifecycle
```
DiscountTemplate (shared)
  df: claimer_address -> DiscountClaim
  |
  v
claim_discount_ticket
  -> DiscountTicket (owned)
  -> DiscountClaim (df child)
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/concepts/dynamic-fields
- https://docs.sui.io/references/framework/sui_sui/tx_context

## 10. Navigation
1. Previous: [09 Currencies + Oracles](./09-currencies-oracles.md)
2. Next: [17 PTBs + Gas + Fees](./17-ptb-gas.md)
3. Back to map: [Learning Path Map](./)
