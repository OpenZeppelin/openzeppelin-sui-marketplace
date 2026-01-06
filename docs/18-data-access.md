# 18 - Data Access + Indexing

**Path:** [Learning Path](./) > 18 Data Access + Indexing

This chapter explains how to read Sui data for apps: object queries, dynamic fields, events, and indexer-backed APIs.

## 1. Learning goals
1. Understand the data access layers Sui exposes (RPC, gRPC, GraphQL).
2. Learn how objects, dynamic fields, and events map to UI reads.
3. Trace how this repo loads storefront data vs wallet-owned data.

## 2. Prereqs
1. Familiarity with `docs/07-shop-capabilities.md` and `docs/08-listings-receipts.md`.

## 3. EVM -> Sui translation
1. **Storage reads -> object queries**: you fetch objects by ID/type rather than reading contract storage slots.
2. **Event logs -> typed events**: events are structured Move types, not raw topics.
3. **Indexer-first UX**: UIs often pair direct RPC reads with indexer-backed queries for historical and aggregate data.

## 4. Concept deep dive: read paths
- **Direct RPC (fullnode)**: best for current state and object ownership.
- **Events**: query by type and sender to track lifecycle changes (listings, purchases, discounts).
- **Dynamic fields**: enumerate markers under a shared object to discover listings and currencies without scanning storage maps.

Code:
1. `packages/domain/core/src/models/shop.ts` (events + shop overview)
2. `packages/domain/core/src/models/item-listing.ts` (dynamic field lookups)
3. `packages/domain/core/src/models/currency.ts` (currency markers)

## 5. Concept deep dive: indexers and GraphQL
- **GraphQL RPC**: backed by an indexer and archival store for history and structured queries.
- **gRPC**: streaming-oriented access for high-throughput consumers.
- **When to use**: RPC for live object state, indexers for analytics and timelines.

## 6. UI mapping
- **Storefront**: shared objects (Shop, listings, currencies, templates).
- **Wallet**: owned objects (tickets, receipts, owner caps).
- **Events**: used to render transaction recaps and history.

Code:
1. `packages/ui/src/app/hooks/useShopDashboardData.tsx`
2. `packages/ui/src/app/components/TransactionRecap.tsx`

## 7. Exercises
1. Run `pnpm script buyer:shop:view` and compare output with `pnpm script buyer:item-listing:list`. Expected outcome: you can trace which calls use dynamic-field enumeration.
2. Query for `PurchaseCompleted` events and verify the most recent buy. Expected outcome: you can see typed event fields (listing, buyer, amount).

## 8. Further reading (Sui docs)
- https://docs.sui.io/concepts/data-access/data-serving
- https://docs.sui.io/concepts/data-access/graphql-rpc
- https://docs.sui.io/concepts/data-access/graphql-indexer
- https://docs.sui.io/concepts/data-access/grpc-overview
- https://docs.sui.io/guides/developer/sui-101/using-events

## 9. Navigation
1. Previous: [15 Testing (integration + unit + script framework)](./15-testing.md)
2. Next: [19 Security & Gotchas](./19-security.md)
3. Back to map: [Learning Path Map](./)
