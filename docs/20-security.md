# 20 - Security & Gotchas (Move/Sui)

**Path:** [Learning Path](./) > 20 Security & Gotchas

This chapter is a practical security pass over this repo’s design. It’s not a general-purpose
Sui security checklist; it’s the set of mistakes that become likely once you start modifying
the shop.

## 1. Threat model (what to assume)
When you write Move for Sui, you should assume:
- The **caller controls the client** (UI/scripts) and can send any PTB they want.
- The caller can pass **any object IDs they own** (and any shared objects they can reference).
- The caller can lie in **pure arguments** (numbers, bytes) and can reorder commands.
- The caller cannot forge ownership: they cannot pass you an object they don’t control, and they
   cannot mutate objects without including the correct object references.

So your safety boundaries are not “which endpoint called this” but:
- which objects the transaction includes, and
- what invariants you enforce before mutating.

## 2. Capabilities are real authority (treat them like keys)
In this repo, admin power is represented by owned objects:
- `ShopOwnerCap`: authorizes shop administration
- `UpgradeCap`: authorizes package upgrades (created at publish time)

If you build owner tooling or UI flows:
- Avoid keeping these objects in a hot wallet used for day-to-day browsing.
- Prefer a dedicated owner key (or multisig) and treat capability transfers as key rotation.
- Never rely on “UI gating” as security. The chain only respects object inputs.

Code anchor (capability check):

From `assert_owner_cap` in `packages/dapp/move/oracle-market/sources/shop.move`:

```move
fun assert_owner_cap(shop: &Shop, owner_cap: &ShopOwnerCap) {
   assert!(
      owner_cap.shop_id == shop.id.uid_to_inner(),
      EInvalidOwnerCap,
   );
}
```

The important part is not “who signed” but “does this capability bind to this shop”.

## 3. Object identity checks (anti-spoofing)
Two recurring “Sui-native” checks show up throughout the module:

### 3.1 Cross-object linkage checks
Shared objects in this design carry a `shop_id` field (e.g., `ItemListing.shop_id`,
`AcceptedCurrency.shop_id`). Before any mutation, the module asserts that:
- the shop matches the object, and
- the object is registered (via dynamic-field marker membership).

This prevents a caller from mixing objects from different shops.

### 3.2 Oracle object identity checks
The oracle input is a shared object (`PriceInfoObject`) supplied by the caller.
You must assume the caller will try to pass the wrong object.

The module defends against this by binding two things:
- the expected Pyth object ID, and
- the expected feed identifier bytes.

From `assert_price_info_identity` in `packages/dapp/move/oracle-market/sources/shop.move`:

```move
fun assert_price_info_identity(
   expected_feed_id: &vector<u8>,
   expected_pyth_object_id: &ID,
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
   assert!(
      bytes_equal(expected_feed_id, &identifier_bytes),
      EFeedIdentifierMismatch,
   );
}
```

If you extend the oracle model (multiple feeds, fallback feeds, cross rates), keep this property:
your on-chain code should be able to prove “this object is the feed we intended” without trusting
the RPC, the UI, or scripts.

## 4. Oracle guardrails (freshness, confidence, status)
Oracles are the main “external dependency” here. The shop enforces guardrails on-chain so
frontends cannot bypass them:
- **Age**: max staleness allowed
- **Confidence**: max $/ ratio (sigma/mu) to reject noisy feeds
- **Status lag**: rejects feeds whose attestation is too far behind publish time

Design detail worth keeping:
- Sellers set **caps** per currency. Buyers can only tighten age/confidence; status-lag is enforced
  using the seller cap. This is similar to slippage limits, but enforced with explicit caps.

If you build new checkout flows, don’t move these checks “off-chain for performance”.
They are correctness checks.

Code anchor (guardrail caps):

From `resolve_effective_guardrails` in `packages/dapp/move/oracle-market/sources/shop.move`:

```move
fun resolve_effective_guardrails(
   max_price_age_secs: &Option<u64>,
   max_confidence_ratio_bps: &Option<u64>,
   accepted_currency: &AcceptedCurrency,
): (u64, u64) {
   let requested_max_age = unwrap_or_default(
      max_price_age_secs,
      accepted_currency.max_price_age_secs_cap,
   );
   let requested_confidence_ratio = unwrap_or_default(
      max_confidence_ratio_bps,
      accepted_currency.max_confidence_ratio_bps_cap,
   );
   let effective_max_age = clamp_max(
      requested_max_age,
      accepted_currency.max_price_age_secs_cap,
   );
   let effective_confidence_ratio = clamp_max(
      requested_confidence_ratio,
      accepted_currency.max_confidence_ratio_bps_cap,
   );
   (effective_max_age, effective_confidence_ratio)
}
```

## 5. Shared-object contention and DoS shape
On Sui, shared objects are the concurrency boundary. If you put too much state behind a single
shared object, you create a performance bottleneck and a DoS surface.

This repo intentionally shards state:
- `Shop` is shared, but most mutations happen on sibling shared objects (`ItemListing`,
   `AcceptedCurrency`, `DiscountTemplate`).
- `Shop` mainly carries markers and small metadata.

When you add new features, sanity-check:
- “Does this force every transaction to touch the `Shop` object?”
- “Does this introduce loops over unbounded dynamic fields in an entry function?”

If you need enumeration, prefer:
- off-chain enumeration + on-chain membership checks, or
- bounded admin-only maintenance functions (like pruning claims) that accept explicit lists.

## 6. Discount tickets: owned objects, single-use, and redemption-bound
Tickets are owned objects, which is great for modeling a one-time right.
But owned objects can be transferred, so you must explicitly define whether transfer should
preserve redemption rights.

This shop chooses a “transferable but redemption-bound” semantics:
- the ticket can move between wallets,
- but redemption checks enforce the original claimer.

You can see that shape in the ticket context assertions (the ticket’s `claimer` must match the
transaction sender).

If you want transferable coupons later, that’s a conscious protocol change: you’ll need a new
rule (e.g., ticket owner == sender) and you’ll be changing the trust/abuse surface.

## 7. Package IDs, upgrades, and environment drift
Two gotchas that bite teams coming from EVM:

1) **New code means new package IDs.**
- Deploy artifacts (`packages/dapp/deployments/deployment.<network>.json`) are the source of truth.
- The UI and scripts must be pinned to the correct package ID for the network.

2) **Localnet regenesis changes every object ID.**
- If you regenesis, all object IDs change and artifacts must be regenerated.

Treat this as part of your operational security: “wrong package ID” is not just a UX bug; it can
turn into signing transactions against a different contract instance than intended.

## 8. Extension checklist (quick)
Before you ship a modification to the Move module:
- Check every entry function for: (a) shop disabled enforcement where appropriate, (b) shop/object
   linkage checks, (c) coin type checks when handling payment.
- Avoid unbounded loops in entry functions.
- Keep oracle identity + guardrails on-chain.
- Decide transfer semantics for any new owned object (is it a receipt? a right? a credential?).

## 9. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (cap checks, oracle identity, guardrails)
2. `packages/domain/core/src/flows/buy.ts` (dev-inspect quote, PTB composition, SUI gas rules)
3. `docs/16-object-ownership.md` (ownership types and how they affect execution)

## 10. Navigation
1. Previous: [19 Moving to Testnet/Mainnet](./19-moving-to-testnet.md)
2. Next: [21 Troubleshooting](./21-troubleshooting.md)
3. Back to map: [Learning Path Map](./)
