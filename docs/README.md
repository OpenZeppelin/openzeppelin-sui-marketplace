# Learning Path Map

Use this page as the navigation hub for the docs. Each chapter ends with Prev/Next links.

## 1. Start here (linear path)
1. [00 Setup + Quickstart](00-setup.md)
2. [01 Mental Model Shift](01-intro.md)
3. [02 Localnet + Publish](02-localnet-publish.md)
4. [03 Shop Object + Capability Auth](03-shop-capabilities.md)
5. [04 Listings + Typed Receipts](04-listings-receipts.md)
6. [05 Currencies + Oracles](05-currencies-oracles.md)
7. [06 Discounts + Tickets](06-discounts-tickets.md)
8. [07 Buyer Flow + UI](07-buyer-ui.md)
9. [07 Owner Console + Admin Flows](07-owner-ui.md)
10. [08 Testing + Advanced Topics](08-advanced.md)
11. [09 Object Ownership + Versioning](09-object-ownership.md)
12. [10 PTBs + Gas + Fees](10-ptb-gas.md)
13. [11 Data Access + Indexing](11-data-access.md)
14. [Glossary](glossary.md)

## 2. Jump to a goal
1. I want a local chain and published package -> [02 Localnet + Publish](02-localnet-publish.md)
2. I want to understand shared objects + dynamic fields -> [03 Shop Object + Capability Auth](03-shop-capabilities.md) then [04 Listings + Typed Receipts](04-listings-receipts.md)
3. I want to wire currencies + oracles -> [05 Currencies + Oracles](05-currencies-oracles.md)
4. I want the UI flow -> [07 Buyer Flow + UI](07-buyer-ui.md) then [07 Owner Console + Admin Flows](07-owner-ui.md)
5. I want tests + performance concepts -> [08 Testing + Advanced Topics](08-advanced.md)
6. I want object ownership + versioning -> [09 Object Ownership + Versioning](09-object-ownership.md)
7. I want PTBs and gas details -> [10 PTBs + Gas + Fees](10-ptb-gas.md)
8. I want data access and indexing -> [11 Data Access + Indexing](11-data-access.md)
9. I want a full setup checklist -> [00 Setup + Quickstart](00-setup.md)

## 3. Related repo guides
1. `packages/dapp/move/README.md` (shared object + marker deep dive)
2. `packages/ui/README.md` (UI setup and localnet execution)
3. `README.md` (repo overview + scripts)

## 4. Concept map (where concepts show up in code)

| Concept | Why it matters | Code anchor | Docs |
| --- | --- | --- | --- |
| Shared objects | Concurrency boundary; avoid global storage contention | `packages/dapp/move/oracle-market/sources/shop.move` (Shop, ItemListing) | `docs/03-shop-capabilities.md`, `docs/04-listings-receipts.md` |
| Address-owned objects | Capabilities and receipts live in wallets | `packages/dapp/move/oracle-market/sources/shop.move` (ShopOwnerCap, ShopItem) | `docs/03-shop-capabilities.md`, `docs/04-listings-receipts.md` |
| Object-owned children | Dynamic-field markers are owned by parent objects | `packages/dapp/move/oracle-market/sources/shop.move` (ItemListingMarker, DiscountClaim) | `docs/04-listings-receipts.md`, `docs/06-discounts-tickets.md` |
| Ownership types | Fastpath vs consensus trade-offs | `packages/tooling/core/src/object-info.ts` (owner labels) | `docs/09-object-ownership.md` |
| Capabilities | Explicit admin auth via owned objects | `packages/dapp/move/oracle-market/sources/shop.move` (ShopOwnerCap) | `docs/03-shop-capabilities.md` |
| Dynamic fields | Membership index and discovery without monolithic maps | `packages/dapp/move/oracle-market/sources/shop.move` (ItemListingMarker, DiscountClaim) | `docs/04-listings-receipts.md`, `docs/06-discounts-tickets.md` |
| Type tags / TypeInfo | Compile-time safety for listings and coins | `packages/dapp/move/oracle-market/sources/shop.move` (item_type, coin_type) | `docs/04-listings-receipts.md`, `docs/05-currencies-oracles.md` |
| Phantom types | Typed receipts without storing the value | `packages/dapp/move/oracle-market/sources/shop.move` (ShopItem<phantom TItem>) | `docs/04-listings-receipts.md` |
| Coin<T> resources | Payment as objects, not allowances | `packages/dapp/move/oracle-market/sources/shop.move` (process_payment) | `docs/05-currencies-oracles.md` |
| Coin registry | Trusted metadata for decimals/symbols | `packages/dapp/move/oracle-market/sources/shop.move` (add_accepted_currency) | `docs/05-currencies-oracles.md` |
| Oracle objects (Pyth) | Price feeds are objects with guardrails | `packages/dapp/move/oracle-market/sources/shop.move` (quote_amount_for_price_info_object) | `docs/05-currencies-oracles.md` |
| Clock | Trusted time for windows and freshness | `packages/dapp/move/oracle-market/sources/shop.move` (now_secs) | `docs/05-currencies-oracles.md`, `docs/06-discounts-tickets.md` |
| PTB composition | Oracle update + buy in one transaction | `packages/domain/core/src/flows/buy.ts` (buildBuyTransaction) | `docs/07-buyer-ui.md` |
| PTB limits + gas | Batching and gas coin handling | `packages/domain/core/src/flows/buy.ts` (maybeSetDedicatedGasForSuiPayments) | `docs/10-ptb-gas.md` |
| Events | Typed logs for UI and indexers | `packages/dapp/move/oracle-market/sources/shop.move` (PurchaseCompleted) | `docs/08-advanced.md` |
| View functions | Read-only inspection via dev-inspect | `packages/dapp/move/oracle-market/sources/shop.move` (#[ext(view)]) | `docs/08-advanced.md` |
| TxContext | Object creation and coin splits | `packages/dapp/move/oracle-market/sources/shop.move` (obj::new, coin::split) | `docs/08-advanced.md` |
| Publisher / init | Publish-time metadata | `packages/dapp/move/oracle-market/sources/shop.move` (init, claim_publisher) | `docs/02-localnet-publish.md` |
| UpgradeCap | Package upgrades and access control | `packages/dapp/deployments/deployment.localnet.json` | `docs/02-localnet-publish.md`, `docs/08-advanced.md` |
| test_only helpers | Test scaffolding without prod entry points | `packages/dapp/move/oracle-market/sources/shop.move` (#[test_only]) | `docs/08-advanced.md` |
| Data access | Objects + events + dynamic fields in UI | `packages/domain/core/src/models/shop.ts` (event queries) | `docs/11-data-access.md` |
