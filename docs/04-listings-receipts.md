# 04 - Listings + Typed Receipts

**Path:** [Learning Path](./) > 04 Listings + Typed Receipts

Listings are separate shared objects, and purchases mint typed receipts (`ShopItem<TItem>`).

## 1. Learning goals
1. Publish example item types.
2. Add listings with type metadata and inventory.
3. Understand typed receipts as Move resources.

## 2. Prereqs
1. Localnet running.
2. A Shop ID and owner cap.

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
  do not contend on a single shared map. Lookups use `dynamic_field::exists_with_type` and
  `dynamic_field::borrow` for membership checks.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ItemListingMarker`, `add_listing_marker`,
  `assert_listing_registered`)
- **Object-owned children**: dynamic-field children are owned by their parent object, not a wallet.
  That is why you can list/verify membership without relying on address ownership.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (marker structs + dynamic_field usage)
- **TypeInfo and type tags**: listing types are stored as `TypeInfo` so the Move type system can
  enforce what gets minted. This prevents mismatched item types at compile time and lets receipts
  be strongly typed without relying on strings.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ItemListing.item_type`, `ShopItem`)
- **Phantom types for receipts**: `ShopItem<phantom TItem>` records the item type without storing
  the item value. The receipt is a typed proof, not a generic blob, and it guarantees that any
  downstream redemption code can pattern match on `TItem`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ShopItem`)
- **Receipts are transferable, not the asset**: `ShopItem<TItem>` is an owned receipt. It can be
  transferred like any owned object, but it is a proof of purchase, not the actual item itself.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`ShopItem`, `mint_and_transfer_item`)
- **Object IDs vs addresses**: the marker stores an object ID, while events and off-chain code often
  use the address form. Conversion uses `obj::uid_to_address` and `obj::id_from_address`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`listing_id`, events)

## 6. Code references
1. `packages/dapp/move/item-examples/sources/items.move` (Car, Bike, ConcertTicket)
2. `packages/dapp/move/oracle-market/sources/shop.move` (add_item_listing, ShopItem)
3. `packages/domain/core/src/ptb/item-listing.ts` (buildAddItemListingTransaction)
4. `packages/dapp/src/scripts/owner/item-listing-add.ts` (script)
5. PTB builder definition: `packages/domain/core/src/ptb/item-listing.ts`

## 6.1 Read this next (deep dive)
- `packages/dapp/move/README.md` -> "Shared Object + Marker Pattern (deep dive)"

## 7. Exercises
1. Update stock with `pnpm script owner:item-listing:update-stock --item-listing-id <id> --stock 1`. Expected outcome: stock changes on-chain.
2. Remove a listing with `pnpm script owner:item-listing:remove --item-listing-id <id>`. Expected outcome: it disappears from list output, but the object remains addressable by ID.

## 8. Diagram: dynamic-field markers
```
Shop (shared)
  df: listing_id -> ItemListingMarker
ItemListing (shared)
  fields: shop_address, item_type, price, stock
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/dynamic-fields
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/concepts/sui-move-concepts

## 10. Navigation
1. Previous: [03 Shop Object + Capability Auth](./03-shop-capabilities.md)
2. Next: [05 Currencies + Oracles](./05-currencies-oracles.md)
3. Back to map: [Learning Path Map](./)
