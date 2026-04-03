/// This module defines the `ItemListing` struct, which represents a purchasable item in the oracle market.
module sui_oracle_market::listing;

use std::string::String;
use std::type_name::{Self, TypeName};

// === Errors ===

#[error(code = 0)]
const EListingDiscountCountUnderflow: vector<u8> = "listing discount count underflow";

// === Structs ===

/// Item listing metadata keyed under the shared `Shop`, used to mint specific items on purchase.
/// Discounts can be attached to highlight promotions in the UI.
public struct ItemListing has drop, store {
    /// Stable listing identifier.
    listing_id: ID,
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

// === View Functions ===

/// Returns the listing ID.
public fun id(listing: &ItemListing): ID {
    listing.listing_id
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

/// Returns the spotlight discount ID attached to the listing, if any.
public fun spotlight_discount_id(listing: &ItemListing): Option<ID> {
    listing.spotlight_discount_id
}

// === Package Functions ===

public(package) fun new<T: store>(
    listing_id: ID,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_id: Option<ID>,
): ItemListing {
    ItemListing {
        listing_id,
        item_type: type_name::with_defining_ids<T>(),
        name,
        base_price_usd_cents,
        stock,
        active_bound_discount_count: 0,
        spotlight_discount_id,
    }
}

public(package) fun item_type(listing: &ItemListing): TypeName {
    listing.item_type
}

public(package) fun active_bound_discount_count(listing: &ItemListing): u64 {
    listing.active_bound_discount_count
}

public(package) fun decrement_stock(listing: &mut ItemListing) {
    listing.stock = listing.stock - 1;
}

public(package) fun set_spotlight(listing: &mut ItemListing, template_id: ID) {
    listing.spotlight_discount_id = option::some(template_id);
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
