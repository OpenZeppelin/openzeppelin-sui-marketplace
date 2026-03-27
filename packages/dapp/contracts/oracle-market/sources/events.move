module sui_oracle_market::events;

use sui::event;

/// Event emitted when a shop is created.
public struct ShopCreated has copy, drop {
    /// Created shop ID.
    shop_id: ID,
    /// Created owner capability ID.
    shop_owner_cap_id: ID,
}

/// Event emitted when a shop owner is updated.
public struct ShopOwnerUpdated has copy, drop {
    /// Shop whose owner changed.
    shop_id: ID,
    /// Owner capability used for the update.
    shop_owner_cap_id: ID,
    /// Previous owner address.
    previous_owner_address: address,
}

/// Event emitted when a shop is disabled.
public struct ShopDisabled has copy, drop {
    /// Shop that was disabled.
    shop_id: ID,
    /// Owner capability used for disable.
    shop_owner_cap_id: ID,
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

/// Event emitted when a discount template is created.
public struct DiscountTemplateCreated has copy, drop {
    /// Shop that created the template.
    shop_id: ID,
    /// Created template ID.
    discount_template_id: ID,
}

/// Event emitted when a discount template is updated.
public struct DiscountTemplateUpdated has copy, drop {
    /// Shop that owns the updated template.
    shop_id: ID,
    /// Updated template ID.
    discount_template_id: ID,
}

/// Event emitted when a discount template is toggled.
public struct DiscountTemplateToggled has copy, drop {
    /// Shop that owns the toggled template.
    shop_id: ID,
    /// Toggled template ID.
    discount_template_id: ID,
    /// New template status.
    active: bool,
}

/// Event emitted when an accepted coin is added.
public struct AcceptedCoinAdded has copy, drop {
    /// Shop that registered the accepted currency.
    shop_id: ID,
    /// Pyth price-info object ID bound to the accepted currency.
    accepted_currency_id: ID,
}

/// Event emitted when an accepted coin is removed.
public struct AcceptedCoinRemoved has copy, drop {
    /// Shop that removed the accepted currency.
    shop_id: ID,
    /// Pyth price-info object ID that was deregistered.
    accepted_currency_id: ID,
}

/// Event emitted when a discount ticket is claimed.
public struct DiscountClaimed has copy, drop {
    /// Shop that issued the ticket.
    shop_id: ID,
    /// Claimed discount ticket ID.
    discount_id: ID,
}

/// Event emitted when a discount ticket is redeemed.
public struct DiscountRedeemed has copy, drop {
    /// Shop where redemption occurred.
    shop_id: ID,
    // TODO#q: rename discount_template_id -> discount_id
    /// Template used for redemption.
    discount_template_id: ID,
}

/// Event emitted when a purchase completes.
public struct PurchaseCompleted has copy, drop {
    /// Shop where checkout completed.
    shop_id: ID,
    /// Listing purchased in this checkout.
    listing_id: ID,
    /// Accepted currency entry used for pricing.
    accepted_currency_id: ID,
    /// Template applied to the purchase, if any.
    discount_template_id: Option<ID>,
    /// Newly minted `ShopItem` receipt ID.
    minted_item_id: ID,
    /// These checkout values are not persisted on any object and must remain in the event.
    amount_paid: u64,
    /// Final price in USD cents after discounts, used for analytics and indexing.
    discounted_price_usd_cents: u64,
}

/// Emits a `ShopCreated` payload.
public(package) fun emit_shop_created(shop_id: ID, shop_owner_cap_id: ID) {
    event::emit(ShopCreated {
        shop_id,
        shop_owner_cap_id,
    });
}

/// Emits a `ShopOwnerUpdated` payload.
public(package) fun emit_shop_owner_updated(
    shop_id: ID,
    shop_owner_cap_id: ID,
    previous_owner_address: address,
) {
    event::emit(ShopOwnerUpdated {
        shop_id,
        shop_owner_cap_id,
        previous_owner_address,
    });
}

/// Emits a `ShopDisabled` payload.
public(package) fun emit_shop_disabled(shop_id: ID, shop_owner_cap_id: ID) {
    event::emit(ShopDisabled {
        shop_id,
        shop_owner_cap_id,
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

/// Emits a `DiscountTemplateCreated` payload.
public(package) fun emit_discount_template_created(shop_id: ID, discount_template_id: ID) {
    event::emit(DiscountTemplateCreated {
        shop_id,
        discount_template_id,
    });
}

/// Emits a `DiscountTemplateUpdated` payload.
public(package) fun emit_discount_template_updated(shop_id: ID, discount_template_id: ID) {
    event::emit(DiscountTemplateUpdated {
        shop_id,
        discount_template_id,
    });
}

/// Emits a `DiscountTemplateToggled` payload.
public(package) fun emit_discount_template_toggled(
    shop_id: ID,
    discount_template_id: ID,
    active: bool,
) {
    event::emit(DiscountTemplateToggled {
        shop_id,
        discount_template_id,
        active,
    });
}

/// Emits an `AcceptedCoinAdded` payload.
public(package) fun emit_accepted_coin_added(shop_id: ID, accepted_currency_id: ID) {
    event::emit(AcceptedCoinAdded {
        shop_id,
        accepted_currency_id,
    });
}

/// Emits an `AcceptedCoinRemoved` payload.
public(package) fun emit_accepted_coin_removed(shop_id: ID, accepted_currency_id: ID) {
    event::emit(AcceptedCoinRemoved {
        shop_id,
        accepted_currency_id,
    });
}

/// Emits a `DiscountClaimed` payload.
public(package) fun emit_discount_claimed(shop_id: ID, discount_id: ID) {
    event::emit(DiscountClaimed {
        shop_id,
        discount_id,
    });
}

/// Emits a `DiscountRedeemed` payload.
public(package) fun emit_discount_redeemed(shop_id: ID, discount_template_id: ID) {
    event::emit(DiscountRedeemed {
        shop_id,
        discount_template_id,
    });
}

/// Emits a `PurchaseCompleted` payload.
public(package) fun emit_purchase_completed(
    shop_id: ID,
    listing_id: ID,
    accepted_currency_id: ID,
    discount_template_id: Option<ID>,
    minted_item_id: ID,
    amount_paid: u64,
    discounted_price_usd_cents: u64,
) {
    event::emit(PurchaseCompleted {
        shop_id,
        listing_id,
        accepted_currency_id,
        discount_template_id,
        minted_item_id,
        amount_paid,
        discounted_price_usd_cents,
    });
}

// === #[test_only] API ===

/// Builds a `ShopCreated` payload.
#[test_only]
public(package) fun shop_created(shop_id: ID, shop_owner_cap_id: ID): ShopCreated {
    ShopCreated {
        shop_id,
        shop_owner_cap_id,
    }
}

/// Builds a `ShopOwnerUpdated` payload.
#[test_only]
public(package) fun shop_owner_updated(
    shop_id: ID,
    shop_owner_cap_id: ID,
    previous_owner_address: address,
): ShopOwnerUpdated {
    ShopOwnerUpdated {
        shop_id,
        shop_owner_cap_id,
        previous_owner_address,
    }
}

/// Builds a `ShopDisabled` payload.
#[test_only]
public(package) fun shop_disabled(shop_id: ID, shop_owner_cap_id: ID): ShopDisabled {
    ShopDisabled {
        shop_id,
        shop_owner_cap_id,
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

/// Builds a `DiscountTemplateCreated` payload.
#[test_only]
public(package) fun discount_template_created(
    shop_id: ID,
    discount_template_id: ID,
): DiscountTemplateCreated {
    DiscountTemplateCreated {
        shop_id,
        discount_template_id,
    }
}

/// Builds a `DiscountTemplateUpdated` payload.
#[test_only]
public(package) fun discount_template_updated(
    shop_id: ID,
    discount_template_id: ID,
): DiscountTemplateUpdated {
    DiscountTemplateUpdated {
        shop_id,
        discount_template_id,
    }
}

/// Builds a `DiscountTemplateToggled` payload.
#[test_only]
public(package) fun discount_template_toggled(
    shop_id: ID,
    discount_template_id: ID,
    active: bool,
): DiscountTemplateToggled {
    DiscountTemplateToggled {
        shop_id,
        discount_template_id,
        active,
    }
}

/// Builds an `AcceptedCoinAdded` payload.
#[test_only]
public(package) fun accepted_coin_added(shop_id: ID, accepted_currency_id: ID): AcceptedCoinAdded {
    AcceptedCoinAdded {
        shop_id,
        accepted_currency_id,
    }
}

/// Builds an `AcceptedCoinRemoved` payload.
#[test_only]
public(package) fun accepted_coin_removed(
    shop_id: ID,
    accepted_currency_id: ID,
): AcceptedCoinRemoved {
    AcceptedCoinRemoved {
        shop_id,
        accepted_currency_id,
    }
}

/// Builds a `DiscountClaimed` payload.
#[test_only]
public(package) fun discount_claimed(shop_id: ID, discount_id: ID): DiscountClaimed {
    DiscountClaimed {
        shop_id,
        discount_id,
    }
}

/// Builds a `DiscountRedeemed` payload.
#[test_only]
public(package) fun discount_redeemed(shop_id: ID, discount_template_id: ID): DiscountRedeemed {
    DiscountRedeemed {
        shop_id,
        discount_template_id,
    }
}

/// Builds a `PurchaseCompleted` payload.
#[test_only]
public(package) fun purchase_completed(
    shop_id: ID,
    listing_id: ID,
    accepted_currency_id: ID,
    discount_template_id: Option<ID>,
    minted_item_id: ID,
    amount_paid: u64,
    discounted_price_usd_cents: u64,
): PurchaseCompleted {
    PurchaseCompleted {
        shop_id,
        listing_id,
        accepted_currency_id,
        discount_template_id,
        minted_item_id,
        amount_paid,
        discounted_price_usd_cents,
    }
}
