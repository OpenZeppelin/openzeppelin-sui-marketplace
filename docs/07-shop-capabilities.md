# 07 - Shop Capabilities (Shop Object + Capability Auth)

**Path:** [Learning Path](./) > 07 Shop Object + Capability Auth

This chapter creates a Shop and ties authority to a capability object.

## 1. Learning goals
1. Create a Shop shared object.
2. Understand `ShopOwnerCap` as the authorization token.
3. Rotate the shop owner address without touching listings.

## 2. Prerequisites
1. Localnet running.
2. `sui_oracle_market` published.

## 3. Run it
```bash
pnpm script owner:shop:create --name "Oracle Shop"
pnpm script buyer:shop:view
pnpm script owner:shop:update-owner --new-owner <0x...>
```

## 4. EVM -> Sui translation
1. **onlyOwner -> capability**: authority is proved by owning `ShopOwnerCap`, not by `msg.sender`. See `ShopOwnerCap` and `update_shop_owner` in `packages/dapp/move/oracle-market/sources/shop.move`.
2. **Constructor -> entry function**: `create_shop` mints both the shared Shop and the owner capability. See `create_shop` in `packages/dapp/move/oracle-market/sources/shop.move` and the script in `packages/dapp/src/scripts/owner/shop-create.ts`.

## 5. Concept deep dive: shared objects and capabilities
- **Shared objects**: `Shop` is shared so anyone can read it and anyone can submit a transaction that
  touches it, but only the right capability can mutate it. Sharing is explicit via `txf::share_object`,
  and shared objects become the concurrency boundary for transactions.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`create_shop`, `Shop`)
- **Ownership types in practice**: `ShopOwnerCap` is address-owned, the Shop is shared, and dynamic
  field markers are object-owned under the Shop. Sui enforces access based on ownership and the
  object references you pass into a PTB.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (ShopOwnerCap, markers)
- **Capability-based auth**: `ShopOwnerCap` is an owned object that proves admin rights. Entry
  functions take it as a parameter and call `assert_owner_cap`. This keeps access control explicit,
  and it allows ownership rotation without changing code or global state.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ShopOwnerCap`, `assert_owner_cap`)
- **TxContext and object creation**: `obj::new(ctx)` creates new objects and assigns IDs. The
  capability and the shop are minted in a single transaction.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`create_shop`, `new_shop`)
- **Public transfer vs sharing**: `txf::public_transfer` moves owned objects to an address; sharing
  creates a global shared object. This mirrors deploy + ownership transfer in a single PTB.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`create_shop`)

## 6. Code references
1. `packages/dapp/move/oracle-market/sources/shop.move` (Shop, ShopOwnerCap, create_shop, update_shop_owner)
2. `packages/domain/core/src/ptb/shop.ts` (buildCreateShopTransaction, buildUpdateShopOwnerTransaction)
3. `packages/dapp/src/scripts/owner/shop-update-owner.ts` (owner rotation)
4. PTB builder definitions: `packages/domain/core/src/ptb/shop.ts`

**Code spotlight: Shop creation + owner cap mint**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
entry fun create_shop(name: string::String, ctx: &mut tx::TxContext) {
  let owner = ctx.sender();
  let shop = new_shop(name, owner, ctx);

  let owner_cap = ShopOwnerCap {
    id: obj::new(ctx),
    shop_address: shop_address(&shop),
    owner,
  };

  txf::share_object(shop);
  txf::public_transfer(owner_cap, owner);
}
```

**Code spotlight: rotate shop ownership on-chain**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
fun update_shop_owner(
  shop: &mut Shop,
  owner_cap: &mut ShopOwnerCap,
  new_owner: address,
  ctx: &mut tx::TxContext,
) {
  assert_owner_cap(shop, owner_cap);

  let previous_owner = shop.owner;
  shop.owner = new_owner;
  owner_cap.owner = new_owner;

  event::emit(ShopOwnerUpdatedEvent {
    shop_address: shop.id.uid_to_inner(),
    previous_owner,
    new_owner,
    shop_owner_cap_id: owner_cap.id.uid_to_inner(),
    rotated_by: ctx.sender(),
  });
}
```

## 7. Exercises
1. Create two shops back to back and list them with `pnpm script buyer:shop:view`. Expected outcome: two distinct Shop IDs.
2. Rotate ownership and verify `owner` changes in the shop overview. Expected outcome: the shop shows the new owner address.

## 8. Diagram: capability-based admin
```
ShopOwnerCap (owned)
    |
    v
update_shop_owner(shop, owner_cap, new_owner)
    |
    v
Shop.owner = new_owner
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/concepts/sui-move-concepts
- https://docs.sui.io/references/framework/sui_sui/tx_context

## 10. Navigation
1. Previous: [06 Scripts reference (CLI)](./06-scripts-reference.md)
2. Next: [08 Listings + Typed Receipts](./08-listings-receipts.md)
3. Back to map: [Learning Path Map](./)
