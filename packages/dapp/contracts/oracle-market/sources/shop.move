/// Oracle marketplace implementation overview:
///
/// - Shared objects (Shop): shared objects are
///   globally addressable. Anyone can include them as inputs and read them, and any transaction
///   that mutates them goes through consensus. What "can mutate" really means is "can submit a
///   tx that tries" -- the module still enforces its own authorization checks. This module keeps a
///   single shared root (`Shop`) and stores listings/currencies/discounts in typed dynamic
///   collections under that root, so callers pass one shared object and the module resolves internal
///   entries by ID/type. Shared objects are created with object::new and shared via
///   transfer::public_share_object.
///   Docs: docs/07-shop-capabilities.md, docs/08-listings-receipts.md, docs/09-currencies-oracles.md,
///   docs/10-discounts-tickets.md, docs/16-object-ownership.md
/// - Owned objects (ShopOwnerCap, ShopItem): ownership enforces authority or user
///   assets. Passing an owned object by value is a single-use guarantee. Docs: docs/07-shop-capabilities.md,
///   docs/08-listings-receipts.md, docs/10-discounts-tickets.md, docs/16-object-ownership.md
/// - Capability-based auth (ShopOwnerCap): admin entry points require the capability object, not
///   ctx.sender() checks. This replaces Solidity modifiers. Docs: docs/07-shop-capabilities.md
/// - Table collections (listings + accepted currencies + discounts):
///   typed dynamic collections keep config under `Shop` without exposing
///   listings/currencies/discounts as standalone shared objects.
/// - Type tags and TypeName: item and coin types are recorded as TypeName for runtime checks,
///   events, and UI metadata; compile-time correctness still comes from generics (ShopItem<T>,
///   Coin<T>) and explicit comparisons when needed. Docs: docs/08-listings-receipts.md,
///   docs/09-currencies-oracles.md
/// - Phantom types: ShopItem<phantom T> records the item type in the type system without storing
///   the value. Docs: docs/08-listings-receipts.md
/// - Abilities (key, store, copy, drop): on Sui, `key` means "this is an object" and the first field
///   must be `id: UID` (the object ID). `store` allows values to be stored in objects, while `copy`
///   and `drop` control value semantics. These drive ownership rules. Docs: docs/02-mental-model-shift.md,
///   docs/16-object-ownership.md
/// - Option types: Option makes optional IDs and optional limits/expiry explicit instead of
///   sentinel values. Docs: docs/08-listings-receipts.md, docs/10-discounts-tickets.md
/// - Entry vs public functions: PTBs can call `entry` and `public`, while other Move modules can only call
///   `public`. This module keeps transaction APIs as `public` to maximize package composition.
/// - Events: event::emit writes typed events for indexers and UIs. Docs: docs/14-advanced.md,
///   docs/18-data-access.md
/// - TxContext and sender: TxContext is required for object creation and coin splits; ctx.sender()
///   identifies the signer for access control and receipts. Docs: docs/14-advanced.md
/// - Object IDs and addresses: on Sui, object IDs are addresses (but not every address is an object ID).
///   object::UID holds that ID,
///   and object::uid_to_inner / object::id_from_address convert between UID/ID and address forms
///   for indexing and off-chain tooling. Docs: docs/14-advanced.md
/// - Transfers and sharing: transfer::public_transfer moves owned objects;
///   transfer::public_share_object makes shared objects.
///   Docs: docs/07-shop-capabilities.md, docs/14-advanced.md
/// - Coins and coin registry: Coin<T> is a resource, Currency<T> supplies metadata.
///   coin::split and coin::destroy_zero manage payment/change. Docs: docs/09-currencies-oracles.md,
///   docs/09-currencies-oracles.md, docs/17-ptb-gas.md
/// - Clock and time: Clock is a shared, read-only object with a consensus-set timestamp_ms.
///   It can only be read via immutable reference in transaction-invoked functions. This module converts it to
///   seconds for discount windows and oracle freshness; it is not a wall-clock guarantee. Docs:
///   docs/09-currencies-oracles.md, docs/10-discounts-tickets.md
/// - Oracle objects (Pyth): price feeds are objects (PriceInfoObject) validated by feed_id (read from
///   the object itself); guardrails enforce freshness and confidence. Docs: docs/09-currencies-oracles.md
/// - Fixed-point math: prices are stored in USD cents, discounts in basis points, and decimal scaling
///   uses `std::u128::pow` plus OZ decimal helpers. Docs: docs/14-advanced.md
/// - Enums: DiscountRule and DiscountRuleKind model variant logic explicitly.
///   Docs: docs/10-discounts-tickets.md
/// - Test-only APIs: #[test_only] functions expose helpers for Move tests without shipping them to
///   production calls. Docs: docs/15-testing.md

module sui_oracle_market::shop;

use pyth::price_info::{Self, PriceInfoObject};
use std::string::String;
use std::type_name::{Self, TypeName};
use sui::clock::Clock;
use sui::coin::Coin;
use sui::coin_registry::Currency;
use sui::package;
use sui::table::{Self, Table};
use sui_oracle_market::currency::{Self, AcceptedCurrency, now_secs};
use sui_oracle_market::discount::{Self, Discount};
use sui_oracle_market::events;
use sui_oracle_market::listing::{Self, ItemListing, ShopItem};

// === Errors ===

#[error(code = 0)]
const EInvalidOwnerCap: vector<u8> = "invalid owner capability";
#[error(code = 1)]
const EDiscountNotFound: vector<u8> = "discount not found";
#[error(code = 2)]
const EListingNotFound: vector<u8> = "listing not found";
#[error(code = 3)]
const EListingHasActiveDiscounts: vector<u8> = "listing has active discounts";
#[error(code = 4)]
const EAcceptedCurrencyExists: vector<u8> = "accepted currency exists";
#[error(code = 5)]
const EAcceptedCurrencyMissing: vector<u8> = "accepted currency missing";
#[error(code = 7)]
const EFeedIdentifierMismatch: vector<u8> = "feed identifier mismatch";
#[error(code = 8)]
const EEmptyShopName: vector<u8> = "empty shop name";
#[error(code = 9)]
const EShopDisabled: vector<u8> = "shop disabled";
#[error(code = 10)]
const EDiscountActiveStateUnchanged: vector<u8> = "discount active state unchanged";
#[error(code = 11)]
const EShopActiveStateUnchanged: vector<u8> = "shop active state unchanged";
#[error(code = 12)]
const EDiscountSpotlightUnchanged: vector<u8> = "discount spotlight state unchanged";

// === Init ===

/// Claims and returns the module's Publisher object during publish.
public struct SHOP has drop {}

/// Initializes publish-time metadata by claiming and keeping the package publisher object.
fun init(publisher_witness: SHOP, ctx: &mut TxContext) {
    package::claim_and_keep<SHOP>(publisher_witness, ctx);
}

// === Structs ===

/// Capability that proves the caller can administer a specific `Shop`.
/// Holding and using this object is the Sui-native equivalent of matching `onlyOwner` criteria in Solidity.
public struct ShopOwnerCap has key {
    /// Object ID for this capability.
    id: UID,
    /// Shop governed by this capability.
    shop_id: ID,
}

/// Shared shop that stores listings, currencies, and discounts in typed dynamic collections.
public struct Shop has key, store {
    /// Shared object ID for this shop.
    id: UID,
    /// Payout recipient for sales.
    owner: address,
    /// Human-readable storefront name.
    name: String,
    /// Hard stop for buyer-facing purchase/claim flows.
    active: bool,
    /// Registered coin metadata by `TypeName`.
    accepted_currencies: Table<TypeName, AcceptedCurrency>,
    /// Reverse index from Pyth `feed_id` to the coin `TypeName` that owns it.
    /// Enforces one accepted currency per feed and enables feed-based lookups.
    accepted_currency_feeds: Table<vector<u8>, TypeName>,
    /// Listings keyed by stable object `ID` identifiers.
    listings: Table<ID, ItemListing>,
    /// Discounts keyed by discount ID.
    discounts: Table<ID, Discount>,
}

// === Public Functions ===

/// Create and return a new shop and its owner capability.
///
/// Any address can spin up a shop and receive the corresponding shop and owner capability.
public fun create_shop(name: String, ctx: &mut TxContext): (Shop, ShopOwnerCap) {
    let shop = new(name, ctx.sender(), ctx);
    let shop_id = shop.id();

    let owner_cap = ShopOwnerCap {
        id: object::new(ctx),
        shop_id,
    };
    let owner_cap_id = owner_cap.id.to_inner();

    events::emit_shop_created(shop_id, owner_cap_id);

    (shop, owner_cap)
}

/// Create and share a new shop and return its owner capability.
///
/// Any address can spin up a shop and receive the corresponding shop and owner capability.
public fun create_shop_and_share(name: String, ctx: &mut TxContext): (ID, ShopOwnerCap) {
    let (shop, owner_cap) = create_shop(name, ctx);
    let shop_id = shop.id();

    transfer::public_share_object(shop);
    (shop_id, owner_cap)
}

/// Transfer a `ShopOwnerCap` to a new holder.
///
/// `ShopOwnerCap` intentionally lacks `store`, so it cannot be moved with `transfer::public_transfer`
/// or frozen with `transfer::public_freeze_object`. This is the supported way to hand the capability
/// to another address (for example, to move shop administration to a new operator).
public fun transfer(owner_cap: ShopOwnerCap, recipient: address) {
    transfer::transfer(owner_cap, recipient);
}

/// Disable/enable a shop (buyer flows will reject new checkouts).
/// Sets the shop's active flag to `active` rather than flipping the current value, and aborts with
/// `EShopActiveStateUnchanged` when the shop already holds the requested state, so a state-preserving
/// call surfaces as an error instead of silently doing nothing.
public fun set_shop_status(shop: &mut Shop, owner_cap: &ShopOwnerCap, active: bool) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);
    assert!(shop.active() != active, EShopActiveStateUnchanged);

    shop.active = active;
    events::emit_shop_status_changed(shop.id(), owner_cap.id.to_inner(), active);
}

/// Rotate the payout recipient for a shop.
///
/// Payouts should follow the current operator, not the address that originally created the shop.
public fun update_shop_owner(shop: &mut Shop, owner_cap: &ShopOwnerCap, new_owner: address) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    let previous_owner = shop.owner;
    shop.owner = new_owner;

    events::emit_shop_owner_updated(shop.id(), owner_cap.id.to_inner(), previous_owner);
}

/// Adds a listing and returns the created listing ID.
///
/// Add an `ItemListing` attached to the `Shop`. The generic `T` encodes what will eventually be
/// minted when a buyer completes checkout. Prices are provided in USD cents (e.g. $12.50 -> 1_250)
/// to avoid floating point math. Spotlighting is a discount-level concern (`set_discount_spotlight`),
/// so a listing carries no spotlight reference.
public fun add_item_listing<T: store>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    ctx: &mut TxContext,
): ID {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Create an item listing.
    let listing = listing::create<T>(
        name,
        base_price_usd_cents,
        stock,
        ctx,
    );
    let listing_id = listing.id();

    shop.listings.add(listing_id, listing);

    events::emit_item_listing_added(shop.id(), listing_id);

    listing_id
}

/// Add an item listing and atomically create a listing-scoped discount in one transaction.
///
/// This is useful when callers want a listing-specific discount without requiring a pre-existing
/// listing ID. The new discount is created scoped to the listing and flagged as a spotlight.
public fun add_item_listing_with_discount<T: store>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    ctx: &mut TxContext,
): (ID, ID) {
    let listing_id = shop.add_item_listing<T>(
        owner_cap,
        name,
        base_price_usd_cents,
        stock,
        ctx,
    );
    let discount_id = shop.create_discount(
        owner_cap,
        option::some(listing_id),
        rule_kind,
        rule_value,
        starts_at,
        expires_at,
        max_redemptions,
        ctx,
    );

    // Feature the freshly created listing-scoped discount.
    shop.set_discount_spotlight(owner_cap, discount_id, true);

    (listing_id, discount_id)
}

/// Update the inventory count for a listing (0 inventory to pause selling).
public fun update_item_listing_stock(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    listing_id: ID,
    new_stock: u64,
) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    let item_listing = shop.listing_mut(listing_id);
    let previous_stock = item_listing.stock();
    item_listing.set_stock(new_stock);

    events::emit_item_listing_stock_updated(shop.id(), listing_id, previous_stock);
}

/// Remove an item listing.
///
/// Fails if listing doesn't exist.
/// Listings with any attached discounts must remove them first.
public fun remove_item_listing(shop: &mut Shop, owner_cap: &ShopOwnerCap, listing_id: ID) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Will fail if listing doesn't exist.
    let listing = shop.listing(listing_id);
    assert!(listing.discount_count() == 0, EListingHasActiveDiscounts);
    let _listing = shop.listings.remove(listing_id);

    events::emit_item_listing_removed(shop.id(), listing_id);
}

/// Register a coin type that the shop will price through an oracle feed.
///
/// - Callers supply the on-chain `PriceInfoObject` (fetched via RPC); the module re-validates the feed
///   id read from the object to defend against spoofed inputs. The object ID is not pinned: clients
///   resolve the current `PriceInfoObject` from the feed id, so the binding survives object changes.
/// - Sellers can optionally tighten oracle guardrails per currency (`max_price_age_secs_cap`,
///   `max_confidence_ratio_bps_cap`). Buyers may only tighten
///   `max_price_age_secs`/`max_confidence_ratio_bps` further--never loosen.
public fun add_accepted_currency<C>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    currency: &Currency<C>,
    price_info_object: &PriceInfoObject,
    feed_id: vector<u8>,
    max_price_age_secs_cap: Option<u64>,
    max_confidence_ratio_bps_cap: Option<u16>,
) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Bind this currency to a Pyth feed id to prevent oracle feed spoofing.
    let coin_type = type_name::with_defining_ids<C>();
    assert!(!shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyExists);
    // Reject a feed already bound to another currency so a shop cannot price two
    // distinct coins off the same feed.
    assert!(!shop.accepted_currency_feeds.contains(feed_id), EAcceptedCurrencyExists);

    // Validate on-chain oracle identity before mutating shop state.
    assert_price_info_identity!(feed_id, price_info_object);

    // Add accepted currency to storage, indexed by both coin type and feed id.
    let accepted_currency = currency::create(
        feed_id,
        currency,
        max_price_age_secs_cap,
        max_confidence_ratio_bps_cap,
    );
    shop.accepted_currencies.add(coin_type, accepted_currency);
    shop.accepted_currency_feeds.add(feed_id, coin_type);

    events::emit_accepted_coin_added(shop.id(), feed_id);
}

/// Deregister an accepted coin type.
/// Fails if accepted currency is not registered.
public fun remove_accepted_currency<C>(shop: &mut Shop, owner_cap: &ShopOwnerCap) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    let coin_type = type_name::with_defining_ids<C>();
    assert!(shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyMissing);
    let accepted_currency = shop.accepted_currencies.remove(coin_type);

    // Free the feed id so it can be reused by a future registration.
    let feed_id = accepted_currency.feed_id();
    shop.accepted_currency_feeds.remove(feed_id);

    events::emit_accepted_coin_removed(shop.id(), feed_id);
}

/// Create a discount anchored under the shop.
///
/// Discounts are stored in the shop's `discounts: Table<ID, Discount>` collection.
/// Admin functions enforce `ShopOwnerCap` checks when creating/updating/toggling discounts, and
/// discounts remain addressable by `ID` for UIs.
/// Callers send primitive args (`rule_kind` of `0 = fixed` or `1 = percent`), but we immediately convert them into the strongly
/// typed `DiscountRule` before persisting. For `Fixed` rules the `rule_value` is denominated in USD
/// cents to match listing prices.
///
/// NOTE:
/// - `max_redemptions`: if set, must be greater than 0. If not set (`None`), there is no cap on
///   total redemptions and the counter is not protected from overflow.
/// - `applies_to_listing`: if set, scopes the discount to that listing (immutable) and counts it
///   against the listing's `discount_count`. The discount starts un-spotlighted; call
///   `set_discount_spotlight` to feature it.
public fun create_discount(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    applies_to_listing: Option<ID>,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    ctx: &mut TxContext,
): ID {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Create discount object with its immutable listing scope baked in.
    let discount = discount::create(
        applies_to_listing,
        rule_kind,
        rule_value,
        starts_at,
        expires_at,
        max_redemptions,
        ctx,
    );
    let discount_id = discount.id();

    // For listing-scoped discounts, assert the listing exists and count it against that listing.
    applies_to_listing.do!(|listing_id| {
        shop.listing_mut(listing_id).increment_discount_count();
    });

    shop.discounts.add(discount_id, discount);

    events::emit_discount_created(
        shop.id(),
        discount_id,
    );

    discount_id
}

/// Update mutable fields on a discount (schedule, rule, limits).
/// For `Fixed` discounts the `rule_value` remains in USD cents.
/// Updates are only allowed before any tickets are issued or redeemed and before the discount is
/// finished (expired or capped), so claim accounting cannot be retroactively changed.
/// `max_redemptions`: if set, must be greater than 0. If not set (`None`), there is no cap on
/// total redemptions and the counter is not protected from overflow.
public fun update_discount(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_id: ID,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    clock: &Clock,
) {
    let shop_id = shop.id();
    assert!(owner_cap.shop_id == shop_id, EInvalidOwnerCap);

    let discount = shop.discount_mut(discount_id);
    discount.update(rule_kind, rule_value, starts_at, expires_at, max_redemptions, now_secs(clock));

    events::emit_discount_updated(shop_id, discount.id());
}

/// Quickly enable/disable a coupon without deleting it.
/// Sets the discount's active flag to `active` rather than flipping the current value, and aborts
/// with `EDiscountActiveStateUnchanged` when the discount already holds the requested state, so a
/// state-preserving call surfaces as an error instead of silently doing nothing.
/// The spotlight flag is independent and unaffected (see `set_discount_spotlight`).
public fun set_discount_status(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_id: ID,
    active: bool,
) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);
    assert!(shop.discount(discount_id).active() != active, EDiscountActiveStateUnchanged);

    shop.discount_mut(discount_id).set_active(active);
    events::emit_discount_status_changed(shop.id(), discount_id, active);
}

/// Enable or disable the storefront spotlight flag on a discount.
/// Sets the flag to `is_spotlight` rather than flipping it, and aborts with
/// `EDiscountSpotlightUnchanged` when the discount already holds the requested value. Spotlighting is
/// advisory: storefronts feature, per listing, the oldest-starting active discount whose spotlight
/// flag is set (a listing-scoped match takes precedence over a generic one).
public fun set_discount_spotlight(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_id: ID,
    is_spotlight: bool,
) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);
    assert!(shop.discount(discount_id).is_spotlight() != is_spotlight, EDiscountSpotlightUnchanged);

    shop.discount_mut(discount_id).set_spotlight(is_spotlight);
    events::emit_discount_spotlight_changed(shop.id(), discount_id, is_spotlight);
}

/// Removes a discount from shop storage.
/// Fails if discount doesn't exist. A listing-scoped discount is uncounted from its listing.
public fun remove_discount(shop: &mut Shop, owner_cap: &ShopOwnerCap, discount_id: ID) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);
    let shop_id = shop.id();

    // Fails when discount doesn't exist.
    shop.discount(discount_id).applies_to_listing().do!(|listing_id| {
        if (shop.listings.contains(listing_id)) {
            shop.listing_mut(listing_id).decrement_discount_count();
        };
    });

    let _ = shop.discounts.remove(discount_id);
    events::emit_discount_removed(shop_id, discount_id);
}

/// Execute a purchase priced in USD cents but settled with any previously registered `AcceptedCurrency`.
///
/// NOTE:
/// - Oracles are first-class objects. Callers supply a refreshed `PriceInfoObject`, and on-chain
///   logic verifies identity/freshness against the shared `Clock` and feed metadata.
/// - Guardrails (`max_price_age_secs`, `max_confidence_ratio_bps`) are caller-tunable only to
///   tighten them; overrides are capped at seller-set per-currency limits and `none` uses those caps.
public fun buy_item<T: store, C>(
    shop: &mut Shop,
    price_info_object: &PriceInfoObject,
    payment: Coin<C>,
    listing_id: ID,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
): (ShopItem<T>, Coin<C>) {
    assert!(shop.active, EShopDisabled);

    let base_price_usd_cents = shop.listing(listing_id).base_price_usd_cents();

    // Payment is a Coin<T> object; process_purchase splits the payment and returns change.
    shop.process_purchase<T, C>(
        price_info_object,
        payment,
        listing_id,
        base_price_usd_cents,
        option::none(),
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    )
}

/// Same as `buy_item` but also validates that discount is applicable.
public fun buy_item_with_discount<T: store, C>(
    shop: &mut Shop,
    discount_id: ID,
    price_info_object: &PriceInfoObject,
    payment: Coin<C>,
    listing_id: ID,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
): (ShopItem<T>, Coin<C>) {
    assert!(shop.active, EShopDisabled);

    let now_sec = now_secs(clock);
    let listing_price_usd_cents = shop.listing(listing_id).base_price_usd_cents();

    let shop_id = shop.id();
    let discount = shop.discount_mut(discount_id);
    let discounted_price_usd_cents = discount.redeem(listing_id, listing_price_usd_cents, now_sec);
    let discount_id = discount.id();

    events::emit_discount_redeemed(
        shop_id,
        discount_id,
    );

    // Payment is a Coin<T> object; process_purchase splits the payment and returns change.
    shop.process_purchase<T, C>(
        price_info_object,
        payment,
        listing_id,
        discounted_price_usd_cents,
        option::some(discount_id),
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    )
}

// === View Functions ===

/// Returns the listing for `listing_id`.
public fun listing(shop: &Shop, listing_id: ID): &ItemListing {
    assert!(shop.listings.contains(listing_id), EListingNotFound);
    shop.listings.borrow(listing_id)
}

/// Returns true if the listing is registered under the shop.
public fun listing_exists(shop: &Shop, listing_id: ID): bool {
    shop.listings.contains(listing_id)
}

/// Returns the accepted currency config for `C`.
public fun currency<C>(shop: &Shop): &AcceptedCurrency {
    let coin_type = type_name::with_defining_ids<C>();
    assert!(shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyMissing);
    shop.accepted_currencies.borrow(coin_type)
}

/// Returns true if an accepted currency for `C` is registered under the shop.
public fun currency_exists<C>(shop: &Shop): bool {
    let coin_type = type_name::with_defining_ids<C>();
    shop.accepted_currencies.contains(coin_type)
}

/// Returns the accepted currency config bound to `feed_id`.
/// Fails if no currency is registered for the feed.
public fun currency_by_feed(shop: &Shop, feed_id: vector<u8>): &AcceptedCurrency {
    assert!(shop.accepted_currency_feeds.contains(feed_id), EAcceptedCurrencyMissing);
    let coin_type = *shop.accepted_currency_feeds.borrow(feed_id);
    shop.accepted_currencies.borrow(coin_type)
}

/// Returns the discount for `discount_id`.
public fun discount(shop: &Shop, discount_id: ID): &Discount {
    assert!(shop.discounts.contains(discount_id), EDiscountNotFound);
    shop.discounts.borrow(discount_id)
}

/// Returns true if the discount is registered under the shop.
public fun discount_exists(shop: &Shop, discount_id: ID): bool {
    shop.discounts.contains(discount_id)
}

/// Quotes the coin amount for a price info object with guardrails.
public fun quote_amount_for_price_info_object<C>(
    shop: &Shop,
    price_info_object: &PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
): u64 {
    let accepted_currency = shop.currency<C>();
    assert_price_info_identity!(accepted_currency.feed_id(), price_info_object);

    // Entry-only quote helper; clients call via dev-inspect instead of storing quotes on-chain.
    accepted_currency.quote_amount_with_guardrails(
        price_info_object,
        price_usd_cents,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
    )
}

/// Returns `id` from the provided value.
public fun id(shop: &Shop): ID {
    shop.id.to_inner()
}

/// Returns `owner` from the provided value.
public fun owner(shop: &Shop): address {
    shop.owner
}

/// Returns `name` from the provided value.
public fun name(shop: &Shop): String {
    shop.name
}

/// Returns `active` from the provided value.
public fun active(shop: &Shop): bool {
    shop.active
}

/// Returns `owner_cap_id` from the provided value.
public fun owner_cap_id(owner_cap: &ShopOwnerCap): ID {
    owner_cap.id.to_inner()
}

/// Returns `owner_cap_shop_id` from the provided value.
public fun owner_cap_shop_id(owner_cap: &ShopOwnerCap): ID {
    owner_cap.shop_id
}

// === Private Functions ===

/// Builds a new shop with empty listings, currencies, and discounts tables.
fun new(name: String, owner: address, ctx: &mut TxContext): Shop {
    assert!(!name.is_empty(), EEmptyShopName);
    Shop {
        id: object::new(ctx),
        owner,
        name,
        active: true,
        accepted_currencies: table::new<TypeName, AcceptedCurrency>(ctx),
        accepted_currency_feeds: table::new<vector<u8>, TypeName>(ctx),
        listings: table::new<ID, ItemListing>(ctx),
        discounts: table::new<ID, Discount>(ctx),
    }
}

/// Borrows a mutable listing by ID, aborting when the listing is missing.
fun listing_mut(shop: &mut Shop, listing_id: ID): &mut ItemListing {
    assert!(shop.listings.contains(listing_id), EListingNotFound);
    shop.listings.borrow_mut(listing_id)
}

/// Borrows a mutable discount by ID, aborting when the discount is missing.
fun discount_mut(shop: &mut Shop, discount_id: ID): &mut Discount {
    assert!(shop.discounts.contains(discount_id), EDiscountNotFound);
    shop.discounts.borrow_mut(discount_id)
}

/// Executes checkout pricing, stock mutation, receipt minting, and purchase event emission.
fun process_purchase<T: store, C>(
    shop: &mut Shop,
    price_info_object: &PriceInfoObject,
    mut payment: Coin<C>,
    listing_id: ID,
    discounted_price_usd_cents: u64,
    discount_id: Option<ID>,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
): (ShopItem<T>, Coin<C>) {
    // Assert pyt price info object validity.
    let accepted_currency = shop.currency<C>();
    assert_price_info_identity!(accepted_currency.feed_id(), price_info_object);

    // Quote amount due.
    let quote_amount = accepted_currency.quote_amount_with_guardrails(
        price_info_object,
        discounted_price_usd_cents,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
    );
    let feed_id = accepted_currency.feed_id();
    let shop_id = shop.id();

    // Decrement stock and emit previous stock in event.
    let item_listing = shop.listing_mut(listing_id);
    let previous_stock = item_listing.stock();
    item_listing.decrement_stock();

    events::emit_item_listing_stock_updated(shop_id, item_listing.id(), previous_stock);

    // Split amount due (`split` should handle insufficient amount).
    let amount_due = payment.split(quote_amount, ctx);

    // Mint purchased item.
    let minted_item = item_listing.mint_shop_item<T>(shop_id, now_secs(clock), ctx);
    let minted_item_id = object::id(&minted_item);

    events::emit_purchase_completed(
        shop_id,
        item_listing.id(),
        feed_id,
        discount_id,
        minted_item_id,
        amount_due.value(),
        discounted_price_usd_cents,
    );

    // Transfer owed coin to the shop owner if any.
    if (amount_due.value() == 0) {
        amount_due.destroy_zero();
    } else {
        transfer::public_transfer(amount_due, shop.owner);
    };

    (minted_item, payment)
}

/// Asserts that `$price_info_object` reports the expected Pyth feed id, aborting
/// with `EFeedIdentifierMismatch` otherwise.
macro fun assert_price_info_identity(
    $expected_feed_id: vector<u8>,
    $price_info_object: &PriceInfoObject,
) {
    let expected_feed_id = $expected_feed_id;
    let price_info_object = $price_info_object;

    let identifier_bytes = price_info::get_price_info_from_price_info_object(
        price_info_object,
    )
        .get_price_identifier()
        .get_bytes();
    assert!(expected_feed_id == identifier_bytes, EFeedIdentifierMismatch);
}

// === Test Functions ===

/// Runs module initialization in tests.
#[test_only]
public fun test_init(ctx: &mut TxContext) {
    init(SHOP {}, ctx)
}

/// Creates an unshared shop and owner capability pair for local tests.
#[test_only]
public fun test_setup_shop(owner: address, ctx: &mut TxContext): (Shop, ShopOwnerCap) {
    let shop = new(b"Shop".to_string(), owner, ctx);
    let owner_cap = ShopOwnerCap {
        id: object::new(ctx),
        shop_id: shop.id(),
    };
    (shop, owner_cap)
}
