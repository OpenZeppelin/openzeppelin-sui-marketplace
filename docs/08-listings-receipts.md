# 08 - Listings + Typed Receipts

**Path:** [Learning Path](./) > 08 Listings + Typed Receipts

Listings live inside the shared Shop as a dynamic `Table`, and purchases mint typed receipts
(`ShopItem<TItem>`).

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
1. **Mapping entries -> dynamic tables**: listings are entries in `Shop.listings` (`Table<u64, ItemListing>`). The Shop allocates a numeric `listing_id` and stores listing metadata inside the table—no standalone listing objects or listing markers.
2. **ERC-721 receipt -> typed resource**: the receipt is a `ShopItem<TItem>` whose type must match the listing. See `ShopItem` in `packages/dapp/move/oracle-market/sources/shop.move`.

## 5. Concept deep dive: dynamic collections and type tags
- **Table-backed listings**: `Table` is a dynamic collection backed by dynamic fields, but the
  module uses the standard `table` API instead of raw `dynamic_field` operations. Listings live in
  `Shop.listings`, membership checks use `table::contains`, and reads/mutations use
  `table::borrow(_mut)`.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`Shop.listings`, `add_listing`,
  `borrow_listing`, `assert_listing_registered`)
- **Listing IDs are numeric**: `listing_id` is a `u64` allocated by the Shop. Events and receipts
  carry this numeric ID. Object IDs still exist for shared objects like the Shop, currencies, and
  templates.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`allocate_listing_id`, events, `ShopItem`)
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
- **Listing IDs vs object IDs**: listing IDs are `u64` counters, not object IDs. Object IDs are still
  addresses for shared objects (Shop, AcceptedCurrency, DiscountTemplate). Off-chain tooling should
  treat listing IDs as numeric values.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`listing_id`, events, ShopItem)

## 6. Code references
1. `packages/dapp/move/item-examples/sources/items.move` (Car, Bike, ConcertTicket)
2. `packages/dapp/move/oracle-market/sources/shop.move` (add_item_listing, ShopItem)
3. `packages/domain/core/src/ptb/item-listing.ts` (buildAddItemListingTransaction)
4. `packages/dapp/src/scripts/owner/item-listing-add.ts` (script)
5. PTB builder definition: `packages/domain/core/src/ptb/item-listing.ts`

**Code spotlight: listing creation (table-backed)**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
fun add_item_listing_core<T: store>(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  name: String,
  base_price_usd_cents: u64,
  stock: u64,
  spotlight_discount_template_id: Option<object::ID>,
): u64 {
  assert_owner_cap!(shop, owner_cap);
  let listing_id = shop.allocate_listing_id();
  let listing = new_item_listing<T>(
    shop.id.to_address(),
    listing_id,
    name,
    base_price_usd_cents,
    stock,
    spotlight_discount_template_id,
  );
  shop.add_listing(listing_id, listing);
  listing_id
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
    item_listing_id: item_listing.listing_id,
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
1. Update stock with `pnpm script owner:item-listing:update-stock --item-listing-id <listingId> --stock 1`. Expected outcome: stock changes on-chain.
2. Remove a listing with `pnpm script owner:item-listing:remove --item-listing-id <listingId>`. Expected outcome: the listing disappears from list output; history is available via events.

## 8. Diagram: table-backed listings
```
Shop (shared)
  listings: Table<u64, ItemListing>
ItemListing (stored inside Shop)
  fields: shop_address, item_type, price, stock
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/dynamic-fields
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/concepts/sui-move-concepts

## 10. Navigation
1. Previous: [07 Shop Object + Capability Auth](./07-shop-capabilities.md)
2. Next: [09 Currencies + Oracles](./09-currencies-oracles.md)
3. Back to map: [Learning Path Map](./)
