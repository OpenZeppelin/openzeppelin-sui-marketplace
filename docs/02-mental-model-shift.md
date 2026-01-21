# 02 - Mental Model Shift: EVM -> Sui

**Path:** [Learning Path](./) > 02 Mental Model Shift

This repo assumes you already think in Solidity. The goal here is not to re-teach smart contracts, but to rewire a few instincts so Sui feels natural.

## 1. Learning goals
1. Understand what changes (objects, ownership, capabilities, packages).
2. Know how this repo is laid out for a linear learning path.
3. Run a quick environment sanity check before touching code.

## 2. EVM -> Sui translation
1. **Contract storage -> objects**: your state lives in owned/shared objects, not in a single contract storage map. See `packages/dapp/move/oracle-market/sources/shop.move` (`Shop`, `ItemListing`, `AcceptedCurrency`).
2. **onlyOwner -> capability**: authority is proved by holding a capability object. See `ShopOwnerCap` in `packages/dapp/move/oracle-market/sources/shop.move`.
3. **Deployment -> publish + instantiate**: publishing creates a package object; stateful instances are created later as shared objects. See publish flow in `packages/dapp/src/scripts/move/publish.ts` and shop creation in `packages/dapp/src/scripts/owner/shop-create.ts`.
4. **Inheritance -> modules + generics**: Move has no inheritance or dynamic dispatch; reuse is done through modules, functions, and type parameters. This repo uses `ShopItem<phantom TItem>` and `Coin<T>` to keep types safe without polymorphism.
5. **Composability -> PTBs**: you compose calls at runtime in a programmable transaction block (PTB), rather than writing a single on-chain "router" contract for every workflow.
6. **Upgrades -> new package + UpgradeCap**: upgrades publish a new package ID gated by an `UpgradeCap`. Callers opt into new package IDs explicitly.

## 3. Concept deep dive: abilities and resources
- **Abilities (`key`, `store`, `copy`, `drop`)**: abilities declare how values can be stored and
  moved. `key` turns a struct into an object with identity. `store` lets it live on-chain. `copy`
  and `drop` opt into value semantics. In this repo, objects like `Shop` and `ShopOwnerCap` are
  `has key, store`, while events are `has copy, drop`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (struct definitions)
- **Resources and ownership**: Move resources must be moved, not copied. Owned objects (like
  `ShopOwnerCap`) are authority tokens. Passing a resource by value is a one-time action, which is
  why a `DiscountTicket` can only be redeemed once.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (ShopOwnerCap, DiscountTicket)
- **Object ownership types**: Sui supports address-owned, shared, immutable, and object-owned
  objects. This repo uses address-owned capabilities/tickets, shared objects for Shop/listings, and
  object-owned dynamic-field children under the Shop or templates.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (ShopOwnerCap, Shop, marker structs)
- **Strings as bytes (`vector<u8>`)**: this module stores user-facing strings as raw `vector<u8>`
  to keep serialization explicit and avoid runtime string dependencies. Convert from UTF-8 at the
  edges (UI/CLI) when needed.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (Shop.name, ItemListing.name)
- **Options instead of sentinels**: optional values use `Option` instead of magic constants.
  This is used for optional listing links, template expiry, and max-redemption caps.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (Option fields)

## 4. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (Shop, ShopOwnerCap, entry functions)
2. `packages/dapp/src/scripts/move/publish.ts` (publish flow + artifacts)
3. `packages/dapp/src/scripts/owner/shop-create.ts` (shop instantiation)

**Code spotlight: object-first state + capability auth**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
public struct ShopOwnerCap has key, store {
  id: obj::UID,
  shop_address: address,
  owner: address,
}

public struct Shop has key, store {
  id: obj::UID,
  owner: address,
  name: vector<u8>,
  disabled: bool,
}
```

**Code spotlight: publish flow resolves package + artifacts**
`packages/dapp/src/scripts/move/publish.ts`
```ts
const fullPackagePath = resolveFullPackagePath(
  path.resolve(tooling.suiConfig.paths.move),
  cliArguments.packagePath
)

const deploymentArtifacts = await loadDeploymentArtifacts(
  tooling.suiConfig.network.networkName
)

if (
  await shouldSkipPublish(
    tooling,
    cliArguments.rePublish,
    deploymentArtifacts,
    fullPackagePath
  )
) {
  logSkippedPublish(tooling.suiConfig.network.networkName, fullPackagePath)
  return
}

await publishPackageToNetwork(
  tooling,
  fullPackagePath,
  derivePublishOptions(tooling.suiConfig.network.networkName, cliArguments)
)
```

**Code spotlight: instantiate a Shop after publish**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
fun create_shop(name: vector<u8>, ctx: &mut tx::TxContext) {
  let owner: address = tx_context::sender(ctx);
  let shop: Shop = new_shop(name, owner, ctx);

  let owner_cap: ShopOwnerCap = ShopOwnerCap {
    id: obj::new(ctx),
    shop_address: shop_address(&shop),
    owner,
  };

  txf::share_object(shop);
  txf::public_transfer(owner_cap, owner);
}
```

## 7. Exercises
1. Open `packages/dapp/move/oracle-market/sources/shop.move` and find `ShopOwnerCap`. Expected outcome: you can explain why it replaces `onlyOwner`.
2. Skim `packages/dapp/src/scripts/move/publish.ts` and list the artifacts it writes. Expected outcome: you can point to `packages/dapp/deployments/deployment.<network>.json`.

## 8. Diagram: object-centric state
```
EVM: contract storage
  Contract
    mapping(listingId => Listing)

Sui: objects + dynamic fields
  Shop (shared)
    dynamic field: listing_id -> ItemListingMarker
  ItemListing (shared)
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/sui-move-concepts
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/references/sui-move
- https://docs.sui.io/concepts/sui-for-ethereum

## 10. Navigation
1. Previous: [01 Repo Layout + How to Navigate](./01-repo-layout.md)
2. Next: [03 EVM → Sui Cheatsheet](./03-evm-to-sui.md)
3. Back to map: [Learning Path Map](./)
