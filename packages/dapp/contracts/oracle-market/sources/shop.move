/// Oracle marketplace implementation overview:
///
/// - Shared objects (Shop): shared objects are
///   globally addressable. Anyone can include them as inputs and read them, and any transaction
///   that mutates them goes through consensus. What "can mutate" really means is "can submit a
///   tx that tries" -- the module still enforces its own authorization checks. This module keeps a
///   single shared root (`Shop`) and stores listings/currencies/templates in typed dynamic
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
/// - Table collections (listings + accepted currencies + discount templates):
///   typed dynamic collections keep config under `Shop` without exposing
///   listings/currencies/templates as standalone shared objects.
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
use pyth::price;
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
use sui_oracle_market::discount::{Self, DiscountTemplate};
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
const ETemplateWindow: vector<u8> = "invalid template window";
#[error(code = 5)]
const ETemplateNotFound: vector<u8> = "template not found";
#[error(code = 6)]
const EListingNotFound: vector<u8> = "listing not found";
#[error(code = 7)]
const EListingHasActiveTemplates: vector<u8> = "listing has active templates";
#[error(code = 8)]
const EListingTemplateCountUnderflow: vector<u8> = "listing template count underflow";
#[error(code = 9)]
const EAcceptedCurrencyExists: vector<u8> = "accepted currency exists";
#[error(code = 10)]
const EAcceptedCurrencyMissing: vector<u8> = "accepted currency missing";
#[error(code = 11)]
const EEmptyFeedId: vector<u8> = "empty feed id";
#[error(code = 12)]
const EInvalidFeedIdLength: vector<u8> = "invalid feed id length";
#[error(code = 13)]
const ETemplateInactive: vector<u8> = "template inactive";
#[error(code = 14)]
const ETemplateTooEarly: vector<u8> = "template too early";
#[error(code = 15)]
const ETemplateExpired: vector<u8> = "template expired";
#[error(code = 16)]
const ETemplateMaxedOut: vector<u8> = "template maxed out";
#[error(code = 17)]
const EOutOfStock: vector<u8> = "out of stock";
#[error(code = 18)]
const EPythObjectMismatch: vector<u8> = "pyth object mismatch";
#[error(code = 19)]
const EFeedIdentifierMismatch: vector<u8> = "feed identifier mismatch";
#[error(code = 20)]
const EPriceNonPositive: vector<u8> = "price non-positive";
#[error(code = 21)]
const EPriceOverflow: vector<u8> = "price overflow";
#[error(code = 22)]
const EInsufficientPayment: vector<u8> = "insufficient payment";
#[error(code = 23)]
const EConfidenceIntervalTooWide: vector<u8> = "confidence interval too wide";
#[error(code = 24)]
const EConfidenceExceedsPrice: vector<u8> = "confidence exceeds price";
#[error(code = 25)]
const ESpotlightTemplateListingMismatch: vector<u8> = "spotlight template listing mismatch";
#[error(code = 26)]
const EInvalidGuardrailCap: vector<u8> = "invalid guardrail cap";
#[error(code = 27)]
const ETemplateFinalized: vector<u8> = "template finalized";
#[error(code = 28)]
const EItemTypeMismatch: vector<u8> = "item type mismatch";
#[error(code = 29)]
const EUnsupportedCurrencyDecimals: vector<u8> = "unsupported currency decimals";
#[error(code = 30)]
const EEmptyShopName: vector<u8> = "empty shop name";
#[error(code = 31)]
const EShopDisabled: vector<u8> = "shop disabled";
#[error(code = 32)]
const EPriceInvalidPublishTime: vector<u8> = "invalid publish timestamp";
#[error(code = 33)]
const EDiscountListingMismatch: vector<u8> = "discount listing mismatch";
#[error(code = 34)]
const EInvalidMaxRedemptions: vector<u8> = "invalid max redemptions";

// === Constants ===

const CENTS_PER_DOLLAR: u64 = 100;
const BASIS_POINT_DENOMINATOR: u64 = 10_000;
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;
const MAX_DECIMAL_POWER: u64 = 24;
/// Reject price feeds with sigma/mu above 10%.
const DEFAULT_MAX_CONFIDENCE_RATIO_BPS: u16 = 1_000;
const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;

// === Init ===

/// Claims and returns the module's Publisher object during publish.
public struct SHOP has drop {}

fun init(publisher_witness: SHOP, ctx: &mut TxContext) {
    package::claim_and_keep<SHOP>(publisher_witness, ctx);
}

// === Capability & Core ===

/// Capability that proves the caller can administer a specific `Shop`.
/// Holding and using this object is the Sui-native equivalent of matching `onlyOwner` criteria in Solidity.
public struct ShopOwnerCap has key, store {
    /// Object ID for this capability.
    id: UID,
    /// Shop governed by this capability.
    shop_id: ID,
}

/// Shared shop that stores listings, currencies, and discount templates in typed dynamic collections.
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
    /// Discount templates keyed by template ID.
    discount_templates: Table<ID, DiscountTemplate>,
}

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

/// Resolved pricing guardrails after capping buyer overrides against seller limits.
public struct EffectiveGuardrails has copy, drop {
    max_price_age_secs: u64,
    max_confidence_ratio_bps: u16,
}

// === Public Functions ===

// === Shop ===

/// Create a new shop and its owner capability.
///
/// Any address can spin up a shop and receive the corresponding owner capability.
/// Sui mindset:
/// - Capability > `msg.sender`: ownership lives in a first-class `ShopOwnerCap`. Admin functions
///   require the cap, so authority follows the object holder rather than whichever address signs
///   the PTB. Solidity relies on `msg.sender` and modifiers; here, capabilities are explicit inputs.
/// - Shared object composition: the shop is shared, with listings/currencies stored in typed
///   table storage and discount templates stored directly in a typed `Table`.
/// - State stays sharded so PTBs only touch the listing slot/template object they mutate.
public fun create_shop(name: String, ctx: &mut TxContext): (ID, ShopOwnerCap) {
    let shop = new_shop(name, ctx.sender(), ctx);
    let shop_id = shop.id.to_inner();

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
    assert_owner_cap!(shop, owner_cap);
    shop.disabled = true;

    events::emit_shop_disabled(shop.id.to_inner(), owner_cap.id.to_inner());
}

/// Rotate the payout recipient for a shop.
///
/// Payouts should follow the current operator, not the address that originally created the shop.
/// Sui mindset:
/// - Access control is explicit: the operator must show the `ShopOwnerCap` rather than relying on
///   `ctx.sender()`. Rotating the cap keeps payouts aligned to the current operator.
/// - Buyers never handle capabilities--checkout remains permissionless against the shared `Shop`.
public fun update_shop_owner(shop: &mut Shop, owner_cap: &ShopOwnerCap, new_owner: address) {
    assert_owner_cap!(shop, owner_cap);

    let previous_owner = shop.owner;
    shop.owner = new_owner;

    events::emit_shop_owner_updated(shop.id.to_inner(), owner_cap.id.to_inner(), previous_owner);
}

// === Item Listing ===

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
    spotlight_discount_template_id: Option<ID>,
    ctx: &mut TxContext,
): ID {
    assert_owner_cap!(shop, owner_cap);
    assert_listing_inputs!(
        shop,
        &name,
        base_price_usd_cents,
        stock,
        spotlight_discount_template_id,
    );

    let shop_id = shop.id.to_inner();
    let listing_id = new_object_id(ctx);
    assert_spotlight_template_matches_listing!(shop, listing_id, spotlight_discount_template_id);
    let listing = listing::new<T>(
        listing_id,
        name,
        base_price_usd_cents,
        stock,
        spotlight_discount_template_id,
    );
    shop.listings.add(listing_id, listing);

    events::emit_item_listing_added(shop_id, listing_id);

    listing_id
}

fun link_listing_spotlight_template(shop: &mut Shop, listing_id: ID, discount_template_id: ID) {
    let listing = shop.borrow_listing_mut(listing_id);
    listing.set_spotlight(discount_template_id);
}

/// Add an item listing and atomically create a listing-scoped discount template in one transaction.
///
/// This is useful when callers want a listing-specific template without requiring a pre-existing
/// listing ID. The new template is automatically attached as the listing's spotlight template.
public fun add_item_listing_with_discount_template<T: store>(
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
    let discount_template_id = shop.create_discount_template(
        owner_cap,
        option::some(listing_id),
        rule_kind,
        rule_value,
        starts_at,
        expires_at,
        max_redemptions,
        ctx,
    );

    shop.link_listing_spotlight_template(listing_id, discount_template_id);

    (listing_id, discount_template_id)
}

/// Update the inventory count for a listing (0 inventory to pause selling).
public fun update_item_listing_stock(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    listing_id: ID,
    new_stock: u64,
) {
    assert_owner_cap!(shop, owner_cap);
    let item_listing = shop.borrow_listing_mut(listing_id);

    let previous_stock = item_listing.stock();
    item_listing.set_stock(new_stock);

    events::emit_item_listing_stock_updated(shop.id.to_inner(), listing_id, previous_stock);
}

/// Remove an item listing entirely.
///
/// This delists by removing the listing entry from `Shop.listings`.
/// Listings with any active listing-bound templates must pause those templates first.
public fun remove_item_listing(shop: &mut Shop, owner_cap: &ShopOwnerCap, listing_id: ID) {
    assert_owner_cap!(shop, owner_cap);
    assert!(!shop.has_active_listing_bound_templates(listing_id), EListingHasActiveTemplates);
    let _listing = shop.listings.remove(listing_id);

    events::emit_item_listing_removed(shop.id.to_inner(), listing_id);
}

// === Accepted Currencies ===

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
    assert_owner_cap!(shop, owner_cap);

    let coin_type = currency_type<TCoin>();

    // Bind this currency to a specific PriceInfoObject to prevent oracle feed spoofing.
    assert_accepted_currency_inputs!(shop, coin_type, feed_id, pyth_object_id, price_info_object);

    let decimals = currency.decimals();
    assert_supported_decimals!(decimals);
    let symbol = currency.symbol();
    let shop_id = shop.id.to_inner();
    let age_cap = resolve_guardrail_cap!(max_price_age_secs_cap, DEFAULT_MAX_PRICE_AGE_SECS);
    let confidence_cap = resolve_guardrail_cap!(
        max_confidence_ratio_bps_cap,
        DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );

    let accepted_currency = currency::new(
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
        age_cap,
        confidence_cap,
    );
    shop.accepted_currencies.add(coin_type, accepted_currency);

    events::emit_accepted_coin_added(shop_id, pyth_object_id);
}

/// Deregister an accepted coin type.
public fun remove_accepted_currency<TCoin>(shop: &mut Shop, owner_cap: &ShopOwnerCap) {
    assert_owner_cap!(shop, owner_cap);
    let coin_type = currency_type<TCoin>();
    let accepted_currency = shop.remove_registered_accepted_currency(coin_type);

    events::emit_accepted_coin_removed(
        shop.id.to_inner(),
        accepted_currency.pyth_object_id(),
    );
}

// === Discount ===

/// Create a discount template anchored under the shop.
///
/// Templates are stored in the shop's `discount_templates: Table<ID, DiscountTemplate>` collection.
/// Admin functions enforce `ShopOwnerCap` checks when creating/updating/toggling templates, and
/// templates remain addressable by `ID` for UIs.
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
public fun create_discount_template(
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
    assert_owner_cap!(shop, owner_cap);
    assert_discount_template_inputs!(shop, applies_to_listing, starts_at, expires_at);
    max_redemptions.do_ref!(|max_value| {
        assert!(*max_value > 0, EInvalidMaxRedemptions);
    });

    let discount_rule_kind = discount::parse_kind(rule_kind);
    let discount_rule = discount::build(discount_rule_kind, rule_value);
    let discount_template_id = new_object_id(ctx);
    let discount_template = discount::new(
        discount_template_id,
        applies_to_listing,
        discount_rule,
        starts_at,
        expires_at,
        max_redemptions,
    );
    shop.discount_templates.add(discount_template_id, discount_template);

    // Increment active listing template count if any listing attached.
    applies_to_listing.do_ref!(|listing_id| {
        shop.increment_active_listing_template_count(*listing_id);
    });

    events::emit_discount_template_created(
        shop.id.to_inner(),
        discount_template_id,
    );

    discount_template_id
}

/// Update mutable fields on a template (schedule, rule, limits).
/// For `Fixed` discounts the `rule_value` remains in USD cents.
/// Updates are only allowed before any tickets are issued or redeemed and before the template is
/// finished (expired or capped), so claim accounting cannot be retroactively changed.
/// `max_redemptions`: if set, must be greater than 0. If not set (`None`), there is no cap on
/// total redemptions and the counter is not protected from overflow.
public fun update_discount_template(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_template_id: ID,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    clock: &Clock,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_template_registered!(shop, discount_template_id);
    assert_schedule!(starts_at, expires_at);
    max_redemptions.do_ref!(|max_value| {
        assert!(*max_value > 0, EInvalidMaxRedemptions);
    });

    let discount_rule_kind = discount::parse_kind(rule_kind);
    let discount_rule = discount::build(discount_rule_kind, rule_value);
    let now = now_secs(clock);
    let shop_id = shop.id.to_inner();

    let discount_template = shop.borrow_discount_template_mut(discount_template_id);
    assert_template_updatable!(discount_template, now);

    // Apply discount template updates
    discount_template.set_rule(discount_rule);
    discount_template.set_starts_at(starts_at);
    discount_template.set_expires_at(expires_at);
    discount_template.set_max_redemptions(max_redemptions);

    events::emit_discount_template_updated(shop_id, discount_template.id());
}

/// Quickly enable/disable a coupon without deleting it.
/// Listing-scoped templates also update shop-level active counters used by delist checks.
public fun toggle_discount_template(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_template_id: ID,
    active: bool,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_template_registered!(shop, discount_template_id);

    let discount_template = shop.borrow_discount_template(discount_template_id);
    if (active) {
        assert_listing_belongs_to_shop_if_some!(shop, discount_template.applies_to_listing());
    };
    shop.adjust_active_template_count(
        discount_template.applies_to_listing(),
        discount_template.active(),
        active,
    );

    let discount_template = shop.borrow_discount_template_mut(discount_template_id);

    if (discount_template.active() != active) {
        discount_template.set_active(active);
        events::emit_discount_template_toggled(shop.id.to_inner(), discount_template_id, active);
    };
}

/// Removes a template from shop storage.
///
/// Package visibility keeps this API available for local tests and package scripts while avoiding
/// extra `#[test_only]` wrapper surface.
public(package) fun remove_discount_template(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_template_id: ID,
) {
    assert_owner_cap!(shop, owner_cap);
    shop.remove_discount_template_if_exists(discount_template_id);
}

/// Surface a template alongside a listing so UIs can highlight the promotion.
public fun attach_template_to_listing(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    discount_template_id: ID,
    listing_id: ID,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_template_registered!(shop, discount_template_id);
    assert_spotlight_template_matches_listing!(
        shop,
        listing_id,
        option::some(discount_template_id),
    );

    let item_listing = shop.borrow_listing_mut(listing_id);
    item_listing.set_spotlight(discount_template_id);
}

/// Remove the promotion banner from a listing.
public fun clear_template_from_listing(shop: &mut Shop, owner_cap: &ShopOwnerCap, listing_id: ID) {
    assert_owner_cap!(shop, owner_cap);
    let item_listing = shop.borrow_listing_mut(listing_id);
    item_listing.clear_spotlight();
}

// === Checkout ===

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
    assert_shop_active!(shop);
    let base_price_usd_cents = shop.borrow_listing(listing_id).base_price_usd_cents();
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
/// - The discount template is a shared object anyone can read; this function validates the
///   template/listing/shop linkage and increments redemptions to keep limits accurate.
/// - Refund destination is explicitly provided (`refund_extra_to`) so "gift" flows can return change
///   to the payer or recipient.
/// - Oracle guardrails remain caller-tunable; pass `none` to use defaults.
/// - In EVM you might check a Merkle root or signature each time; here the coupon object plus
///   template counters provide the proof and rate-limiting without bespoke off-chain infra.
public fun buy_item_with_discount<TItem: store, TCoin>(
    shop: &mut Shop,
    discount_template_id: ID,
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
    assert_shop_active!(shop);

    let now = now_secs(clock);
    let listing_price_usd_cents = shop.borrow_listing(listing_id).base_price_usd_cents();

    let shop_id = shop.id.to_inner();
    let discount_template = shop.borrow_discount_template_mut(discount_template_id);
    assert_discount_redemption_allowed!(discount_template, listing_id, now);

    discount_template.increment_redemptions();
    let discounted_price_usd_cents = discount_template
        .rule()
        .apply(
            listing_price_usd_cents,
        );

    events::emit_discount_redeemed(
        shop_id,
        discount_template.id(),
    );

    let (owed_coin_opt, change_coin, minted_item) = shop.process_purchase<TItem, TCoin>(
        price_info_object,
        payment,
        listing_id,
        discounted_price_usd_cents,
        option::some(discount_template.id()),
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

// === Data ===

fun new_shop(name: String, owner: address, ctx: &mut TxContext): Shop {
    assert_shop_name!(&name);
    Shop {
        id: object::new(ctx),
        owner,
        name,
        disabled: false,
        accepted_currencies: table::new<TypeName, AcceptedCurrency>(ctx),
        listings: table::new<ID, ItemListing>(ctx),
        discount_templates: table::new<ID, DiscountTemplate>(ctx),
    }
}

// === Helpers ===

// TODO#q: use bag instead
fun currency_type<TCoin>(): TypeName {
    type_name::with_defining_ids<TCoin>()
}

// TODO#q: inline
fun new_object_id(ctx: &mut TxContext): ID {
    ctx.fresh_object_address().to_id()
}

// TODO#q: inline
fun has_active_listing_bound_templates(shop: &Shop, listing_id: ID): bool {
    shop.borrow_listing(listing_id).active_bound_template_count() > 0
}

fun adjust_active_template_count(
    shop: &mut Shop,
    applies_to_listing: Option<ID>,
    was_active: bool,
    is_active: bool,
) {
    if (was_active == is_active) return;
    applies_to_listing.do_ref!(|listing_id| {
        if (is_active) {
            shop.increment_active_listing_template_count(*listing_id);
        } else {
            shop.decrement_active_listing_template_count(*listing_id);
        };
    });
}

fun remove_discount_template_if_exists(shop: &mut Shop, template_id: ID) {
    if (!shop.discount_templates.contains(template_id)) return;

    let (applies_to_listing, was_active) = {
        let template = shop.borrow_discount_template(template_id);
        (template.applies_to_listing(), template.active())
    };

    if (was_active) {
        applies_to_listing.do_ref!(|listing_id| {
            assert!(shop.listings.contains(*listing_id), EListingNotFound);
        });
    };
    shop.adjust_active_template_count(applies_to_listing, was_active, false);
    shop.clear_listing_spotlight_if_matches_template(applies_to_listing, template_id);

    let _ = shop.discount_templates.remove(template_id);
}

fun clear_listing_spotlight_if_matches_template(
    shop: &mut Shop,
    applies_to_listing: Option<ID>,
    template_id: ID,
) {
    applies_to_listing.do_ref!(|listing_id| {
        if (shop.listings.contains(*listing_id)) {
            let listing = shop.borrow_listing_mut(*listing_id);
            if (listing.spotlight_discount_template_id() == option::some(template_id)) {
                listing.clear_spotlight();
            };
        };
    });
}

fun increment_active_listing_template_count(shop: &mut Shop, listing_id: ID) {
    let listing = shop.borrow_listing_mut(listing_id);
    listing.increment_active_bound_template_count();
}

fun decrement_active_listing_template_count(shop: &mut Shop, listing_id: ID) {
    let listing = shop.borrow_listing_mut(listing_id);
    assert!(listing.active_bound_template_count() > 0, EListingTemplateCountUnderflow);
    listing.decrement_active_bound_template_count();
}

// TODO#q: We should have listing and listing_mut only
fun borrow_listing(shop: &Shop, listing_id: ID): &ItemListing {
    assert_listing_registered!(shop, listing_id);
    shop.listings.borrow(listing_id)
}

fun borrow_listing_mut(shop: &mut Shop, listing_id: ID): &mut ItemListing {
    assert_listing_registered!(shop, listing_id);
    shop.listings.borrow_mut(listing_id)
}

fun borrow_discount_template(shop: &Shop, template_id: ID): &DiscountTemplate {
    assert_template_registered!(shop, template_id);
    shop.discount_templates.borrow(template_id)
}

fun borrow_discount_template_mut(shop: &mut Shop, template_id: ID): &mut DiscountTemplate {
    assert_template_registered!(shop, template_id);
    shop.discount_templates.borrow_mut(template_id)
}

/// Normalize a seller-provided guardrail cap, enforcing module-level ceilings and non-zero.
macro fun resolve_guardrail_cap<$T>($proposed_cap: Option<$T>, $module_cap: $T): $T {
    let proposed_cap = $proposed_cap;
    let module_cap = $module_cap;
    let value = proposed_cap.destroy_or!(module_cap);
    assert!(value > 0, EInvalidGuardrailCap);
    value.min(module_cap)
}

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

fun borrow_registered_accepted_currency(shop: &Shop, coin_type: TypeName): &AcceptedCurrency {
    assert!(shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyMissing);
    shop.accepted_currencies.borrow(coin_type)
}

fun remove_registered_accepted_currency(shop: &mut Shop, coin_type: TypeName): AcceptedCurrency {
    assert!(shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyMissing);
    shop.accepted_currencies.remove(coin_type)
}

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
    let now = now_secs(clock);
    assert!(now >= publish_time, EPriceInvalidPublishTime);
    assert!(
        now - publish_time <= effective_guardrails.max_price_age_secs,
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
    discount_template_id: Option<ID>,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
): (Option<Coin<TCoin>>, Coin<TCoin>, ShopItem<TItem>) {
    let coin_type = currency_type<TCoin>();

    let accepted_currency = shop.borrow_registered_accepted_currency(coin_type);
    assert_price_info_matches_currency!(accepted_currency, price_info_object);
    let quote_amount = quote_amount_with_guardrails(
        accepted_currency,
        price_info_object,
        discounted_price_usd_cents,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
    );
    let pyth_price_info_object_id = accepted_currency.pyth_object_id();
    let shop_id = shop.id.to_inner();

    let item_listing = shop.borrow_listing_mut(listing_id);
    assert_listing_type_matches!<TItem>(item_listing);
    assert_stock_available!(item_listing);

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
        discount_template_id,
        minted_item_id,
        amount_paid,
        discounted_price_usd_cents,
    );
    (owed_coin_opt, payment, minted_item)
}

/// Normalize consensus clock milliseconds to seconds once at the boundary.
/// Pyth stale checks and price timestamps are second-based (`max_age_secs` vs `price::get_timestamp`),
/// so keeping module guardrails in seconds avoids mixed-unit errors.
fun now_secs(clock: &Clock): u64 {
    clock.timestamp_ms() / 1000
}

/// Converts a USD-cent amount into a quoted coin amount.
public(package) fun quote_amount_from_usd_cents(
    usd_cents: u64,
    coin_decimals: u8,
    price: price::Price,
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

    let coin_decimals_pow10 = decimals_pow10_u128(coin_decimals);
    let exponent_pow10 = pow10_u128(exponent_magnitude);

    let mut numerator_multiplier = coin_decimals_pow10;
    if (exponent_is_negative) {
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

fun decimals_pow10_u128(coin_decimals: u8): u128 {
    assert_supported_decimals!(coin_decimals);
    decimal_scaling::safe_upcast_balance(
        1,
        0,
        coin_decimals,
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

fun mint_shop_item<TItem: store>(
    item_listing: &ItemListing,
    shop_id: ID,
    clock: &Clock,
    ctx: &mut TxContext,
): ShopItem<TItem> {
    assert_listing_type_matches!<TItem>(item_listing);

    ShopItem {
        id: object::new(ctx),
        shop_id,
        item_listing_id: item_listing.id(),
        item_type: item_listing.item_type(),
        name: item_listing.name(),
        acquired_at: now_secs(clock),
    }
}

// === Asserts and validations ===

macro fun assert_owner_cap($shop: &Shop, $owner_cap: &ShopOwnerCap) {
    let shop = $shop;
    let owner_cap = $owner_cap;
    assert!(owner_cap.shop_id == shop.id.to_inner(), EInvalidOwnerCap);
}

macro fun assert_shop_active($shop: &Shop) {
    let shop = $shop;
    assert!(!shop.disabled, EShopDisabled);
}

macro fun assert_template_registered($shop: &Shop, $template_id: ID) {
    let shop = $shop;
    let template_id = $template_id;
    assert!(shop.discount_templates.contains(template_id), ETemplateNotFound);
}

macro fun assert_listing_registered($shop: &Shop, $listing_id: ID) {
    let shop = $shop;
    let listing_id = $listing_id;
    assert!(shop.listings.contains(listing_id), EListingNotFound);
}

macro fun assert_non_zero_stock($stock: u64) {
    let stock = $stock;
    assert!(stock > 0, EZeroStock)
}

macro fun assert_stock_available($item_listing: &ItemListing) {
    let item_listing = $item_listing;
    assert!(item_listing.stock() > 0, EOutOfStock);
}

macro fun assert_schedule($starts_at: u64, $expires_at: Option<u64>) {
    let starts_at = $starts_at;
    let expires_at = $expires_at;
    expires_at.do_ref!(|expires_at_value| {
        assert!(*expires_at_value > starts_at, ETemplateWindow);
    });
}

macro fun assert_listing_type_matches<$TItem: store>($item_listing: &ItemListing) {
    let item_listing = $item_listing;
    let expected = type_name::with_defining_ids<$TItem>();
    assert!(item_listing.item_type() == expected, EItemTypeMismatch);
}

macro fun assert_listing_inputs(
    $shop: &Shop,
    $name: &String,
    $base_price_usd_cents: u64,
    $stock: u64,
    $spotlight_discount_template_id: Option<ID>,
) {
    let shop = $shop;
    let name = $name;
    let base_price_usd_cents = $base_price_usd_cents;
    let stock = $stock;
    let spotlight_discount_template_id = $spotlight_discount_template_id;

    assert_non_zero_stock!(stock);
    assert!(!name.is_empty(), EEmptyItemName);
    assert!(base_price_usd_cents > 0, EInvalidPrice);

    assert_template_belongs_to_shop_if_some!(shop, spotlight_discount_template_id);
}

macro fun assert_shop_name($name: &String) {
    let name = $name;
    assert!(!name.is_empty(), EEmptyShopName);
}

macro fun assert_discount_template_inputs(
    $shop: &Shop,
    $applies_to_listing: Option<ID>,
    $starts_at: u64,
    $expires_at: Option<u64>,
) {
    let shop = $shop;
    let applies_to_listing = $applies_to_listing;
    let starts_at = $starts_at;
    let expires_at = $expires_at;

    assert_schedule!(starts_at, expires_at);
    assert_listing_belongs_to_shop_if_some!(shop, applies_to_listing);
}

macro fun assert_template_in_time_window($template: &DiscountTemplate, $now_secs: u64) {
    let template = $template;
    let now_secs = $now_secs;
    assert!(template.starts_at() <= now_secs, ETemplateTooEarly);

    template.expires_at().do_ref!(|expires_at| {
        assert!(now_secs < *expires_at, ETemplateExpired);
    });
}

macro fun assert_template_updatable($template: &DiscountTemplate, $now: u64) {
    let template = $template;
    let now = $now;
    assert!(template.redemptions() == 0, ETemplateFinalized);
    assert!(!template.finished(now), ETemplateFinalized);
}

macro fun assert_discount_redemption_allowed(
    $discount_template: &DiscountTemplate,
    $listing_id: ID,
    $now: u64,
) {
    let discount_template = $discount_template;
    let listing_id = $listing_id;
    let now = $now;
    assert!(discount_template.active(), ETemplateInactive);

    discount_template.applies_to_listing().do_ref!(|applies_to_listing| {
        assert!(*applies_to_listing == listing_id, EDiscountListingMismatch);
    });

    assert_template_in_time_window!(discount_template, now);
    assert!(!discount_template.redemption_cap_reached(), ETemplateMaxedOut);
}

macro fun assert_accepted_currency_inputs(
    $shop: &Shop,
    $coin_type: TypeName,
    $feed_id: vector<u8>,
    $pyth_object_id: ID,
    $price_info_object: &PriceInfoObject,
) {
    let shop = $shop;
    let coin_type = $coin_type;
    let feed_id = $feed_id;
    let pyth_object_id = $pyth_object_id;
    let price_info_object = $price_info_object;

    assert_currency_not_registered!(shop, coin_type);
    assert_valid_feed_id!(feed_id);
    assert_price_info_identity!(feed_id, pyth_object_id, price_info_object);
}

macro fun assert_valid_feed_id($feed_id: vector<u8>) {
    let feed_id = $feed_id;
    assert!(!feed_id.is_empty(), EEmptyFeedId);
    assert!(feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH, EInvalidFeedIdLength);
}

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

macro fun assert_currency_not_registered($shop: &Shop, $coin_type: TypeName) {
    let shop = $shop;
    let coin_type = $coin_type;
    assert!(!shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyExists);
}

macro fun assert_supported_decimals($decimals: u8) {
    let decimals = $decimals;
    assert!(decimals as u64 <= MAX_DECIMAL_POWER, EUnsupportedCurrencyDecimals);
}

macro fun assert_price_info_matches_currency(
    $accepted_currency: &AcceptedCurrency,
    $price_info_object: &PriceInfoObject,
) {
    let accepted_currency = $accepted_currency;
    let price_info_object = $price_info_object;
    assert_price_info_identity!(
        accepted_currency.feed_id(),
        accepted_currency.pyth_object_id(),
        price_info_object,
    );
}

macro fun assert_template_belongs_to_shop($shop: &Shop, $discount_template_id: ID) {
    let shop = $shop;
    let discount_template_id = $discount_template_id;
    assert_template_registered!(shop, discount_template_id);
}

macro fun assert_template_belongs_to_shop_if_some($shop: &Shop, $maybe_id: Option<ID>) {
    let shop = $shop;
    let maybe_id = $maybe_id;
    maybe_id.do_ref!(|id| {
        assert_template_belongs_to_shop!(shop, *id);
    });
}

macro fun assert_listing_belongs_to_shop($shop: &Shop, $listing_id: ID) {
    let shop = $shop;
    let listing_id = $listing_id;
    assert_listing_registered!(shop, listing_id);
}

macro fun assert_listing_belongs_to_shop_if_some($shop: &Shop, $maybe_id: Option<ID>) {
    let shop = $shop;
    let maybe_id = $maybe_id;
    maybe_id.do_ref!(|id| {
        assert_listing_belongs_to_shop!(shop, *id);
    });
}

macro fun assert_spotlight_template_matches_listing(
    $shop: &Shop,
    $listing_id: ID,
    $discount_template_id: Option<ID>,
) {
    let shop = $shop;
    let listing_id = $listing_id;
    let discount_template_id = $discount_template_id;
    discount_template_id.do_ref!(|template_id| {
        assert_template_belongs_to_shop!(shop, *template_id);
        let discount_template = shop.borrow_discount_template(*template_id);
        discount_template.applies_to_listing().do_ref!(|applies_to_listing| {
            assert!(*applies_to_listing == listing_id, ESpotlightTemplateListingMismatch);
        });
    });
}

// === View helpers ===

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
    let coin_type = currency_type<TCoin>();
    assert!(shop.accepted_currencies.contains(coin_type), EAcceptedCurrencyMissing);
    shop.accepted_currencies.borrow(coin_type)
}

/// Returns true if the accepted currency is registered under the shop.
public fun currency_exists(shop: &Shop, coin_type: TypeName): bool {
    shop.accepted_currencies.contains(coin_type)
}

/// Returns the discount template for `template_id`.
public fun template(shop: &Shop, template_id: ID): &DiscountTemplate {
    assert!(shop.discount_templates.contains(template_id), ETemplateNotFound);
    shop.discount_templates.borrow(template_id)
}

/// Returns true if the discount template is registered under the shop.
public fun template_exists(shop: &Shop, template_id: ID): bool {
    shop.discount_templates.contains(template_id)
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
    let coin_type = currency_type<TCoin>();
    let accepted_currency = shop.borrow_registered_accepted_currency(coin_type);
    assert_price_info_matches_currency!(accepted_currency, price_info_object);
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

/// Returns `shop_id` from the provided value.
public fun shop_id(shop: &Shop): ID {
    shop.id.to_inner()
}

/// Returns `shop_owner` from the provided value.
public fun shop_owner(shop: &Shop): address {
    shop.owner
}

/// Returns `shop_name` from the provided value.
public fun shop_name(shop: &Shop): String {
    shop.name
}

/// Returns `shop_disabled` from the provided value.
public fun shop_disabled(shop: &Shop): bool {
    shop.disabled
}

/// Returns `shop_owner_cap_id` from the provided value.
public fun shop_owner_cap_id(owner_cap: &ShopOwnerCap): ID {
    owner_cap.id.to_inner()
}

/// Returns `shop_owner_cap_shop_id` from the provided value.
public fun shop_owner_cap_shop_id(owner_cap: &ShopOwnerCap): ID {
    owner_cap.shop_id
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
    let shop = new_shop(b"Shop".to_string(), owner, ctx);
    let owner_cap = ShopOwnerCap {
        id: object::new(ctx),
        shop_id: shop.id.to_inner(),
    };
    (shop, owner_cap)
}
