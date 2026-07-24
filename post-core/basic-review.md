---
stage: review
project: sui-oracle-market
mode: extension
extends: packages/dapp/contracts/oracle-market/sources
status: draft
timestamp: 2026-07-24
author: reviewer
previous_stage: null
tags: [oracle, pyth, currency, dedup, n-01, audit-fix]
---

# sui-oracle-market — Basic Review Report

## Summary

Reviewed the audit2-fix/n-01 changeset: removal of the on-chain `pyth_object_id`
binding (feed id is now the sole oracle identity), enforcement of one accepted
currency per Pyth feed (the N-01 fix), the feed-keyed reverse index and
`currency_by_feed` accessor, the generic `currency_exists<C>`, the event field
rename to `feed_id`, and the localnet pyth-mock `State` registry.

Overall: the changeset is correct, internally consistent, and well tested. The N-01
finding is properly closed. **No Critical, High, or Medium findings.** The
upgrade/deployment concern is resolved: this ships as a **fresh publish** with no
migration of prior deployments (INFO-5). Post-review, the actionable informational
items were fixed: the collision error was split into `ECurrencyTypeExists` /
`EFeedIdentifierExists` (INFO-1), the mock rejects duplicate feed publication with a
dedicated error (INFO-3), test gaps were closed including a purchase-path anti-spoofing
test (INFO-4), and the `owner:currency:add` CLI now makes `--price-info-object-id`
optional with feed-based resolution to match the UI and the docs. INFO-2 (owner can
still bind a coin to a wrong feed) remains an accepted inherent-trust property.

**Verdict: ready for publishing as a fresh deployment.** 98/98 Move tests pass;
`pnpm typecheck` and `pnpm lint` clean.

## Invariant Verification

Inferred from the design intent established for this changeset and the N-01 finding
(no formal invariants artifact exists; audit is `audit/2026-04-v1.1.0.pdf`).

| Invariant | Enforced? | Location | Notes |
|-----------|-----------|----------|-------|
| INV-1: One accepted currency per coin type | ✅ Yes | `add_accepted_currency` — `assert!(!accepted_currencies.contains(coin_type), EAcceptedCurrencyExists)` | Type-key uniqueness |
| INV-2: One accepted currency per feed id (N-01) | ✅ Yes | `add_accepted_currency` — `assert!(!accepted_currency_feeds.contains(feed_id), EAcceptedCurrencyExists)` | Reverse index guard |
| INV-3: `accepted_currencies` and `accepted_currency_feeds` stay consistent | ✅ Yes | `add` writes both; `remove` clears both; no other mutators | Both updated atomically per tx |
| INV-4: A `PriceInfoObject` used for pricing carries the currency's `feed_id` | ✅ Yes | `assert_price_info_identity!` in `add_accepted_currency`, `quote_amount_for_price_info_object`, `process_purchase` | Reads identifier from the Pyth-minted object |
| INV-5: Only the shop owner may add/remove currencies | ✅ Yes | `assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap)` | Capability gate |
| INV-6: `feed_id` is a valid 32-byte identifier | ✅ Yes | Identity check (must equal the object's 32-byte id) + `currency::create` length check | Malformed ids abort before any state write |
| INV-7: `currency_by_feed` resolution is total when the feed exists | ✅ Yes | `currency_by_feed` — contains-check then borrow via the index | Second borrow cannot abort given INV-3 |

## Findings

### Critical
None.

### High
None.

### Medium
None. (The upgrade-compatibility concern originally filed as MED-1 is moot given the
fresh-publish decision — recorded as INFO-5.)

### Informational

#### INFO-1: `EAcceptedCurrencyExists` is now overloaded

**Location:** `add_accepted_currency`

**Issue:** The duplicate-coin-type guard and the duplicate-feed guard originally both
aborted with `EAcceptedCurrencyExists`, so callers could not tell which constraint
failed from the abort code.

**Impact:** Diagnostics only.

**Resolution (fixed):** Split into two dedicated errors — `ECurrencyTypeExists` (code 4)
for a duplicate coin type and `EFeedIdentifierExists` (code 6, reusing the freed slot)
for a feed already bound to another currency. Tests, docs, and the UI reactive error
mapping updated to distinguish the two.

**Status:** Fixed

#### INFO-2: N-01 residual — owner can still bind a coin to the wrong feed

**Location:** `add_accepted_currency`

**Issue:** Feed uniqueness prevents two coins from sharing one feed, closing the
finding's exploit vector. It does not prevent an owner from binding a single coin to a
feed of a different real asset. That remains owner self-misconfiguration and harms only
the owner (who receives less value), which is inherent owner trust.

**Impact:** None beyond owner self-harm; no external party is affected.

**Recommendation:** Document as accepted (already noted in `docs/20-security.md §3.3`).

**Status:** Acknowledged

#### INFO-3: Mock `publish_price_feed` aborts on duplicate feed registration

**Location:** `pyth-mock` `price_info::publish_price_feed` — `table.add(price_identifier, ...)`

**Issue:** Re-publishing the same feed into the mock `State` aborts on the duplicate
table key. `mock:setup` is idempotent via its artifact cache, so this is not hit in
normal use, but a manual re-seed against a live `State` would abort.

**Impact:** Localnet developer tooling only. Out of production scope.

**Resolution (fixed):** `publish_price_feed` now checks the State feed table and aborts
with a dedicated `EFeedAlreadyPublished` error instead of the table's generic
key-collision abort.

**Status:** Fixed

#### INFO-4: Minor test gaps around the feed index

**Location:** `tests/currency_tests.move`

**Issue:** `currency_by_feed_returns_registered_currency` exercises a single-currency
shop. There is no test that `currency_by_feed` returns the correct entry when multiple
currencies with distinct feeds coexist, and no test that the same coin type can be
re-added after removal (only that a different coin can reuse a freed feed).

**Impact:** Low — the underlying table behavior is standard, and coexisting feed-index
entries are exercised indirectly by an existing two-currency test.

**Resolution (fixed):** Added `currency_by_feed_disambiguates_multiple_currencies` (two
currencies, distinct feeds, each feed resolves to its own entry) and
`add_accepted_currency_allows_readd_after_remove`. Also added a purchase-path
oracle-identity test, `buy_item_rejects_price_info_object_with_mismatched_feed`
(`EFeedIdentifierMismatch`), exercising `process_purchase`'s anti-spoofing check.

**Status:** Fixed

#### INFO-5: Ships as a fresh publish (no in-place upgrade)

**Location:** `Shop` struct, `currency::AcceptedCurrency`, `add_accepted_currency`
signature, `events` payloads.

**Issue:** The struct layout and public-signature changes in this changeset are not
compatible with a Sui in-place package upgrade. This was originally raised as a Medium
finding (MED-1).

**Impact:** None, given the deployment decision below. An in-place `sui client upgrade`
of a prior version would be rejected by the compatibility verifier, but that path is not
being used.

**Resolution:** The dev confirmed this will be a **fresh publish**, and previously
deployed shops are explicitly not a concern (no migration required). No versioned `Shop`
or migration entrypoint is needed.

**Status:** Acknowledged

## Security Checklist Results

- **3.1 Access Control:** Pass. `add`/`remove` gated by `ShopOwnerCap` (`shop_id` match). New read accessors (`currency`, `currency_exists<C>`, `currency_by_feed`) are pure public views, correctly ungated.
- **3.2 Object Safety:** Pass. No leaks. `AcceptedCurrency` (`drop, store`) is created/removed cleanly; `remove` reads `feed_id` from the removed value before it drops. Mock `State` is shared once at publish. No dangling index entries (INV-3).
- **3.3 Arithmetic Safety:** Pass (not materially changed). Pricing math in `currency.move` untouched by this changeset.
- **3.4 Type Safety:** Pass. Generic `C` used consistently; `Table<vector<u8>, TypeName>` key type has the required `copy + drop + store`; feed identity read from the Pyth-typed object is unforgeable.
- **3.5 Reentrancy / Composability:** Pass. Read views are pure; `add`/`remove` are single-tx atomic; no external calls; identity check precedes state mutation.
- **3.6 Economic Security:** Pass for the finding in scope. Feed dedup removes the two-coins-one-feed mispricing vector (see INFO-2 for the residual owner-trust note).
- **3.7 Upgrade Safety:** See MED-1 — struct/signature changes require a fresh publish.

## Test Coverage Assessment

Strong for the new behavior. Passing (98/98 total):
- `add_accepted_currency_rejects_duplicate_feed_id` (INV-2, now `EFeedIdentifierExists`)
- `add_accepted_currency_rejects_duplicate_coin_type` (INV-1, now `ECurrencyTypeExists`)
- `remove_accepted_currency_frees_feed_for_reuse` (INV-3, feed release)
- `add_accepted_currency_allows_readd_after_remove` (INV-3, re-add path)
- `currency_by_feed_returns_registered_currency`, `currency_by_feed_aborts_for_unregistered_feed`, `currency_by_feed_disambiguates_multiple_currencies` (INV-7)
- `buy_item_rejects_price_info_object_with_mismatched_feed` (INV-4, purchase-path anti-spoofing)
- Feed-format validation retargeted to `currency::create` directly.

Gaps: none outstanding (former INFO-4 gaps closed).

## Artifact Drift

- **Artifact:** `docs/09-currencies-oracles.md`, `docs/20-security.md`, `docs/06-scripts-reference.md`, `docs/05-localnet-workflow.md`, `docs/12-buyer-ui.md`, `docs/14-advanced.md`, `packages/dapp/contracts/README.md` → **Stale:** referenced `pyth_object_id`, the two-field identity check, `EPythObjectMismatch`, and a required `--price-info-object-id` → **Current:** feed-only binding, feed-id identity check, feed uniqueness, optional price-info-object-id → **Suggested update:** already reconciled during this session's docs pass; no remaining stale references found on final sweep.

## Extension Mode: Compatibility Check

- **API surface:** `add_accepted_currency` and `currency_exists` signatures changed; `remove_accepted_currency` unchanged; `currency<C>`, `currency_by_feed` added. Event payloads carry `feed_id` instead of the object id. These are fine for the confirmed fresh publish and not intended for an in-place upgrade (INFO-5).
- **Existing invariants preserved:** INV-1 (per-type uniqueness), INV-4 (oracle identity), INV-5 (owner gate) preserved; INV-2 (per-feed uniqueness) newly added and enforced.
- **Frontend:** no code reads the renamed event fields (only `ShopCreated` is decoded), so the event change is non-breaking for the UI/indexer paths present today.

## Recommendation

- **Overall verdict:** Ready for publishing as a fresh deployment.
- **Blocking issues:** None. The deployment-path question (INFO-5) is resolved — fresh publish, no migration.
- **Suggested improvements:** All actionable informational items (INFO-1, INFO-3, INFO-4) have been applied post-review, plus the CLI `--price-info-object-id` optionality alignment. Only INFO-2 remains, as an accepted inherent-trust property.

## Out of Scope

- Pricing/arithmetic internals of `currency.move` (`quote_amount_from_usd_cents`, guardrails) — not changed by this changeset beyond dropping the `pyth_object_id` field; reviewed previously.
- Full audit-grade review of unrelated modules (`discount`, `listing`) — not in this changeset.
- TS/UI runtime verification (a real localnet buy) — covered by the earlier integration run in this session, not re-executed here.
- Gas optimization — targeted security and correctness only.

## Dev Notes

The change cleanly closes N-01 with a minimal two-table model and keeps the type-first
hot path (`currency<C>`) intact. The feed reverse index doubles as both the uniqueness
guard and the `currency_by_feed` lookup. Everything compiles and 95/95 Move tests pass;
`pnpm typecheck` and `pnpm lint` are clean for the TS side.

## Open Questions

1. ~~Deployment path~~ — Resolved: fresh publish, previously deployed shops are not a
   concern (INFO-5).
2. ~~INFO-4 tests~~ — Resolved: added in this pass (disambiguation, re-add, purchase-path mismatch).
