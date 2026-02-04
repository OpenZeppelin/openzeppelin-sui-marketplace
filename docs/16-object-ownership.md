# 16 - Object Ownership + Versioning

**Path:** [Learning Path](./) > 16 Object Ownership + Versioning

This chapter clarifies Sui ownership types, how versioning works, and how this repo maps those ideas into the shop design.

## 1. Learning goals
1. Understand the ownership types Sui exposes and when each is appropriate.
2. Learn the difference between fastpath (single-owner) and consensus objects.
3. Map ownership and versioning to the Shop, listings, currencies, and tickets.

## 2. Prerequisites
None. This is a conceptual chapter that builds on earlier examples.

## 3. EVM -> Sui translation
1. **Account storage -> object ownership**: data is not tied to a single contract address; each object declares its owner and rules.
2. **Global mutable state -> shared objects**: shared objects are the concurrency boundary, not a single storage map.
3. **Implicit access -> explicit references**: you must pass objects to a PTB; ownership is checked at the protocol level.

## 4. Concept deep dive: ownership types
- **Address-owned objects (fastpath)**: owned by a wallet address. These can execute on the fastpath with low latency. Examples here: `ShopOwnerCap`, `DiscountTicket`, and `ShopItem`.
- **Shared objects (consensus)**: anyone can include them in a transaction, and mutations are
  sequenced by consensus, but module checks still gate what can change. Examples here: `Shop`,
  `ItemListing`, `AcceptedCurrency`, `DiscountTemplate`, and the Pyth `PriceInfoObject`.
- **Object-owned objects**: children owned by another object. This is how dynamic-field markers and per-claimer claims work.
- **Immutable objects**: globally readable, never mutable. Common for package-published constants or registry-like data.

## 5. Concept deep dive: versioning paths
- **Fastpath objects**: address-owned objects execute without consensus and require the latest version in each transaction input. Conflicting transactions from the same owner fail, so avoid signing two transactions against the same version.
- **Immutable objects**: read-only inputs that never change, so they do not participate in version contention.
- **Consensus objects**: shared objects are sequenced by consensus, which simplifies coordination at the cost of higher latency.
- **What this repo chooses**: the Shop and its child shared objects use consensus so listings and currencies can be accessed by anyone. Owned capabilities and tickets use fastpath for low-latency user interactions.

## 6. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (Shop, ShopOwnerCap, DiscountTicket, ItemListingMarker)
2. `packages/domain/core/src/models/shop.ts` (event queries and shop inspection)
3. `packages/tooling/core/src/object-info.ts` (ownership labels and version metadata)

**Code spotlight: ownership encoded at the type level**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
public struct ShopOwnerCap has key, store {
  id: object::UID,
  shop_address: object::ID,
}

public struct DiscountTicket has key, store {
  id: object::UID,
  discount_template_id: object::ID,
  shop_address: object::ID,
  listing_id: Option<object::ID>,
  claimer: address,
}

public struct ItemListingMarker has copy, drop, store {
  listing_id: object::ID,
}
```

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
1. Previous: [03 EVM → Sui Cheatsheet](./03-evm-to-sui.md)
2. Next: [04 Localnet + Publish](./04-localnet-publish.md)
3. Back to map: [Learning Path Map](./)
