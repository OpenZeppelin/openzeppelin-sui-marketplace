# Learning Path Map

Use this page as the navigation hub for the docs. Each chapter ends with Prev/Next links.

## 1. Start here (linear path)

1. [00 Setup + Quickstart](00-setup.md)
2. [01 Repo Layout + How to Navigate](01-repo-layout.md)
3. [02 Mental Model Shift](02-mental-model-shift.md)
4. [03 EVM → Sui Cheatsheet](03-evm-to-sui.md)
5. [16 Object Ownership + Versioning](16-object-ownership.md)
6. [04 Localnet + Publish](04-localnet-publish.md)
7. [05 Localnet workflow (end-to-end)](05-localnet-workflow.md)
8. [06 Scripts reference (CLI)](06-scripts-reference.md)
9. [07 Shop Object + Capability Auth](07-shop-capabilities.md)
10. [08 Listings + Typed Receipts](08-listings-receipts.md)
11. [09 Currencies + Oracles](09-currencies-oracles.md)
12. [10 Discounts + Tickets](10-discounts-tickets.md)
13. [17 PTBs + Gas + Fees](17-ptb-gas.md)
14. [11 UI reference (setup + localnet execution)](11-ui-reference.md)
15. [12 Buyer Flow + UI](12-buyer-ui.md)
16. [13 Owner Console + Admin Flows](13-owner-ui.md)
17. [14 Advanced (execution model + upgrades)](14-advanced.md)
18. [15 Testing (integration + unit + script framework)](15-testing.md)
19. [18 Data Access + Indexing](18-data-access.md)
20. [19 Moving to Testnet/Mainnet](19-moving-to-testnet.md)
21. [20 Security & Gotchas](20-security.md)
22. [21 Troubleshooting](21-troubleshooting.md)
23. [22 Glossary](22-glossary.md)

## 2. Jump to a goal
1. I want a local chain and published package -> [05 Localnet workflow (end-to-end)](05-localnet-workflow.md)
2. I want to understand shared objects + tables/dynamic fields -> [07 Shop Object + Capability Auth](07-shop-capabilities.md) then [08 Listings + Typed Receipts](08-listings-receipts.md)
3. I want to wire currencies + oracles -> [09 Currencies + Oracles](09-currencies-oracles.md)
4. I want the UI flow -> [11 UI reference (setup + localnet execution)](11-ui-reference.md) then [12 Buyer Flow + UI](12-buyer-ui.md)
5. I want tests -> [15 Testing (integration + unit + script framework)](15-testing.md)
6. I want object ownership + versioning -> [16 Object Ownership + Versioning](16-object-ownership.md)
7. I want PTBs and gas details -> [17 PTBs + Gas + Fees](17-ptb-gas.md)
8. I want data access and indexing -> [18 Data Access + Indexing](18-data-access.md)
9. I want a full setup checklist -> [00 Setup + Quickstart](00-setup.md)

## 3. Related repo guides
1. [/reading/move-readme](/reading/move-readme) (shared object + marker deep dive)
2. [/reading/ui-readme](/reading/ui-readme) (UI setup and localnet execution)
3. `README.md` (repo overview + scripts)

## 4. Concept map (where concepts show up in code)

| Concept | Why it matters | Code anchor | Docs |
| --- | --- | --- | --- |
| Shared objects | Concurrency boundary; avoid global storage contention | `packages/dapp/contracts/oracle-market/sources/shop.move` (Shop, DiscountTemplate) | `docs/07-shop-capabilities.md`, `docs/08-listings-receipts.md` |
| Address-owned objects | Capabilities and receipts live in wallets | `packages/dapp/contracts/oracle-market/sources/shop.move` (ShopOwnerCap, ShopItem) | `docs/07-shop-capabilities.md`, `docs/08-listings-receipts.md` |
| Object-owned children | Table entries and claim markers are owned by parent objects | `packages/dapp/contracts/oracle-market/sources/shop.move` (Shop.listings table entries, DiscountClaim) | `docs/08-listings-receipts.md`, `docs/10-discounts-tickets.md` |
| Ownership types | Fastpath vs consensus trade-offs | `packages/tooling/core/src/object-info.ts` (owner labels) | `docs/16-object-ownership.md` |
| Capabilities | Explicit admin auth via owned objects | `packages/dapp/contracts/oracle-market/sources/shop.move` (ShopOwnerCap) | `docs/07-shop-capabilities.md` |
| Dynamic fields / Table | Typed collections in `Shop` plus per-template claim tracking | `packages/dapp/contracts/oracle-market/sources/shop.move` (`TableVec<Option<ItemListing>>`, `Table<ID, u64>`, `Table<TypeName, AcceptedCurrency>`, `DiscountClaim`) | `docs/08-listings-receipts.md`, `docs/10-discounts-tickets.md` |
| Type tags / TypeName | Runtime type names for listings and coins; compile-time safety still comes from generics | `packages/dapp/contracts/oracle-market/sources/shop.move` (item_type, coin_type) | `docs/08-listings-receipts.md`, `docs/09-currencies-oracles.md` |
| Phantom types | Typed receipts without storing the value | `packages/dapp/contracts/oracle-market/sources/shop.move` (`ShopItem<phantom TItem>`) | `docs/08-listings-receipts.md` |
| `Coin<T>` resources | Payment as objects, not allowances | `packages/dapp/contracts/oracle-market/sources/shop.move` (process_purchase, split_payment, finalize_purchase_transfers) | `docs/09-currencies-oracles.md` |
| Coin registry | Trusted metadata for decimals/symbols | `packages/dapp/contracts/oracle-market/sources/shop.move` (add_accepted_currency) | `docs/09-currencies-oracles.md` |
| Oracle objects (Pyth) | Price feeds are objects with guardrails | `packages/dapp/contracts/oracle-market/sources/shop.move` (quote_amount_for_price_info_object) | `docs/09-currencies-oracles.md` |
| Clock | Trusted time for windows and freshness | `packages/dapp/contracts/oracle-market/sources/shop.move` (now_secs) | `docs/09-currencies-oracles.md`, `docs/10-discounts-tickets.md` |
| PTB composition | Oracle update + buy in one transaction | `packages/domain/core/src/flows/buy.ts` (buildBuyTransaction) | `docs/12-buyer-ui.md` |
| PTB limits + gas | Batching and gas coin handling | `packages/domain/core/src/flows/buy.ts` (maybeSetDedicatedGasForSuiPayments) | `docs/17-ptb-gas.md` |
| Events | Typed logs for UI and indexers | `packages/dapp/contracts/oracle-market/sources/shop.move` (PurchaseCompleted) | `docs/14-advanced.md` |
| TxContext | Object creation and coin splits | `packages/dapp/contracts/oracle-market/sources/shop.move` (object::new, split_payment) | `docs/14-advanced.md` |
| Publisher / init | Publish-time metadata | `packages/dapp/contracts/oracle-market/sources/shop.move` (init, package::claim_and_keep) | `docs/04-localnet-publish.md` |
| UpgradeCap | Package upgrades and access control | `packages/dapp/deployments/deployment.localnet.json` | `docs/04-localnet-publish.md`, `docs/14-advanced.md` |
| test_only helpers | Test scaffolding without prod entry points | `packages/dapp/contracts/oracle-market/sources/shop.move` (#[test_only]) | `docs/14-advanced.md` |
| Data access | Objects + events + table-entry reads in UI | `packages/domain/core/src/models/shop.ts` (event queries) | `docs/18-data-access.md` |
