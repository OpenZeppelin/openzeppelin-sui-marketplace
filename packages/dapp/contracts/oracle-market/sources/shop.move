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
///   events, and UI metadata; compile-time correctness still comes from generics (ShopItem<TItem>,
///   Coin<T>) and explicit comparisons when needed. Docs: docs/08-listings-receipts.md,
///   docs/09-currencies-oracles.md
/// - Phantom types: ShopItem<phantom TItem> records the item type in the type system without storing
///   the value. Docs: docs/08-listings-receipts.md
/// - Abilities (key, store, copy, drop): on Sui, `key` means "this is an object" and the first field
///   must be `id: UID` (the object ID). `store` allows values to be stored in objects, while `copy`
///   and `drop` control value semantics. These drive ownership rules. Docs: docs/02-mental-model-shift.md,
///   docs/16-object-ownership.md
/// - Option types: Option makes optional IDs and optional limits/expiry explicit instead of
///   sentinel values. Docs: docs/08-listings-receipts.md, docs/10-discounts-tickets.md
/// - Entry vs public functions: PTBs can call `entry` and `public`, while other Move modules can only call
///   `public`. Most state-changing transaction APIs in this module are `public` to maximize package
///   composition, while quote-oriented endpoints stay `entry` when they are intended for dev-inspect/clients.
/// - Events: event::emit writes typed events for indexers and UIs. Docs: docs/08-advanced.md,
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
///   coin::split and coin::destroy_zero manage payment/change. Docs: docs/05-currencies-oracles.md,
///   docs/09-currencies-oracles.md, docs/17-ptb-gas.md
/// - Clock and time: Clock is a shared, read-only object with a consensus-set timestamp_ms.
///   It can only be read via immutable reference in transaction-invoked functions. This module converts it to
///   seconds for discount windows and oracle freshness; it is not a wall-clock guarantee. Docs:
///   docs/09-currencies-oracles.md, docs/10-discounts-tickets.md
/// - Oracle objects (Pyth): price feeds are objects (PriceInfoObject) validated by feed_id and object
///   ID; guardrails enforce freshness and confidence. Docs: docs/09-currencies-oracles.md
/// - Fixed-point math: prices are stored in USD cents, discounts in basis points, and decimal scaling
///   uses `std::u128::pow` plus OZ decimal helpers. Docs: docs/14-advanced.md
/// - Enums: DiscountRule and DiscountRuleKind model variant logic explicitly.
///   Docs: docs/10-discounts-tickets.md
/// - Test-only APIs: #[test_only] functions expose helpers for Move tests without shipping them to
///   production calls. Docs: docs/15-testing.md

module sui_oracle_market::shop;

use openzeppelin_math::decimal_scaling;
use openzeppelin_math::rounding;
use openzeppelin_math::u128;
use pyth::i64;
use pyth::price::Price;
use pyth::price_info::{Self, PriceInfoObject};
use pyth::pyth;
use std::string::String;
use std::type_name::{Self, TypeName};
use sui::clock::Clock;
use sui::coin::Coin;
use sui::coin_registry::Currency;
use sui::package;
use sui::table::{Self, Table};
use sui_oracle_market::currency::{Self, AcceptedCurrency};
use sui_oracle_market::discount::{Self, Discount};
use sui_oracle_market::events;
use sui_oracle_market::listing::{Self, ItemListing};

// === Errors ===

#[error(code = 0)]
const EInvalidOwnerCap: vector<u8> = "invalid owner capability";
#[error(code = 1)]
const EEmptyItemName: vector<u8> = "empty item name";
#[error(code = 2)]
const EInvalidPrice: vector<u8> = "invalid price";
#[error(code = 3)]
const EZeroStock: vector<u8> = "zero stock";
#[error(code = 4)]
const EDiscountNotFound: vector<u8> = "discount not found";
#[error(code = 5)]
const EListingNotFound: vector<u8> = "listing not found";
#[error(code = 6)]
const EListingHasActiveDiscounts: vector<u8> = "listing has active discounts";
#[error(code = 7)]
const EAcceptedCurrencyExists: vector<u8> = "accepted currency exists";
#[error(code = 8)]
const EAcceptedCurrencyMissing: vector<u8> = "accepted currency missing";
#[error(code = 13)]
const EOutOfStock: vector<u8> = "out of stock";
#[error(code = 14)]
const EPythObjectMismatch: vector<u8> = "pyth object mismatch";
#[error(code = 15)]
const EFeedIdentifierMismatch: vector<u8> = "feed identifier mismatch";
#[error(code = 16)]
const EPriceNonPositive: vector<u8> = "price non-positive";
#[error(code = 17)]
const EPriceOverflow: vector<u8> = "price overflow";
#[error(code = 18)]
const EInsufficientPayment: vector<u8> = "insufficient payment";
#[error(code = 19)]
const EConfidenceIntervalTooWide: vector<u8> = "confidence interval too wide";
#[error(code = 20)]
const EConfidenceExceedsPrice: vector<u8> = "confidence exceeds price";
#[error(code = 21)]
const ESpotlightDiscountListingMismatch: vector<u8> = "spotlight discount listing mismatch";
#[error(code = 22)]
const EItemTypeMismatch: vector<u8> = "item type mismatch";
#[error(code = 23)]
const EUnsupportedCurrencyDecimals: vector<u8> = "unsupported currency decimals";
#[error(code = 24)]
const EEmptyShopName: vector<u8> = "empty shop name";
#[error(code = 25)]
const EShopDisabled: vector<u8> = "shop disabled";
#[error(code = 26)]
const EPriceInvalidPublishTime: vector<u8> = "invalid publish timestamp";

// === Constants ===

const CENTS_PER_DOLLAR: u64 = 100;
const BASIS_POINT_DENOMINATOR: u64 = 10_000;
const MAX_DECIMAL_POWER: u64 = 24;

// === Init ===

/// Claims and returns the module's Publisher object during publish.
public struct SHOP has drop {}

fun init(publisher_witness: SHOP, ctx: &mut TxContext) {
    package::claim_and_keep<SHOP>(publisher_witness, ctx);
}

// === Structs ===

/// Capability that proves the caller can administer a specific `Shop`.
/// Holding and using this object is the Sui-native equivalent of matching `onlyOwner` criteria in Solidity.
public struct ShopOwnerCap has key, store {
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
    disabled: bool,
    /// Registered coin metadata by `TypeName`.
    accepted_currencies: Table<TypeName, AcceptedCurrency>,
    /// Listings keyed by stable object `ID` identifiers.
    listings: Table<ID, ItemListing>,
    /// Discounts keyed by discount ID.
    discounts: Table<ID, Discount>,
}

// TODO#q: move to listing module
/// Shop item type for receipts. `TItem` is enforced at mint time so downstream
/// Move code can depend on the type system instead of opaque metadata alone.
public struct ShopItem<phantom TItem> has key, store {
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

// TODO#q: drop this struct
/// Resolved pricing guardrails after capping buyer overrides against seller limits.
public struct EffectiveGuardrails has copy, drop {
    max_price_age_secs: u64,
    max_confidence_ratio_bps: u16,
}

// === Public Functions ===

// TODO#q: remove sui mindset from docs.
// TODO#q: have two apis create_shop and create_shop_and_share
/// Create a new shop and its owner capability.
///
/// Any address can spin up a shop and receive the corresponding owner capability.
/// Sui mindset:
/// - Capability > `msg.sender`: ownership lives in a first-class `ShopOwnerCap`. Admin functions
///   require the cap, so authority follows the object holder rather than whichever address signs
///   the PTB. Solidity relies on `msg.sender` and modifiers; here, capabilities are explicit inputs.
/// - Shared object composition: the shop is shared, with listings/currencies stored in typed
///   table storage and discounts stored directly in a typed `Table`.
/// - State stays sharded so PTBs only touch the listing slot/discount object they mutate.
public fun create_shop(name: String, ctx: &mut TxContext): (ID, ShopOwnerCap) {
    let shop = new(name, ctx.sender(), ctx);
    let shop_id = shop.id();

    let owner_cap = ShopOwnerCap {
        id: object::new(ctx),
        shop_id,
    };
    let owner_cap_id = owner_cap.id.to_inner();

    events::emit_shop_created(shop_id, owner_cap_id);

    transfer::public_share_object(shop);
    (shop_id, owner_cap)
}

/// Disable a shop permanently (buyer flows will reject new checkouts).
public fun disable_shop(shop: &mut Shop, owner_cap: &ShopOwnerCap) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // TODO#q: we only disable shop but never enable it
    shop.disabled = true;

    // TODO#q: emit shop disabled should be emitted when only state changes
    events::emit_shop_disabled(shop.id(), owner_cap.id.to_inner());
}

/// Rotate the payout recipient for a shop.
///
/// Payouts should follow the current operator, not the address that originally created the shop.
/// Sui mindset:
/// - Access control is explicit: the operator must show the `ShopOwnerCap` rather than relying on
///   `ctx.sender()`. Rotating the cap keeps payouts aligned to the current operator.
/// - Buyers never handle capabilities--checkout remains permissionless against the shared `Shop`.
public fun update_shop_owner(shop: &mut Shop, owner_cap: &ShopOwnerCap, new_owner: address) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    let previous_owner = shop.owner;
    shop.owner = new_owner;

    events::emit_shop_owner_updated(shop.id(), owner_cap.id.to_inner(), previous_owner);
}

/// /// Adds a listing and returns the created listing ID.
///
/// Add an `ItemListing` attached to the `Shop`. The generic `T` encodes what will eventually be
/// minted when a buyer completes checkout. Prices are provided in USD cents (e.g. $12.50 -> 1_250)
/// to avoid floating point math.
///
/// Sui mindset:
/// - Capability-first auth replaces Solidity modifiers: the operator must present `ShopOwnerCap`
///   minted during `create_shop`; `ctx.sender()` alone is never trusted. Losing the cap means losing
///   control--much like losing a private key--but without implicit global ownership variables.
/// - Listings are stored in `Shop.listings` (`Table<ID, ItemListing>`), so admin and checkout
///   flows mutate `Shop` directly by listing ID.
/// - The type parameter `T` captures what will be minted, keeping item receipt types explicit
///   (phantom-typed `ShopItem<T>`) rather than relying on ad-hoc metadata blobs common in EVM NFTs.
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

    // TODO#q: move to item listing `listing::create` function with validation
    assert_listing_inputs!(shop, &name, base_price_usd_cents, stock, spotlight_discount_id);

    let shop_id = shop.id();
    let listing_id = ctx.fresh_object_address().to_id();
    assert_spotlight_discount_matches_listing!(shop, listing_id, spotlight_discount_id);
    let listing = listing::new<T>(
        listing_id,
        name,
        base_price_usd_cents,
        stock,
        spotlight_discount_id,
    );
    shop.listings.add(listing_id, listing);

    events::emit_item_listing_added(shop_id, listing_id);

    listing_id
}

/// Add an item listing and atomically create a listing-scoped discount in one transaction.
///
/// This is useful when callers want a listing-specific discount without requiring a pre-existing
/// listing ID. The new discount is automatically attached as the listing's spotlight discount.
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
        option::none(),
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

    // Link listing to spotlight discount.
    shop.listing_mut(listing_id).set_spotlight(discount_id);

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

/// Remove an item listing entirely.
///
/// This delists by removing the listing entry from `Shop.listings`.
/// Fails if listing doesn't exist.
/// Listings with any active listing-bound discounts must pause those discounts first.
public fun remove_item_listing(shop: &mut Shop, owner_cap: &ShopOwnerCap, listing_id: ID) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Will fail if listing doesn't exist.
    let listing = shop.listing(listing_id);
    assert!(listing.active_bound_discount_count() == 0, EListingHasActiveDiscounts);
    let _listing = shop.listings.remove(listing_id);

    events::emit_item_listing_removed(shop.id(), listing_id);
}

/// Register a coin type that the shop will price through an oracle feed.
///
/// Sui mindset:
/// - Payment assets are Move resources (`Coin<T>`, `Currency<T>`) instead of ERC-20 balances, so we
///   register by type--not by interface address--to keep currencies separated at compile time.
/// - Metadata (symbol/decimals) is fetched from `coin_registry`, a shared on-chain registry, rather
///   than trusting whatever a token contract returns. This avoids the "fake decimals" risk common in
///   ERC-20 land.
/// - Operators prove authority with `ShopOwnerCap`; buyers never touch this path. The cap pattern is
///   the Sui-native replacement for `onlyOwner`.
/// - Accepted currencies are stored in a typed `Table<TypeName, AcceptedCurrency>` under the
///   shared `Shop`, keyed by coin type.
/// - Callers supply the on-chain `PriceInfoObject` (fetched via RPC); the module re-validates feed
///   bytes and the Pyth object ID to defend against spoofed inputs. This reduces reliance on
///   off-chain metadata, but the caller still must provide the correct on-chain object.
/// - Sellers can optionally tighten oracle guardrails per currency (`max_price_age_secs_cap`,
///   `max_confidence_ratio_bps_cap`). Buyers may only tighten
///   `max_price_age_secs`/`max_confidence_ratio_bps` further--never loosen.
public fun add_accepted_currency<TCoin>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    currency: &Currency<TCoin>,
    price_info_object: &PriceInfoObject,
    feed_id: vector<u8>,
    pyth_object_id: ID,
    max_price_age_secs_cap: Option<u64>,
    max_confidence_ratio_bps_cap: Option<u16>,
) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Bind this currency to a specific PriceInfoObject to prevent oracle feed spoofing.
    let coin_type = type_name::with_defining_ids<TCoin>();
    assert!(!shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyExists);

    // Add accepted currency to storage.
    let accepted_currency = currency::create(
        feed_id,
        pyth_object_id,
        currency,
        max_price_age_secs_cap,
        max_confidence_ratio_bps_cap,
    );
    shop.accepted_currencies.add(coin_type, accepted_currency);

    // Validate on-chain oracle identity against the provided feed + object pairing.
    assert_price_info_identity!(feed_id, pyth_object_id, price_info_object);

    events::emit_accepted_coin_added(shop.id(), pyth_object_id);
}

/// Deregister an accepted coin type.
/// Fails if accepted currency is not registered.
public fun remove_accepted_currency<TCoin>(shop: &mut Shop, owner_cap: &ShopOwnerCap) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    let coin_type = type_name::with_defining_ids<TCoin>();
    assert!(shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyMissing);
    let accepted_currency = shop.accepted_currencies.remove(coin_type);

    events::emit_accepted_coin_removed(
        shop.id(),
        accepted_currency.pyth_object_id(),
    );
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
/// - Discounts live inside a typed on-chain collection attached to the shared shop instead of rows
///   in opaque contract storage.
/// - Converting user-friendly primitives into enums early avoids magic numbers and preserves type
///   safety. In EVM you might store raw integers and rely on comments; here the `DiscountRule` enum
///   forces exhaustive matching.
/// - Time windows and limits are stored on-chain and later checked against the shared `Clock`
///   (timestamp_ms -> seconds). On Sui, time is an explicit input object; on EVM, `block.timestamp`
///   is global state available to view/read-only calls but can drift within protocol bounds.
/// - `max_redemptions`: if set, must be greater than 0. If not set (`None`), there is no cap on
///   total redemptions and the counter is not protected from overflow.
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

    // Check that attached listing exists and update discount count if any listing is attached.
    applies_to_listing.do!(|listing_id| {
        shop.listing_mut(listing_id).increment_active_bound_discount_count();
    });

    // Create discount object and add to storage.
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

    let now_sec = now_secs(clock);
    let discount = shop.discount_mut(discount_id);
    discount.update(rule_kind, rule_value, starts_at, expires_at, max_redemptions, now_sec);

    events::emit_discount_updated(shop_id, discount.id());
}

/// Quickly enable/disable a coupon without deleting it.
/// Listing-scoped discounts also update shop-level active counters used by delist checks.
public fun toggle_discount(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_id: ID,
    active: bool,
) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    let discount = shop.discount(discount_id);
    if (active) {
        discount.applies_to_listing().do!(|listing_id| {
            assert!(shop.listings.contains(listing_id), EListingNotFound);
        });
    };
    shop.adjust_active_discount_count(
        discount.applies_to_listing(),
        discount.active(),
        active,
    );

    let discount = shop.discount_mut(discount_id);

    if (discount.active() != active) {
        discount.set_active(active);
        events::emit_discount_toggled(shop.id(), discount_id, active);
    };
}

/// Removes a discount from shop storage.
/// Fails if discount doesn't exist.
/// Fails if discount active and attached listing doesn't exists.
public fun remove_discount(shop: &mut Shop, owner_cap: &ShopOwnerCap, discount_id: ID) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    // Fails when discount doesn't exist.
    let discount = shop.discount(discount_id);
    let applies_to_listing = discount.applies_to_listing();
    let was_active = discount.active();

    shop.adjust_active_discount_count(applies_to_listing, was_active, false);

    // Clear listing spotlight if it matches discount.
    applies_to_listing.do!(|listing_id| {
        if (shop.listings.contains(listing_id)) {
            let listing = shop.listing_mut(listing_id);
            if (listing.spotlight_discount_id() == option::some(discount_id)) {
                listing.clear_spotlight();
            };
        };
    });

    let _ = shop.discounts.remove(discount_id);
}

/// Surface a discount alongside a listing so UIs can highlight the promotion.
public fun attach_discount_to_listing(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_id: ID,
    listing_id: ID,
) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);
    assert!(shop.discounts.contains(discount_id), EDiscountNotFound);
    assert_spotlight_discount_matches_listing!(shop, listing_id, option::some(discount_id));

    let item_listing = shop.listing_mut(listing_id);
    item_listing.set_spotlight(discount_id);
}

/// Remove the promotion banner from a listing.
public fun clear_discount_from_listing(shop: &mut Shop, owner_cap: &ShopOwnerCap, listing_id: ID) {
    assert!(owner_cap.shop_id == shop.id(), EInvalidOwnerCap);

    let item_listing = shop.listing_mut(listing_id);
    item_listing.clear_spotlight();
}

/// Execute a purchase priced in USD cents but settled with any previously registered `AcceptedCurrency`.
///
/// Sui mindset:
/// - There is no global ERC-20 allowance; the buyer passes an owned `Coin<T>`, the function splits
///   exactly what is needed, and refunds change in the same PTB.
/// - The `Shop` stores listings in a table, so checkout mutates the `Shop` to decrement stock for
///   the selected listing.
/// - Buyers pass explicit `mint_to` and `refund_extra_to` targets so PTBs can gift receipts or route
///   change without extra hops--common for custody or marketplace flows.
/// - Oracles are first-class objects. Callers supply a refreshed `PriceInfoObject`, and on-chain
///   logic verifies identity/freshness against the shared `Clock` and feed metadata.
/// - Guardrails (`max_price_age_secs`, `max_confidence_ratio_bps`) are caller-tunable only to
///   tighten them; overrides are capped at seller-set per-currency limits and `none` uses those caps.
/// - Compared to EVM: no `approve/transferFrom` race windows, no reliance on global stateful
///   oracles, and refunds happen in-line without reentrancy hooks because coin transfers are moves
///   of owned resources, not external calls.
public fun buy_item<TItem: store, TCoin>(
    shop: &mut Shop,
    price_info_object: &PriceInfoObject,
    payment: Coin<TCoin>,
    listing_id: ID,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!shop.disabled, EShopDisabled);

    let base_price_usd_cents = shop.listing(listing_id).base_price_usd_cents();
    // Payment is a Coin<T> object; process_purchase splits the payment and returns change.
    let (owed_coin_opt, change_coin, minted_item) = shop.process_purchase<TItem, TCoin>(
        price_info_object,
        payment,
        listing_id,
        base_price_usd_cents,
        option::none(),
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );
    owed_coin_opt.do!(|owed_coin| {
        transfer::public_transfer(owed_coin, shop.owner);
    });
    if (change_coin.value() == 0) {
        change_coin.destroy_zero();
    } else {
        transfer::public_transfer(change_coin, refund_extra_to);
    };
    transfer::public_transfer(minted_item, mint_to);
}

/// Same as `buy_item` but also validates that discount is applicable.
///
/// Sui mindset:
/// - The discount is a shared object anyone can read; this function validates the
///   discount/listing/shop linkage and increments redemptions to keep limits accurate.
/// - Refund destination is explicitly provided (`refund_extra_to`) so "gift" flows can return change
///   to the payer or recipient.
/// - Oracle guardrails remain caller-tunable; pass `none` to use defaults.
/// - In EVM you might check a Merkle root or signature each time; here the coupon object plus
///   discount counters provide the proof and rate-limiting without bespoke off-chain infra.
public fun buy_item_with_discount<TItem: store, TCoin>(
    shop: &mut Shop,
    discount_id: ID,
    price_info_object: &PriceInfoObject,
    payment: Coin<TCoin>,
    listing_id: ID,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!shop.disabled, EShopDisabled);

    let now_sec = now_secs(clock);
    let listing_price_usd_cents = shop.listing(listing_id).base_price_usd_cents();

    let shop_id = shop.id();
    let discount = shop.discount_mut(discount_id);
    let discounted_price_usd_cents = discount.redeem(listing_id, listing_price_usd_cents, now_sec);

    events::emit_discount_redeemed(
        shop_id,
        discount.id(),
    );

    let (owed_coin_opt, change_coin, minted_item) = shop.process_purchase<TItem, TCoin>(
        price_info_object,
        payment,
        listing_id,
        discounted_price_usd_cents,
        option::some(discount.id()),
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );
    owed_coin_opt.do!(|owed_coin| {
        transfer::public_transfer(owed_coin, shop.owner);
    });
    if (change_coin.value() == 0) {
        change_coin.destroy_zero();
    } else {
        transfer::public_transfer(change_coin, refund_extra_to);
    };
    transfer::public_transfer(minted_item, mint_to);
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

/// Returns the accepted currency config for `TCoin`.
public fun currency<TCoin>(shop: &Shop): &AcceptedCurrency {
    let coin_type = type_name::with_defining_ids<TCoin>();
    assert!(shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyMissing);
    shop.accepted_currencies.borrow(coin_type)
}

/// Returns true if the accepted currency is registered under the shop.
public fun currency_exists(shop: &Shop, coin_type: TypeName): bool {
    shop.accepted_currencies.contains(coin_type)
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
public fun quote_amount_for_price_info_object<TCoin>(
    shop: &Shop,
    price_info_object: &PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
): u64 {
    let accepted_currency = shop.currency<TCoin>();
    assert_price_info_identity!(
        accepted_currency.feed_id(),
        accepted_currency.pyth_object_id(),
        price_info_object,
    );

    // Entry-only quote helper; clients call via dev-inspect instead of storing quotes on-chain.
    quote_amount_with_guardrails(
        accepted_currency,
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

/// Returns `disabled` from the provided value.
public fun disabled(shop: &Shop): bool {
    shop.disabled
}

/// Returns `owner_cap_id` from the provided value.
public fun owner_cap_id(owner_cap: &ShopOwnerCap): ID {
    owner_cap.id.to_inner()
}

/// Returns `owner_cap_shop_id` from the provided value.
public fun owner_cap_shop_id(owner_cap: &ShopOwnerCap): ID {
    owner_cap.shop_id
}

// === Package Functions ===

// TODO#q: move to currency module
/// Converts a USD-cent amount into a quoted coin amount.
public(package) fun quote_amount_from_usd_cents(
    usd_cents: u64,
    decimals: u8,
    price: Price,
    max_confidence_ratio_bps: u16,
): u64 {
    let price_value = price.get_price();
    let mantissa = positive_price_to_u128(price_value);
    let confidence = price.get_conf() as u128;
    let exponent = price.get_expo();
    let exponent_is_negative = exponent.get_is_negative();
    let exponent_magnitude = if (exponent_is_negative) {
        exponent.get_magnitude_if_negative()
    } else {
        exponent.get_magnitude_if_positive()
    };
    let conservative_mantissa = conservative_price_mantissa(
        mantissa,
        confidence,
        max_confidence_ratio_bps,
    );

    let coin_decimals_pow10 = decimals_pow10_u128(decimals);
    let exponent_pow10 = pow10_u128(exponent_magnitude);

    let mut numerator_multiplier = coin_decimals_pow10;
    if (exponent_is_negative) {
        // TODO#q: use normal multiplication (without division by 1)
        numerator_multiplier =
            u128::mul_div(
                numerator_multiplier,
                exponent_pow10,
                1,
                rounding::down(),
            ).destroy_or!(abort EPriceOverflow);
    };

    let mut denominator_multiplier = u128::mul_div(
        conservative_mantissa,
        CENTS_PER_DOLLAR as u128,
        1,
        rounding::down(),
    ).destroy_or!(abort EPriceOverflow);
    if (!exponent_is_negative) {
        // TODO#q: use normal multiplication (without division by 1)
        denominator_multiplier =
            u128::mul_div(
                denominator_multiplier,
                exponent_pow10,
                1,
                rounding::down(),
            ).destroy_or!(abort EPriceOverflow);
    };

    let amount = u128::mul_div(
        usd_cents as u128,
        numerator_multiplier,
        denominator_multiplier,
        rounding::up(),
    ).destroy_or!(abort EPriceOverflow);
    let maybe_amount_u64 = amount.try_as_u64();
    maybe_amount_u64.destroy_or!(abort EPriceOverflow)
}

// === Private Functions ===

fun new(name: String, owner: address, ctx: &mut TxContext): Shop {
    assert!(!name.is_empty(), EEmptyShopName);
    Shop {
        id: object::new(ctx),
        owner,
        name,
        disabled: false,
        accepted_currencies: table::new<TypeName, AcceptedCurrency>(ctx),
        listings: table::new<ID, ItemListing>(ctx),
        discounts: table::new<ID, Discount>(ctx),
    }
}

fun listing_mut(shop: &mut Shop, listing_id: ID): &mut ItemListing {
    assert!(shop.listings.contains(listing_id), EListingNotFound);
    shop.listings.borrow_mut(listing_id)
}

fun discount_mut(shop: &mut Shop, discount_id: ID): &mut Discount {
    assert!(shop.discounts.contains(discount_id), EDiscountNotFound);
    shop.discounts.borrow_mut(discount_id)
}

fun adjust_active_discount_count(
    shop: &mut Shop,
    applies_to_listing: Option<ID>,
    was_active: bool,
    is_active: bool,
) {
    if (was_active == is_active) return;
    applies_to_listing.do!(|listing_id| {
        if (is_active) {
            shop.listing_mut(listing_id).increment_active_bound_discount_count();
        } else {
            shop.listing_mut(listing_id).decrement_active_bound_discount_count();
        };
    });
}

// TODO#q: move to currency module
/// Resolve caller overrides against seller caps so pricing guardrails stay tight.
fun resolve_effective_guardrails(
    accepted_currency: &AcceptedCurrency,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
): EffectiveGuardrails {
    let requested_max_age = max_price_age_secs.destroy_or!(
        accepted_currency.max_price_age_secs_cap(),
    );
    let requested_confidence_ratio = max_confidence_ratio_bps.destroy_or!(
        accepted_currency.max_confidence_ratio_bps_cap(),
    );
    let effective_max_age = requested_max_age.min(accepted_currency.max_price_age_secs_cap());
    let effective_confidence_ratio = requested_confidence_ratio.min(accepted_currency.max_confidence_ratio_bps_cap());
    EffectiveGuardrails {
        max_price_age_secs: effective_max_age,
        max_confidence_ratio_bps: effective_confidence_ratio,
    }
}

// TODO#q: move to currency module
fun quote_amount_with_guardrails(
    accepted_currency: &AcceptedCurrency,
    price_info_object: &PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
): u64 {
    let effective_guardrails = resolve_effective_guardrails(
        accepted_currency,
        max_price_age_secs,
        max_confidence_ratio_bps,
    );
    let price_info = price_info::get_price_info_from_price_info_object(
        price_info_object,
    );
    let current_price = price_info.get_price_feed().get_price();
    let publish_time = current_price.get_timestamp();
    let now_sec = now_secs(clock);
    assert!(now_sec >= publish_time, EPriceInvalidPublishTime);
    assert!(
        now_sec - publish_time <= effective_guardrails.max_price_age_secs,
        EPriceInvalidPublishTime,
    );
    let price = pyth::get_price_no_older_than(
        price_info_object,
        clock,
        effective_guardrails.max_price_age_secs,
    );
    quote_amount_from_usd_cents(
        price_usd_cents,
        accepted_currency.decimals(),
        price,
        effective_guardrails.max_confidence_ratio_bps,
    )
}

fun process_purchase<TItem: store, TCoin>(
    shop: &mut Shop,
    price_info_object: &PriceInfoObject,
    mut payment: Coin<TCoin>,
    listing_id: ID,
    discounted_price_usd_cents: u64,
    discount_id: Option<ID>,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
): (Option<Coin<TCoin>>, Coin<TCoin>, ShopItem<TItem>) {
    let accepted_currency = shop.currency<TCoin>();
    assert_price_info_identity!(
        accepted_currency.feed_id(),
        accepted_currency.pyth_object_id(),
        price_info_object,
    );

    let quote_amount = quote_amount_with_guardrails(
        accepted_currency,
        price_info_object,
        discounted_price_usd_cents,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
    );
    let pyth_price_info_object_id = accepted_currency.pyth_object_id();
    let shop_id = shop.id();

    let item_listing = shop.listing_mut(listing_id);
    assert!(item_listing.item_type() == type_name::with_defining_ids<TItem>(), EItemTypeMismatch);
    assert!(item_listing.stock() > 0, EOutOfStock);

    let owed_coin_opt = split_payment(&mut payment, quote_amount, ctx);
    let amount_paid = owed_coin_opt.map_ref!(|owed_coin| owed_coin.value()).destroy_or!(0);

    let previous_stock = item_listing.stock();
    item_listing.decrement_stock();

    events::emit_item_listing_stock_updated(shop_id, item_listing.id(), previous_stock);

    let minted_item = mint_shop_item<TItem>(item_listing, shop_id, clock, ctx);
    let minted_item_id = minted_item.id.to_inner();

    events::emit_purchase_completed(
        shop_id,
        item_listing.id(),
        pyth_price_info_object_id,
        discount_id,
        minted_item_id,
        amount_paid,
        discounted_price_usd_cents,
    );
    (owed_coin_opt, payment, minted_item)
}

// TODO#q: use ms and convert to sec when we need
/// Normalize consensus clock milliseconds to seconds once at the boundary.
/// Pyth stale checks and price timestamps are second-based (`max_age_secs` vs `price::get_timestamp`),
/// so keeping module guardrails in seconds avoids mixed-unit errors.
fun now_secs(clock: &Clock): u64 {
    clock.timestamp_ms() / 1000
}

fun decimals_pow10_u128(decimals: u8): u128 {
    assert!(decimals as u64 <= MAX_DECIMAL_POWER, EUnsupportedCurrencyDecimals);

    decimal_scaling::safe_upcast_balance(
        1,
        0,
        decimals,
    )
        .try_as_u128()
        .destroy_or!(abort EPriceOverflow)
}

fun pow10_u128(exponent: u64): u128 {
    assert!(exponent <= MAX_DECIMAL_POWER, EPriceOverflow);
    std::u128::pow(10, exponent as u8)
}

fun positive_price_to_u128(value: i64::I64): u128 {
    assert!(!value.get_is_negative(), EPriceNonPositive);
    value.get_magnitude_if_positive() as u128
}

/// Apply mu-sigma per Pyth best practices to avoid undercharging when prices are uncertain.
fun conservative_price_mantissa(
    mantissa: u128,
    confidence: u128,
    max_confidence_ratio_bps: u16,
): u128 {
    assert!(mantissa > confidence, EConfidenceExceedsPrice);
    let scaled_confidence = confidence * (BASIS_POINT_DENOMINATOR as u128);
    let max_allowed = mantissa * (max_confidence_ratio_bps as u128);
    assert!(scaled_confidence <= max_allowed, EConfidenceIntervalTooWide);
    mantissa - confidence
}

fun split_payment<TCoin>(
    payment: &mut Coin<TCoin>,
    amount_due: u64,
    ctx: &mut TxContext,
): Option<Coin<TCoin>> {
    if (amount_due == 0) {
        return option::none()
    };

    let available = payment.value();
    assert!(available >= amount_due, EInsufficientPayment);
    let owed = payment.split(amount_due, ctx);
    option::some(owed)
}

// TODO#q: move to listing module
fun mint_shop_item<TItem: store>(
    item_listing: &ItemListing,
    shop_id: ID,
    clock: &Clock,
    ctx: &mut TxContext,
): ShopItem<TItem> {
    assert!(item_listing.item_type() == type_name::with_defining_ids<TItem>(), EItemTypeMismatch);

    ShopItem {
        id: object::new(ctx),
        shop_id,
        item_listing_id: item_listing.id(),
        item_type: item_listing.item_type(),
        name: item_listing.name(),
        acquired_at: now_secs(clock),
    }
}

// TODO#q: inline and move to listing module
macro fun assert_listing_inputs(
    $shop: &Shop,
    $name: &String,
    $base_price_usd_cents: u64,
    $stock: u64,
    $spotlight_discount_id: Option<ID>,
) {
    let shop = $shop;
    let name = $name;
    let base_price_usd_cents = $base_price_usd_cents;
    let stock = $stock;
    let spotlight_discount_id = $spotlight_discount_id;

    assert!(stock > 0, EZeroStock);
    assert!(!name.is_empty(), EEmptyItemName);
    assert!(base_price_usd_cents > 0, EInvalidPrice);

    spotlight_discount_id.do!(|discount_id| {
        assert!(shop.discounts.contains(discount_id), EDiscountNotFound);
    });
}

// TODO#q: move to currency module
macro fun assert_price_info_identity(
    $expected_feed_id: vector<u8>,
    $expected_pyth_object_id: ID,
    $price_info_object: &PriceInfoObject,
) {
    let expected_feed_id = $expected_feed_id;
    let expected_pyth_object_id = $expected_pyth_object_id;
    let price_info_object = $price_info_object;
    let confirmed_price_object = price_info_object.uid_to_inner();
    assert!(confirmed_price_object == expected_pyth_object_id, EPythObjectMismatch);

    let price_info = price_info::get_price_info_from_price_info_object(
        price_info_object,
    );
    let identifier = price_info.get_price_identifier();
    let identifier_bytes = identifier.get_bytes();
    assert!(expected_feed_id == identifier_bytes, EFeedIdentifierMismatch);
}

macro fun assert_spotlight_discount_matches_listing(
    $shop: &Shop,
    $listing_id: ID,
    $discount_id: Option<ID>,
) {
    let shop = $shop;
    let listing_id = $listing_id;
    let discount_id = $discount_id;
    discount_id.do!(|discount_id| {
        assert!(shop.discounts.contains(discount_id), EDiscountNotFound);
        let discount = shop.discount(discount_id);
        discount.applies_to_listing().do!(|applies_to_listing| {
            assert!(applies_to_listing == listing_id, ESpotlightDiscountListingMismatch);
        });
    });
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
