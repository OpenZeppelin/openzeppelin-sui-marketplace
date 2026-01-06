# 09 - Object Ownership + Versioning

**Path:** [Learning Path](./) > 09 Object Ownership + Versioning

This chapter clarifies Sui ownership types, how versioning works, and how this repo maps those ideas into the shop design.

## 1. Learning goals
1. Understand the ownership types Sui exposes and when each is appropriate.
2. Learn the difference between fastpath (single-owner) and consensus objects.
3. Map ownership and versioning to the Shop, listings, currencies, and tickets.

## 2. Prereqs
None. This is a conceptual chapter that builds on earlier examples.

## 3. EVM -> Sui translation
1. **Account storage -> object ownership**: data is not tied to a single contract address; each object declares its owner and rules.
2. **Global mutable state -> shared objects**: shared objects are the concurrency boundary, not a single storage map.
3. **Implicit access -> explicit references**: you must pass objects to a PTB; ownership is checked at the protocol level.

## 4. Concept deep dive: ownership types
- **Address-owned objects (fastpath)**: owned by a wallet address. These can execute on the fastpath with low latency. Examples here: `ShopOwnerCap`, `DiscountTicket`, and `ShopItem`.
- **Shared objects (consensus)**: mutable by anyone, sequenced by consensus. Examples here: `Shop`, `ItemListing`, `AcceptedCurrency`, `DiscountTemplate`, and the Pyth `PriceInfoObject`.
- **Object-owned objects**: children owned by another object. This is how dynamic-field markers and per-claimer claims work.
- **Immutable objects**: globally readable, never mutable. Common for package-published constants or registry-like data.
- **Party objects (advanced)**: consensus-owned by a defined party. This repo does not use them, but they can replace some fastpath patterns when multiple parties need coordinated access (the Sui docs recommend party objects over fastpath in multi-party workflows).

## 5. Concept deep dive: versioning paths
- **Fastpath objects**: address-owned or immutable. They must reference the current version in each transaction input. This provides low latency but requires tighter coordination if many parties touch the same object, or you risk equivocation/locks until epoch boundaries.
- **Consensus objects**: shared or party-owned. Consensus assigns versions and sequencing, which simplifies coordination at the cost of higher latency.
- **What this repo chooses**: the Shop and its child shared objects use consensus so listings and currencies can be accessed by anyone. Owned capabilities and tickets use fastpath for low-latency user interactions.

## 6. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (Shop, ShopOwnerCap, DiscountTicket, ItemListingMarker)
2. `packages/domain/core/src/models/shop.ts` (event queries and shop inspection)
3. `packages/tooling/core/src/object-info.ts` (ownership labels and version metadata)

## 7. Exercises
1. Find a `ShopOwnerCap` in your wallet. Expected outcome: you can explain why it is address-owned and fastpath.
2. Inspect a `DiscountTemplate` object ID and verify it is shared. Expected outcome: you can identify a shared object via RPC owner metadata.

## 8. Diagram: ownership layout
```
Address-owned (fastpath): ShopOwnerCap, DiscountTicket, ShopItem
Shared (consensus): Shop, ItemListing, AcceptedCurrency, DiscountTemplate, PriceInfoObject
Object-owned: ItemListingMarker, AcceptedCurrencyMarker, DiscountClaim
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/guides/developer/objects/object-ownership
- https://docs.sui.io/guides/developer/objects/object-ownership/shared
- https://docs.sui.io/guides/developer/objects/object-ownership/address-owned
- https://docs.sui.io/guides/developer/objects/object-ownership/immutable
- https://docs.sui.io/guides/developer/objects/object-ownership/party
- https://docs.sui.io/guides/developer/objects/object-model

## 10. Navigation
1. Previous: [08 Testing + Advanced Topics](./08-advanced.md)
2. Next: [10 PTBs + Gas + Fees](./10-ptb-gas.md)
3. Back to map: [Learning Path Map](./)
