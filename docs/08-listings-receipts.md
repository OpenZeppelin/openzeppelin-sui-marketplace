# 08 - Listings + Typed Receipts

**Path:** [Learning Path](./) > 08 Listings + Typed Receipts

Listings are stored inside the shared `Shop` via `TableVec<Option<ItemListing>>` plus a `listing_indices: Table<ID, u64>` lookup map, and purchases mint typed receipts (`ShopItem<TItem>`).

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
1. **Mapping entries -> table entries under a shared object**: listings are rows in `Shop.listings: TableVec<Option<ItemListing>>`, keyed by stable `ID` listing IDs resolved through `Shop.listing_indices`.
2. **ERC-721 receipt -> typed resource**: the receipt is a `ShopItem<TItem>` whose type must match the listing. See `ShopItem` in `packages/dapp/contracts/oracle-market/sources/shop.move`.

## 5. Concept deep dive: tables and type tags
- **TableVec-backed listings**: listing create/update/remove paths mutate `Shop.listings` slots with tombstones (`Option<ItemListing>`) and use `Shop.listing_indices` for ID lookup.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`add_item_listing_core`, `borrow_listing_mut`, `remove_listing`)
- **Listing IDs are `ID`**: IDs are allocated from `TxContext` (`object::new(...).to_inner()`), emitted in events, and reused by scripts/UI as stable primary keys.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`new_listing_id`, `ItemListingAddedEvent`)
- **Off-chain enumeration still reads dynamic-field table entries**: `Table` is backed by dynamic fields, so the SDK discovers rows by reading table entry objects.
  Code: `packages/domain/core/src/models/item-listing.ts` (`getItemListingSummaries`)
- **TypeName and type tags**: listing types are stored as `TypeName` for runtime checks, events, and UI metadata. Compile-time safety still comes from generics (`ShopItem<TItem>`), not from the stored value.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`ItemListing.item_type`, `ShopItem`)
- **Phantom types for receipts**: `ShopItem<phantom TItem>` records the item type without storing the item value.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`ShopItem`)
- **Receipts are transferable, not the asset**: `ShopItem<TItem>` is an owned receipt object proving purchase.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`ShopItem`, `mint_shop_item`)

## 6. Code references
1. `packages/dapp/contracts/item-examples/sources/items.move` (Car, Bike, ConcertTicket)
2. `packages/dapp/contracts/oracle-market/sources/shop.move` (add_item_listing, buy_item, ShopItem)
3. `packages/domain/core/src/models/item-listing.ts` (table entry discovery)
4. `packages/domain/core/src/ptb/item-listing.ts` (listing PTB builders)
5. `packages/dapp/src/scripts/owner/item-listing-add.ts` (owner script)

**Code spotlight: listing creation in `Shop.listings`**
`packages/dapp/contracts/oracle-market/sources/shop.move`
```move
fun add_item_listing_core<T: store>(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  name: String,
  base_price_usd_cents: u64,
  stock: u64,
  spotlight_discount_template_id: Option<ID>,
  ctx: &mut TxContext,
): ID {
  assert_owner_cap!(shop, owner_cap);
  validate_listing_inputs!(
    shop,
    &name,
    base_price_usd_cents,
    stock,
    spotlight_discount_template_id,
  );

  let shop_id = shop.id.to_inner();
  let listing_id = new_listing_id(ctx);
  let listing = new_item_listing<T>(
    shop_id,
    listing_id,
    name,
    base_price_usd_cents,
    stock,
    spotlight_discount_template_id,
  );
  shop.add_listing(listing);
  event::emit(ItemListingAddedEvent { shop_id, listing_id });
  listing_id
}
```

**Code spotlight: typed receipt minting uses listing object ID**
`packages/dapp/contracts/oracle-market/sources/shop.move`
```move
fun mint_shop_item<TItem: store>(
  item_listing: &ItemListing,
  clock: &clock::Clock,
  ctx: &mut TxContext,
): ShopItem<TItem> {
  assert_listing_type_matches<TItem>(item_listing);

  ShopItem {
    id: object::new(ctx),
    shop_id: item_listing.shop_id,
    item_listing_id: item_listing.listing_id,
    item_type: item_listing.item_type,
    name: item_listing.name,
    acquired_at: now_secs(clock),
  }
}
```

**Code spotlight: owner script parses listing ID from events**
`packages/dapp/src/scripts/owner/item-listing-add.ts`
```ts
const listingId = requireListingIdFromItemListingAddedEvents({
  events: transactionResult.events,
  shopId: inputs.shopId
})

const listingSummary = await getItemListingSummary(
  inputs.shopId,
  listingId,
  tooling.suiClient
)
```

## 6.1 Read this next (deep dive)
- [/reading/move-readme](/reading/move-readme) -> "Shared Object + Marker Pattern (deep dive)"

## 7. Exercises
1. Update stock with `pnpm script owner:item-listing:update-stock --item-listing-id <id> --stock 1`. Expected outcome: stock changes on-chain.
2. Remove a listing with `pnpm script owner:item-listing:remove --item-listing-id <id>`. Expected outcome: it disappears from list output and cannot be fetched by that listing ID.

## 8. Diagram: table-backed listings
```
Shop (shared)
  table_vec listings: index (u64) -> Option<ItemListing>
  table listing_indices: listing_id (ID) -> index (u64)
  table accepted_currencies: coin_type (TypeName) -> AcceptedCurrency
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/dynamic-fields
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/concepts/sui-move-concepts

## 10. Navigation
1. Previous: [07 Shop Object + Capability Auth](./07-shop-capabilities.md)
2. Next: [09 Currencies + Oracles](./09-currencies-oracles.md)
3. Back to map: [Learning Path Map](./)
