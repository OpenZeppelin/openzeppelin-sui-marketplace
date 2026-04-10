/// Events for the marketplace.

module sui_oracle_market::events;

use sui::event;

// === Events ===

/// Event emitted when a shop is created.
public struct ShopCreated has copy, drop {
    /// Created shop ID.
    shop_id: ID,
    /// Created owner capability ID.
    owner_cap_id: ID,
}

/// Event emitted when a shop owner is updated.
public struct ShopOwnerUpdated has copy, drop {
    /// Shop whose owner changed.
    shop_id: ID,
    /// Owner capability used for the update.
    owner_cap_id: ID,
    /// Previous owner address.
    previous_owner: address,
}

/// Event emitted when a shop is toggled active or inactive.
public struct ShopToggled has copy, drop {
    /// Shop that was toggled.
    shop_id: ID,
    /// Owner capability used for the toggle.
    owner_cap_id: ID,
    /// New shop active status.
    active: bool,
}

/// Event emitted when an item listing is added.
public struct ItemListingAdded has copy, drop {
    /// Shop that owns the new listing.
    shop_id: ID,
    /// Created listing ID.
    listing_id: ID,
}

/// Event emitted when listing stock is updated.
public struct ItemListingStockUpdated has copy, drop {
    /// Shop that owns the listing.
    shop_id: ID,
    /// Listing whose stock changed.
    listing_id: ID,
    /// Previous stock.
    previous_stock: u64,
}

/// Event emitted when an item listing is removed.
public struct ItemListingRemoved has copy, drop {
    /// Shop that owned the removed listing.
    shop_id: ID,
    /// Removed listing ID.
    listing_id: ID,
}

/// Event emitted when a discount is created.
public struct DiscountCreated has copy, drop {
    /// Shop that created the discount.
    shop_id: ID,
    /// Created discount ID.
    discount_id: ID,
}

/// Event emitted when a discount is updated.
public struct DiscountUpdated has copy, drop {
    /// Shop that owns the updated discount.
    shop_id: ID,
    /// Updated discount ID.
    discount_id: ID,
}

/// Event emitted when a discount is toggled.
public struct DiscountToggled has copy, drop {
    /// Shop that owns the toggled discount.
    shop_id: ID,
    /// Toggled discount ID.
    discount_id: ID,
    /// New discount status.
    active: bool,
}

/// Event emitted when an accepted coin is added.
public struct AcceptedCoinAdded has copy, drop {
    /// Shop that registered the accepted currency.
    shop_id: ID,
    /// Pyth price-info object ID bound to the accepted currency.
    pyth_price_info_object_id: ID,
}

/// Event emitted when an accepted coin is removed.
public struct AcceptedCoinRemoved has copy, drop {
    /// Shop that removed the accepted currency.
    shop_id: ID,
    /// Pyth price-info object ID that was deregistered.
    pyth_price_info_object_id: ID,
}

/// Event emitted when a discount is redeemed.
public struct DiscountRedeemed has copy, drop {
    /// Shop where redemption occurred.
    shop_id: ID,
    /// Discount used for redemption.
    discount_id: ID,
}

/// Event emitted when a purchase completes.
public struct PurchaseCompleted has copy, drop {
    /// Shop where checkout completed.
    shop_id: ID,
    /// Listing purchased in this checkout.
    listing_id: ID,
    /// Accepted currency entry used for pricing.
    pyth_price_info_object_id: ID,
    /// Discount applied to the purchase, if any.
    discount_id: Option<ID>,
    /// Newly minted `ShopItem` receipt ID.
    minted_item_id: ID,
    /// These checkout values are not persisted on any object and must remain in the event.
    amount_paid: u64,
    /// Final price in USD cents after discounts, used for analytics and indexing.
    discounted_price_usd_cents: u64,
}

// === Package Functions ===

/// Emits a `ShopCreated` payload.
public(package) fun emit_shop_created(shop_id: ID, owner_cap_id: ID) {
    event::emit(ShopCreated {
        shop_id,
        owner_cap_id,
    });
}

/// Emits a `ShopOwnerUpdated` payload.
public(package) fun emit_shop_owner_updated(
    shop_id: ID,
    owner_cap_id: ID,
    previous_owner: address,
) {
    event::emit(ShopOwnerUpdated {
        shop_id,
        owner_cap_id,
        previous_owner,
    });
}

/// Emits a `ShopToggled` payload.
public(package) fun emit_shop_toggled(shop_id: ID, owner_cap_id: ID, active: bool) {
    event::emit(ShopToggled {
        shop_id,
        owner_cap_id,
        active,
    });
}

/// Emits an `ItemListingAdded` payload.
public(package) fun emit_item_listing_added(shop_id: ID, listing_id: ID) {
    event::emit(ItemListingAdded {
        shop_id,
        listing_id,
    });
}

/// Emits an `ItemListingStockUpdated` payload.
public(package) fun emit_item_listing_stock_updated(
    shop_id: ID,
    listing_id: ID,
    previous_stock: u64,
) {
    event::emit(ItemListingStockUpdated {
        shop_id,
        listing_id,
        previous_stock,
    });
}

/// Emits an `ItemListingRemoved` payload.
public(package) fun emit_item_listing_removed(shop_id: ID, listing_id: ID) {
    event::emit(ItemListingRemoved {
        shop_id,
        listing_id,
    });
}

/// Emits a `DiscountCreated` payload.
public(package) fun emit_discount_created(shop_id: ID, discount_id: ID) {
    event::emit(DiscountCreated {
        shop_id,
        discount_id,
    });
}

/// Emits a `DiscountUpdated` payload.
public(package) fun emit_discount_updated(shop_id: ID, discount_id: ID) {
    event::emit(DiscountUpdated {
        shop_id,
        discount_id,
    });
}

/// Emits a `DiscountToggled` payload.
public(package) fun emit_discount_toggled(
    shop_id: ID,
    discount_id: ID,
    active: bool,
) {
    event::emit(DiscountToggled {
        shop_id,
        discount_id,
        active,
    });
}

/// Emits an `AcceptedCoinAdded` payload.
public(package) fun emit_accepted_coin_added(shop_id: ID, pyth_price_info_object_id: ID) {
    event::emit(AcceptedCoinAdded {
        shop_id,
        pyth_price_info_object_id,
    });
}

/// Emits an `AcceptedCoinRemoved` payload.
public(package) fun emit_accepted_coin_removed(shop_id: ID, pyth_price_info_object_id: ID) {
    event::emit(AcceptedCoinRemoved {
        shop_id,
        pyth_price_info_object_id,
    });
}

/// Emits a `DiscountRedeemed` payload.
public(package) fun emit_discount_redeemed(shop_id: ID, discount_id: ID) {
    event::emit(DiscountRedeemed {
        shop_id,
        discount_id,
    });
}

/// Emits a `PurchaseCompleted` payload.
public(package) fun emit_purchase_completed(
    shop_id: ID,
    listing_id: ID,
    pyth_price_info_object_id: ID,
    discount_id: Option<ID>,
    minted_item_id: ID,
    amount_paid: u64,
    discounted_price_usd_cents: u64,
) {
    event::emit(PurchaseCompleted {
        shop_id,
        listing_id,
        pyth_price_info_object_id,
        discount_id,
        minted_item_id,
        amount_paid,
        discounted_price_usd_cents,
    });
}

// === Test Functions ===

/// Builds a `ShopCreated` payload.
#[test_only]
public(package) fun shop_created(shop_id: ID, owner_cap_id: ID): ShopCreated {
    ShopCreated {
        shop_id,
        owner_cap_id,
    }
}

/// Builds a `ShopOwnerUpdated` payload.
#[test_only]
public(package) fun shop_owner_updated(
    shop_id: ID,
    owner_cap_id: ID,
    previous_owner: address,
): ShopOwnerUpdated {
    ShopOwnerUpdated {
        shop_id,
        owner_cap_id,
        previous_owner,
    }
}

/// Builds a `ShopToggled` payload.
#[test_only]
public(package) fun shop_toggled(shop_id: ID, owner_cap_id: ID, active: bool): ShopToggled {
    ShopToggled {
        shop_id,
        owner_cap_id,
        active,
    }
}

/// Builds an `ItemListingAdded` payload.
#[test_only]
public(package) fun item_listing_added(shop_id: ID, listing_id: ID): ItemListingAdded {
    ItemListingAdded {
        shop_id,
        listing_id,
    }
}

/// Builds an `ItemListingStockUpdated` payload.
#[test_only]
public(package) fun item_listing_stock_updated(
    shop_id: ID,
    listing_id: ID,
    previous_stock: u64,
): ItemListingStockUpdated {
    ItemListingStockUpdated {
        shop_id,
        listing_id,
        previous_stock,
    }
}

/// Builds an `ItemListingRemoved` payload.
#[test_only]
public(package) fun item_listing_removed(shop_id: ID, listing_id: ID): ItemListingRemoved {
    ItemListingRemoved {
        shop_id,
        listing_id,
    }
}

/// Builds a `DiscountCreated` payload.
#[test_only]
public(package) fun discount_created(
    shop_id: ID,
    discount_id: ID,
): DiscountCreated {
    DiscountCreated {
        shop_id,
        discount_id,
    }
}

/// Builds a `DiscountUpdated` payload.
#[test_only]
public(package) fun discount_updated(
    shop_id: ID,
    discount_id: ID,
): DiscountUpdated {
    DiscountUpdated {
        shop_id,
        discount_id,
    }
}

/// Builds a `DiscountToggled` payload.
#[test_only]
public(package) fun discount_toggled(
    shop_id: ID,
    discount_id: ID,
    active: bool,
): DiscountToggled {
    DiscountToggled {
        shop_id,
        discount_id,
        active,
    }
}

/// Builds an `AcceptedCoinAdded` payload.
#[test_only]
public(package) fun accepted_coin_added(
    shop_id: ID,
    pyth_price_info_object_id: ID,
): AcceptedCoinAdded {
    AcceptedCoinAdded {
        shop_id,
        pyth_price_info_object_id,
    }
}

/// Builds an `AcceptedCoinRemoved` payload.
#[test_only]
public(package) fun accepted_coin_removed(
    shop_id: ID,
    pyth_price_info_object_id: ID,
): AcceptedCoinRemoved {
    AcceptedCoinRemoved {
        shop_id,
        pyth_price_info_object_id,
    }
}

/// Builds a `DiscountRedeemed` payload.
#[test_only]
public(package) fun discount_redeemed(shop_id: ID, discount_id: ID): DiscountRedeemed {
    DiscountRedeemed {
        shop_id,
        discount_id,
    }
}

/// Builds a `PurchaseCompleted` payload.
#[test_only]
public(package) fun purchase_completed(
    shop_id: ID,
    listing_id: ID,
    pyth_price_info_object_id: ID,
    discount_id: Option<ID>,
    minted_item_id: ID,
    amount_paid: u64,
    discounted_price_usd_cents: u64,
): PurchaseCompleted {
    PurchaseCompleted {
        shop_id,
        listing_id,
        pyth_price_info_object_id,
        discount_id,
        minted_item_id,
        amount_paid,
        discounted_price_usd_cents,
    }
}
