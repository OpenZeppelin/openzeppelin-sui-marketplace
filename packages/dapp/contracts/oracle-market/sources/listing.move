/// This module defines the `ItemListing` and `ShopItem` structs, which represents a purchasable item in the oracle market.
module sui_oracle_market::listing;

use std::string::String;
use std::type_name::{Self, TypeName};

// === Errors ===

#[error(code = 0)]
const EEmptyItemName: vector<u8> = "empty item name";
#[error(code = 1)]
const EInvalidPrice: vector<u8> = "invalid price";
#[error(code = 2)]
const EZeroStock: vector<u8> = "zero stock";
#[error(code = 3)]
const EListingDiscountCountUnderflow: vector<u8> = "listing discount count underflow";
#[error(code = 4)]
const EItemTypeMismatch: vector<u8> = "item type mismatch";

// === Structs ===

/// Item listing metadata keyed under the shared `Shop`, used to mint specific items on purchase.
/// Discounts can be attached to highlight promotions in the UI.
public struct ItemListing has drop, store {
    /// Stable listing identifier.
    id: ID,
    /// Runtime type that checkout must mint.
    item_type: TypeName,
    /// Display name shown to buyers.
    name: String,
    /// Stored in USD cents to avoid floating point math.
    base_price_usd_cents: u64,
    /// Remaining inventory for this listing.
    stock: u64,
    /// Number of active discounts pinned to this listing.
    active_bound_discount_count: u64,
    /// Optional discount highlighted in storefront UIs.
    spotlight_discount_id: Option<ID>,
}

/// Shop item type for receipts. `T` is enforced at mint time so downstream
/// Move code can depend on the type system instead of opaque metadata alone.
public struct ShopItem<phantom T> has key, store {
    /// Receipt object ID.
    id: UID,
    /// Shop that minted this item.
    shop_id: ID,
    /// Listing that produced this item.
    item_listing_id: ID,
    /// Type snapshot for downstream verification.
    item_type: TypeName,
    /// Listing name snapshot at purchase time.
    name: String,
    /// Timestamp seconds when purchase completed.
    acquired_at: u64,
}

// === View Functions ===

/// Returns the listing ID.
public fun id(listing: &ItemListing): ID {
    listing.id
}

/// Returns the item type that this listing mints.
public fun item_type(listing: &ItemListing): TypeName {
    listing.item_type
}

/// Returns the listing name.
public fun name(listing: &ItemListing): String {
    listing.name
}

/// Returns the listing base price in USD cents.
public fun base_price_usd_cents(listing: &ItemListing): u64 {
    listing.base_price_usd_cents
}

/// Returns the current stock for a listing.
public fun stock(listing: &ItemListing): u64 {
    listing.stock
}

/// Returns how many active discounts are currently bound to this listing.
public fun active_bound_discount_count(listing: &ItemListing): u64 {
    listing.active_bound_discount_count
}

/// Returns the spotlight discount ID attached to the listing, if any.
public fun spotlight_discount_id(listing: &ItemListing): Option<ID> {
    listing.spotlight_discount_id
}

// === Package Functions ===

/// Creates a new item listing with the provided metadata and returns it.
/// The listing ID is generated from transaction context.
public(package) fun create<T: store>(
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_id: Option<ID>,
    ctx: &mut TxContext,
): ItemListing {
    assert!(stock > 0, EZeroStock);
    assert!(!name.is_empty(), EEmptyItemName);
    assert!(base_price_usd_cents > 0, EInvalidPrice);

    ItemListing {
        id: ctx.fresh_object_address().to_id(),
        item_type: type_name::with_defining_ids<T>(),
        name,
        base_price_usd_cents,
        stock,
        active_bound_discount_count: 0,
        spotlight_discount_id,
    }
}

/// Mints a `ShopItem` for a given `ItemListing`, enforcing the item type and associating it with the minting shop.
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

public(package) fun decrement_stock(listing: &mut ItemListing) {
    listing.stock = listing.stock - 1;
}

public(package) fun set_spotlight(listing: &mut ItemListing, discount_id: ID) {
    listing.spotlight_discount_id = option::some(discount_id);
}

public(package) fun clear_spotlight(listing: &mut ItemListing) {
    listing.spotlight_discount_id = option::none();
}

public(package) fun set_stock(listing: &mut ItemListing, new_stock: u64) {
    listing.stock = new_stock;
}

public(package) fun increment_active_bound_discount_count(listing: &mut ItemListing) {
    listing.active_bound_discount_count = listing.active_bound_discount_count + 1;
}

public(package) fun decrement_active_bound_discount_count(listing: &mut ItemListing) {
    assert!(listing.active_bound_discount_count > 0, EListingDiscountCountUnderflow);

    listing.active_bound_discount_count = listing.active_bound_discount_count - 1;
}
