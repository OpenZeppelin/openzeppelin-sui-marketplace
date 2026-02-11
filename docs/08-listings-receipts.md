# 08 - Listings + Typed Receipts

**Path:** [Learning Path](./) > 08 Listings + Typed Receipts

Listings are separate shared objects, and purchases mint typed receipts (`ShopItem<TItem>`).

## 1. Learning goals
1. Publish example item types.
2. Add listings with type metadata and inventory.
3. Understand typed receipts as Move resources.

## 2. Prerequisites
1. Localnet running.
2. `sui_oracle_market` published.

## 3. Run it
```bash
pnpm script move:publish --package-path item-examples
# Use the packageId from packages/dapp/deployments/deployment.localnet.json
pnpm script owner:item-listing:add \
  --name "City Commuter Car" \
  --price 12.5 \
  --stock 3 \
  --item-type <itemExamplesPackageId>::items::Car
pnpm script buyer:item-listing:list --shop-id <shopId>
```

## 4. EVM -> Sui translation
1. **Mapping entries -> shared objects**: listings are standalone shared objects indexed by dynamic-field markers under the Shop. See `ItemListing` and `ItemListingMarker` in `packages/dapp/move/oracle-market/sources/shop.move`.
2. **ERC-721 receipt -> typed resource**: the receipt is a `ShopItem<TItem>` whose type must match the listing. See `ShopItem` in `packages/dapp/move/oracle-market/sources/shop.move`.

## 5. Concept deep dive: dynamic fields and type tags
- **Dynamic fields as a membership index**: a dynamic field is a key-value table attached to an
  object. This module stores lightweight marker objects under the shared Shop, keyed by listing ID.
  The marker proves membership without storing the full listing under the Shop, so listing updates
  do not contend on a single shared map. Membership checks use `dynamic_field::exists_with_type`;
  `dynamic_field::borrow` is only needed when you actually read the stored value.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ItemListingMarker`, `add_listing_marker`,
  `assert_listing_registered`)
- **Object-owned children**: dynamic-field children are owned by their parent object, not a wallet.
  That is why you can list/verify membership without relying on address ownership.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (marker structs + dynamic_field usage)
- **TypeName and type tags**: listing types are stored as `TypeName` for runtime checks, events,
  and UI metadata. Compile-time safety still comes from generics (`ShopItem<TItem>`), not from the
  stored value.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ItemListing.item_type`, `ShopItem`)
- **Phantom types for receipts**: `ShopItem<phantom TItem>` records the item type without storing
  the item value. The receipt is a typed proof, not a generic blob, and it guarantees that any
  downstream redemption code can pattern match on `TItem`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ShopItem`)
- **Receipts are transferable, not the asset**: `ShopItem<TItem>` is an owned receipt. It can be
  transferred like any owned object, but it is a proof of purchase, not the actual item itself.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ShopItem`, `mint_shop_item`)
- **Object IDs vs addresses**: on Sui, object IDs are addresses (but not every address is an object ID).
  Prefer storing `ID` on-chain and convert from `UID` with `obj::uid_to_inner` (and only convert to
  addresses when needed for off-chain tooling).
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`listing_id`, events)

## 6. Code references
1. `packages/dapp/move/item-examples/sources/items.move` (Car, Bike, ConcertTicket)
2. `packages/dapp/move/oracle-market/sources/shop.move` (add_item_listing, ShopItem)
3. `packages/domain/core/src/ptb/item-listing.ts` (buildAddItemListingTransaction)
4. `packages/dapp/src/scripts/owner/item-listing-add.ts` (script)
5. PTB builder definition: `packages/domain/core/src/ptb/item-listing.ts`

**Code spotlight: listing creation + marker index**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
entry fun add_item_listing<T: store>(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  name: string::String,
  base_price_usd_cents: u64,
  stock: u64,
  spotlight_discount_template_id: Option<ID>,
  ctx: &mut tx::TxContext,
) {
  let (listing, _listing_id) = shop.add_item_listing_core<T>(
    owner_cap,
    name,
    base_price_usd_cents,
    stock,
    spotlight_discount_template_id,
    ctx,
  );
  txf::share_object(listing);
}
```

**Code spotlight: typed receipt minting**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
fun mint_shop_item<TItem: store>(
  item_listing: &ItemListing,
  clock: &clock::Clock,
  ctx: &mut tx::TxContext,
): ShopItem<TItem> {
  assert_listing_type_matches<TItem>(item_listing);

  ShopItem {
    id: obj::new(ctx),
    shop_address: item_listing.shop_address,
    item_listing_address: item_listing.id.uid_to_inner(),
    item_type: item_listing.item_type,
    name: item_listing.name,
    acquired_at: now_secs(clock),
  }
}
```

**Code spotlight: owner script wires type + listing**
`packages/dapp/src/scripts/owner/item-listing-add.ts`
```ts
const itemType = cliArguments.itemType.trim()
if (!itemType)
  throw new Error("itemType must be a fully qualified Move type.")

return {
  packageId,
  shopId,
  ownerCapId,
  spotlightDiscountId,
  itemType,
  name: cliArguments.name,
  priceCents: parseUsdToCents(cliArguments.price),
  stock: parsePositiveU64(cliArguments.stock, "stock")
}
```

## 6.1 Read this next (deep dive)
- [/reading/move-readme](/reading/move-readme) -> "Shared Object + Marker Pattern (deep dive)"

## 7. Exercises
1. Update stock with `pnpm script owner:item-listing:update-stock --item-listing-id <id> --stock 1`. Expected outcome: stock changes on-chain.
2. Remove a listing with `pnpm script owner:item-listing:remove --item-listing-id <id>`. Expected outcome: it disappears from list output, but the object remains addressable by ID.

## 8. Diagram: dynamic-field markers
```
Shop (shared)
  df: listing_id -> ItemListingMarker
ItemListing (shared)
  fields: shop_address (ID), item_type, price, stock
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/dynamic-fields
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/concepts/sui-move-concepts

## 10. Navigation
1. Previous: [07 Shop Object + Capability Auth](./07-shop-capabilities.md)
2. Next: [09 Currencies + Oracles](./09-currencies-oracles.md)
3. Back to map: [Learning Path Map](./)
