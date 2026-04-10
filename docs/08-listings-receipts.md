# 08 - Listings + Typed Receipts

**Path:** [Learning Path](./) > 08 Listings + Typed Receipts

Listings are stored inside the shared `Shop` via `Table<ID, ItemListing>`, and purchases mint typed receipts (`ShopItem<T>`).

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

1. **Mapping entries -> table entries under a shared object**: listings are rows in `Shop.listings: Table<ID, ItemListing>`, keyed by object `ID` listing IDs.
2. **ERC-721 receipt -> typed resource**: the receipt is a `ShopItem<T>` whose type must match the listing. See `ShopItem` in `packages/dapp/contracts/oracle-market/sources/listing.move`.

## 5. Concept deep dive: tables and type tags

- **Table-backed listings**: listing create/update/remove paths mutate `Shop.listings` directly with `add`, `borrow_mut`, and `remove`.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`add_item_listing`, `listing_mut`, `remove_item_listing`)
- **Listing IDs are object `ID`s**: IDs are allocated from `TxContext`, emitted in events, and reused by scripts/UI as stable primary keys.
  Code: `packages/dapp/contracts/oracle-market/sources/listing.move` (`create`) and `packages/dapp/contracts/oracle-market/sources/events.move` (`ItemListingAdded`)
- **Off-chain enumeration still reads dynamic-field table entries**: `Table` is backed by dynamic fields, so the SDK discovers rows by reading table entry objects.
  Code: `packages/domain/core/src/models/item-listing.ts` (`getItemListingSummaries`)
- **TypeName and type tags**: listing types are stored as `TypeName` for runtime checks, events, and UI metadata. Compile-time safety still comes from generics (`ShopItem<T>`), not from the stored value.
  Code: `packages/dapp/contracts/oracle-market/sources/listing.move` (`ItemListing.item_type`, `ShopItem`)
- **Phantom types for receipts**: `ShopItem<phantom T>` records the item type without storing the item value.
  Code: `packages/dapp/contracts/oracle-market/sources/listing.move` (`ShopItem`)
- **Receipts are transferable, not the asset**: `ShopItem<T>` is an owned receipt object proving purchase.
  Code: `packages/dapp/contracts/oracle-market/sources/listing.move` (`ShopItem`, `mint_shop_item`)

## 6. Code references

1. `packages/dapp/contracts/item-examples/sources/items.move` (Car, Bike, ConcertTicket)
2. `packages/dapp/contracts/oracle-market/sources/shop.move` (add_item_listing, buy_item)
3. `packages/dapp/contracts/oracle-market/sources/listing.move` (ItemListing, ShopItem, mint_shop_item)
4. `packages/domain/core/src/models/item-listing.ts` (table entry discovery)
5. `packages/domain/core/src/ptb/item-listing.ts` (listing PTB builders)
6. `packages/dapp/src/scripts/owner/item-listing-add.ts` (owner script)

**Code spotlight: listing creation in `Shop.listings`**
`packages/dapp/contracts/oracle-market/sources/shop.move`

```move
public fun add_item_listing<T: store>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_id: Option<ID>,
    ctx: &mut TxContext,
): ID {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Create an item listing.
    let mut listing = listing::create<T>(
        name,
        base_price_usd_cents,
        stock,
        ctx,
    );
    let listing_id = listing.id();

    // Check that spotlight discount id exist.
    // Update listing discount count and set spotlight,
    spotlight_discount_id.do!(|discount_id| {
      listing.increment_discount_count();
        listing.set_spotlight(discount_id);

        // set discount's `applies_to_listing`,
        shop
            .discount_mut(discount_id)
            .set_applies_to_listing(listing_id)
            .do!(|previous_listing_id| {
                let listing = shop.listing_mut(previous_listing_id);

                // and clear the previous listing from spotlight discount if matches the discount id.
                listing.try_clear_matching_spotlight(&discount_id);
                listing.decrement_discount_count();
            });
    });

    shop.listings.add(listing_id, listing);

    events::emit_item_listing_added(shop.id(), listing_id);

    listing_id
}
```

**Code spotlight: typed receipt minting uses object listing ID**
`packages/dapp/contracts/oracle-market/sources/listing.move`

```move
public(package) fun mint_shop_item<T: store>(
  item_listing: &ItemListing,
  shop_id: ID,
  now_sec: u64,
  ctx: &mut TxContext,
): ShopItem<T> {
  assert!(item_listing.item_type == type_name::with_defining_ids<T>(), EItemTypeMismatch);

  ShopItem {
    id: object::new(ctx),
    shop_id,
    item_listing_id: item_listing.id,
    item_type: item_listing.item_type,
    name: item_listing.name,
    acquired_at: now_sec,
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
  table listings: listing_id (ID) -> ItemListing
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
