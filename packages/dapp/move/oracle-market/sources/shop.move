module sui_oracle_market::shop;

use pyth::i64;
use pyth::price;
use pyth::price_feed;
use pyth::price_identifier;
use pyth::price_info;
use pyth::pyth;
use std::string::{Self, String};
use std::type_name::{Self, TypeName};
use std::u128;
use sui::clock;
use sui::coin;
use sui::coin_registry;
use sui::dynamic_field;
use sui::event;
use sui::package;

// === Concepts used in this module (what/why/how) ===
// - Shared objects (Shop, ItemListing, AcceptedCurrency, DiscountTemplate): shared objects are
//   globally addressable. Anyone can include them as inputs and read them, and any transaction
//   that mutates them goes through consensus. What "can mutate" really means is "can submit a
//   tx that tries" -- the module still enforces its own authorization checks. Sharding state across
//   many shared objects means each PTB only locks the listing/currency/template it needs, instead
//   of contending on one monolithic map. They are created with object::new and shared via
//   transfer::share_object.
//   Docs: docs/07-shop-capabilities.md, docs/08-listings-receipts.md, docs/09-currencies-oracles.md,
//   docs/10-discounts-tickets.md, docs/16-object-ownership.md
// - Owned objects (ShopOwnerCap, DiscountTicket, ShopItem): ownership enforces authority or user
//   assets. Passing an owned object by value is a single-use guarantee. Docs: docs/07-shop-capabilities.md,
//   docs/08-listings-receipts.md, docs/10-discounts-tickets.md, docs/16-object-ownership.md
// - Capability-based auth (ShopOwnerCap): admin entry points require the capability object, not
//   ctx.sender() checks. This replaces Solidity modifiers. Docs: docs/07-shop-capabilities.md
// - Dynamic fields (markers + per-claimer claims): keyed child storage stored under the Shop or
//   DiscountTemplate. Lookups by key are cheap, but dynamic fields are not enumerable on-chain,
//   so discovery still relies on indexing/off-chain queries. This keeps parent objects small and
//   limits contention to the touched child. See dynamic_field::add/exists/remove/borrow. Docs:
//   docs/08-listings-receipts.md, docs/10-discounts-tickets.md
// - Type tags and TypeName: item and coin types are recorded as TypeName for runtime checks,
//   events, and UI metadata; compile-time correctness still comes from generics (ShopItem<TItem>,
//   Coin<T>) and explicit comparisons when needed. Docs: docs/08-listings-receipts.md,
//   docs/09-currencies-oracles.md
// - Phantom types: ShopItem<phantom TItem> records the item type in the type system without storing
//   the value. Docs: docs/08-listings-receipts.md
// - Abilities (key, store, copy, drop): on Sui, `key` means "this is an object" and the first field
//   must be `id: UID` (the object ID). `store` allows values to be stored in objects, while `copy`
//   and `drop` control value semantics. These drive ownership rules. Docs: docs/02-mental-model-shift.md,
//   docs/16-object-ownership.md
// - Option types: Option makes optional IDs and optional limits/expiry explicit instead of
//   sentinel values. Docs: docs/08-listings-receipts.md, docs/10-discounts-tickets.md
// - Entry vs public functions: PTBs can call `entry` and `public`, while other Move modules can only call
//   `public`. Prefer `public` for composable helpers and `entry` for PTB-only calls.
// - Events: event::emit writes typed events for indexers and UIs. Docs: docs/08-advanced.md,
//   docs/18-data-access.md
// - TxContext and sender: TxContext is required for object creation and coin splits; ctx.sender()
//   identifies the signer for access control and receipts. Docs: docs/14-advanced.md
// - Object IDs and addresses: on Sui, object IDs are addresses (but not every address is an object ID).
//   object::UID holds that ID,
//   and object::uid_to_address / object::id_from_address convert between UID and address for
//   indexing and event payloads. Docs: docs/14-advanced.md
// - Transfers and sharing: transfer::public_transfer moves owned objects; transfer::share_object makes shared
//   objects. Docs: docs/07-shop-capabilities.md, docs/14-advanced.md
// - Coins and coin registry: Coin<T> is a resource, coin_registry::Currency<T> supplies metadata.
//   coin::split and coin::destroy_zero manage payment/change. Docs: docs/05-currencies-oracles.md,
//   docs/09-currencies-oracles.md, docs/17-ptb-gas.md
// - Clock and time: clock::Clock is a shared, read-only object with a consensus-set timestamp_ms.
//   It can only be read via immutable reference in entry functions. This module converts it to
//   seconds for discount windows and oracle freshness; it is not a wall-clock guarantee. Docs:
//   docs/09-currencies-oracles.md, docs/10-discounts-tickets.md
// - Oracle objects (Pyth): price feeds are objects (PriceInfoObject) validated by feed_id and object
//   ID; guardrails enforce freshness and confidence. Docs: docs/09-currencies-oracles.md
// - Fixed-point math: prices are stored in USD cents, discounts in basis points, and pow10 tables
//   are used for scaling. Docs: docs/14-advanced.md
// - Enums: DiscountRule, DiscountRuleKind, ReferenceKind model variant logic explicitly. Docs: docs/10-discounts-tickets.md
// - Test-only APIs: #[test_only] functions expose helpers for Move tests without shipping them to
//   production calls. Docs: docs/15-testing.md

// === Errors ===
#[error]
const EInvalidOwnerCap: vector<u8> = b"invalid owner capability";
#[error]
const EEmptyItemName: vector<u8> = b"empty item name";
#[error]
const EInvalidPrice: vector<u8> = b"invalid price";
#[error]
const EZeroStock: vector<u8> = b"zero stock";
#[error]
const ETemplateWindow: vector<u8> = b"invalid template window";
#[error]
const ETemplateShopMismatch: vector<u8> = b"template shop mismatch";
#[error]
const EListingShopMismatch: vector<u8> = b"listing shop mismatch";
#[error]
const EInvalidRuleKind: vector<u8> = b"invalid rule kind";
#[error]
const EInvalidRuleValue: vector<u8> = b"invalid rule value";
#[error]
const EAcceptedCurrencyExists: vector<u8> = b"accepted currency exists";
#[error]
const EAcceptedCurrencyMissing: vector<u8> = b"accepted currency missing";
#[error]
const EEmptyFeedId: vector<u8> = b"empty feed id";
#[error]
const EInvalidFeedIdLength: vector<u8> = b"invalid feed id length";
#[error]
const ETemplateInactive: vector<u8> = b"template inactive";
#[error]
const ETemplateTooEarly: vector<u8> = b"template too early";
#[error]
const ETemplateExpired: vector<u8> = b"template expired";
#[error]
const ETemplateMaxedOut: vector<u8> = b"template maxed out";
#[error]
const EDiscountAlreadyClaimed: vector<u8> = b"discount already claimed";
#[error]
const EOutOfStock: vector<u8> = b"out of stock";
#[error]
const EInvalidPaymentCoinType: vector<u8> = b"invalid payment coin type";
#[error]
const EPythObjectMismatch: vector<u8> = b"pyth object mismatch";
#[error]
const EFeedIdentifierMismatch: vector<u8> = b"feed identifier mismatch";
#[error]
const EPriceNonPositive: vector<u8> = b"price non-positive";
#[error]
const EPriceOverflow: vector<u8> = b"price overflow";
#[error]
const EInsufficientPayment: vector<u8> = b"insufficient payment";
#[error]
const EDiscountTicketMismatch: vector<u8> = b"discount ticket mismatch";
#[error]
const EDiscountTicketOwnerMismatch: vector<u8> = b"discount ticket owner mismatch";
#[error]
const EDiscountTicketListingMismatch: vector<u8> = b"discount ticket listing mismatch";
#[error]
const EDiscountTicketShopMismatch: vector<u8> = b"discount ticket shop mismatch";
#[error]
const ECurrencyListingMismatch: vector<u8> = b"currency listing mismatch";
#[error]
const EDiscountShopMismatch: vector<u8> = b"discount shop mismatch";
#[error]
const EConfidenceIntervalTooWide: vector<u8> = b"confidence interval too wide";
#[error]
const EConfidenceExceedsPrice: vector<u8> = b"confidence exceeds price";
#[error]
const ESpotlightTemplateListingMismatch: vector<u8> = b"spotlight template listing mismatch";
#[error]
const EDiscountClaimsNotPrunable: vector<u8> = b"discount claims not prunable";
#[error]
const EInvalidGuardrailCap: vector<u8> = b"invalid guardrail cap";
#[error]
const ETemplateFinalized: vector<u8> = b"template finalized";
#[error]
const EPriceStatusNotTrading: vector<u8> = b"price status not trading";
#[error]
const EItemTypeMismatch: vector<u8> = b"item type mismatch";
#[error]
const EUnsupportedCurrencyDecimals: vector<u8> = b"unsupported currency decimals";
#[error]
const EEmptyShopName: vector<u8> = b"empty shop name";
#[error]
const EShopDisabled: vector<u8> = b"shop disabled";
#[error]
const EPriceTooStale: vector<u8> = b"price too stale";

const CENTS_PER_DOLLAR: u64 = 100;
const BASIS_POINT_DENOMINATOR: u64 = 10_000;
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;
const MAX_PRICE_AGE_SECS_CAP: u64 = DEFAULT_MAX_PRICE_AGE_SECS;
const MAX_DECIMAL_POWER: u64 = 38;
const DEFAULT_MAX_CONFIDENCE_RATIO_BPS: u64 = 1_000; // Reject price feeds with sigma/mu above 10%.
const MAX_CONFIDENCE_RATIO_BPS_CAP: u64 = DEFAULT_MAX_CONFIDENCE_RATIO_BPS;
const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;
const DEFAULT_MAX_PRICE_STATUS_LAG_SECS: u64 = 5; // Allow small attestation/publish skew without halting checkout.
const MAX_PRICE_STATUS_LAG_SECS_CAP: u64 = DEFAULT_MAX_PRICE_STATUS_LAG_SECS;
// Powers of 10 from 10^0 through 10^38 for scaling Pyth prices and coin decimals.
const POW10_U128: vector<u128> = vector[
    1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000,
    10_000_000_000, 100_000_000_000, 1_000_000_000_000, 10_000_000_000_000, 100_000_000_000_000,
    1_000_000_000_000_000, 10_000_000_000_000_000, 100_000_000_000_000_000,
    1_000_000_000_000_000_000, 10_000_000_000_000_000_000, 100_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000_000_000_000_000,
];

/// Claims and returns the module's Publisher object during publish.
public struct SHOP has drop {}

fun init(publisher_witness: SHOP, ctx: &mut TxContext) {
    package::claim_and_keep<SHOP>(publisher_witness, ctx);
}

// === Capability & Core ===

/// Capability that proves the caller can administer a specific `Shop`.
/// Holding and using this object is the Sui-native equivalent of matching `onlyOwner` criteria in Solidity.
public struct ShopOwnerCap has key, store {
    id: UID,
    shop_address: address,
    owner: address, // Cached payout address updated by update_shop_owner; may drift if the cap is transferred.
}

/// Shared shop that stores item listings to sell, accepted currencies, and discount templates via dynamic fields.
public struct Shop has key, store {
    id: UID,
    owner: address, // Payout recipient for sales.
    name: String,
    disabled: bool,
}

/// Item listing metadata keyed under the shared `Shop`, used to mint specific items on purchase.
/// Discounts can be attached to highlight promotions in the UI.
public struct ItemListing has key, store {
    id: UID,
    shop_address: address,
    item_type: TypeName,
    name: String,
    base_price_usd_cents: u64, // Stored in USD cents to avoid floating point math.
    stock: u64,
    spotlight_discount_template_id: Option<ID>,
}

/// Dynamic field key for item listing markers stored under a shop.
public struct ItemListingKey(ID) has copy, drop, store;

/// Marker stored under the shop to record listing membership.
public struct ItemListingMarker has copy, drop, store {
    listing_id: ID,
}

/// Shop item type for receipts. `TItem` is enforced at mint time so downstream
/// Move code can depend on the type system instead of opaque metadata alone.
public struct ShopItem<phantom TItem> has key, store {
    id: UID,
    shop_address: address,
    item_listing_address: address,
    item_type: TypeName,
    name: String,
    acquired_at: u64,
}

/// Defines which external coins the shop is able to price/accept.
public struct AcceptedCurrency has key, store {
    id: UID,
    shop_address: address,
    coin_type: TypeName,
    feed_id: vector<u8>, // Pyth price feed identifier (32 bytes).
    pyth_object_id: ID, // ID of Pyth PriceInfoObject
    decimals: u8,
    symbol: vector<u8>,
    max_price_age_secs_cap: u64,
    max_confidence_ratio_bps_cap: u64,
    max_price_status_lag_secs_cap: u64,
}

/// Dynamic field key for accepted currency markers stored under a shop.
public struct AcceptedCurrencyKey(ID) has copy, drop, store;

/// Dynamic field key for mapping a coin type to its accepted currency object.
public struct AcceptedCurrencyTypeKey(TypeName) has copy, drop, store;

/// Marker stored under the shop to record accepted currency membership.
public struct AcceptedCurrencyMarker has copy, drop, store {
    accepted_currency_id: ID,
    coin_type: TypeName,
}

/// Discount rules mirror the spec: fixed (USD cents) or percentage basis points off.
public enum DiscountRule has copy, drop, store {
    Fixed { amount_cents: u64 },
    Percent { bps: u16 },
}

/// Local representation for the rule kind that callers encode as a primitive.
public enum DiscountRuleKind has copy, drop {
    Fixed,
    Percent,
}

/// Coupon template for creating discounts tracked under the shop.
public struct DiscountTemplate has key, store {
    id: UID,
    shop_address: address,
    applies_to_listing: Option<ID>,
    rule: DiscountRule,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    claims_issued: u64,
    redemptions: u64,
    active: bool,
}

/// Dynamic field key for discount template markers stored under a shop.
public struct DiscountTemplateKey(ID) has copy, drop, store;

/// Marker stored under the shop to record template membership.
public struct DiscountTemplateMarker has copy, drop, store {
    template_id: ID,
    applies_to_listing: Option<ID>,
}

/// Discount ticket that future buyers will redeem during purchase flow.
/// Tickets are owned objects. They can be transferred, but redemption enforces the original claimer
/// so "transferable" does not mean "redeemable."
public struct DiscountTicket has key, store {
    id: UID,
    discount_template_id: address,
    shop_address: address,
    listing_id: Option<ID>,
    claimer: address,
}

/// Dynamic field key for recorded discount claims stored under a template.
public struct DiscountClaimKey(address) has copy, drop, store;

/// Tracks which addresses already claimed a discount from a template.
public struct DiscountClaim has key, store {
    id: UID,
    claimer: address,
}

// === Event Definitions ===
/// Event emitted when a shop is created.
public struct ShopCreatedEvent has copy, drop {
    shop_address: address,
    owner: address,
    name: String,
    shop_owner_cap_id: address,
}

/// Event emitted when a shop owner is updated.
public struct ShopOwnerUpdatedEvent has copy, drop {
    shop_address: address,
    previous_owner: address,
    new_owner: address,
    shop_owner_cap_id: address,
    rotated_by: address,
}

/// Event emitted when a shop is disabled.
public struct ShopDisabledEvent has copy, drop {
    shop_address: address,
    owner: address,
    shop_owner_cap_id: address,
    disabled_by: address,
}

/// Event emitted when an item listing is added.
public struct ItemListingAddedEvent has copy, drop {
    shop_address: address,
    item_listing_address: address,
    name: String,
    base_price_usd_cents: u64,
    spotlight_discount_template_id: Option<address>,
    stock: u64,
}

/// Event emitted when listing stock is updated.
public struct ItemListingStockUpdatedEvent has copy, drop {
    shop_address: address,
    item_listing_address: address,
    new_stock: u64,
}

/// Event emitted when an item listing is removed.
public struct ItemListingRemovedEvent has copy, drop {
    shop_address: address,
    item_listing_address: address,
}

/// Event emitted when a discount template is created.
public struct DiscountTemplateCreatedEvent has copy, drop {
    shop_address: address,
    discount_template_id: address,
    rule: DiscountRule,
}

/// Event emitted when a discount template is updated.
public struct DiscountTemplateUpdatedEvent has copy, drop {
    shop_address: address,
    discount_template_id: address,
}

/// Event emitted when a discount template is toggled.
public struct DiscountTemplateToggledEvent has copy, drop {
    shop_address: address,
    discount_template_id: address,
    active: bool,
}

/// Event emitted when an accepted coin is added.
public struct AcceptedCoinAddedEvent has copy, drop {
    shop_address: address,
    coin_type: TypeName,
    feed_id: vector<u8>,
    pyth_object_id: ID,
    decimals: u8,
}

/// Event emitted when an accepted coin is removed.
public struct AcceptedCoinRemovedEvent has copy, drop {
    shop_address: address,
    coin_type: TypeName,
}

/// Event emitted when a discount ticket is claimed.
public struct DiscountClaimedEvent has copy, drop {
    shop_address: address,
    discount_template_id: address,
    claimer: address,
    discount_id: address,
}

/// Event emitted when a discount ticket is redeemed.
public struct DiscountRedeemedEvent has copy, drop {
    shop_address: address,
    discount_template_id: address,
    discount_id: address,
    listing_id: address,
    buyer: address,
}

/// Event emitted when a purchase completes.
public struct PurchaseCompletedEvent has copy, drop {
    shop_address: address,
    item_listing_address: address,
    buyer: address,
    mint_to: address,
    coin_type: TypeName,
    amount_paid: u64,
    discount_template_id: Option<address>,
    accepted_currency_id: address,
    feed_id: vector<u8>,
    base_price_usd_cents: u64,
    discounted_price_usd_cents: u64,
    quote_amount: u64,
}

/// Event emitted when minting completes.
public struct MintingCompletedEvent has copy, drop {
    shop_address: address,
    item_listing_address: address,
    buyer: address,
    minted_item_id: address,
    mint_to: address,
    refund_to: address,
    change_amount: u64,
    coin_type: TypeName,
}

// === Entry Point Methods ===

// === Shop ===

/// Create a new shop and its owner capability.
///
/// Any address can spin up a shop and receive the corresponding owner capability.
/// Sui mindset:
/// - Capability > `msg.sender`: ownership lives in a first-class `ShopOwnerCap`. Entry functions
///   require the cap, so authority follows the object holder rather than whichever address signs
///   the PTB. Solidity relies on `msg.sender` and modifiers; here, capabilities are explicit inputs.
/// - Shared object composition: the shop is shared, and listings/templates/currencies are shared
///   siblings indexed by lightweight markers under the shop (plus a coin-type index for currencies).
///   State is sharded into per-object locks so PTBs only touch the listing/template/currency they
///   mutate instead of contending on a monolithic storage map as in Solidity.
entry fun create_shop(name: String, ctx: &mut TxContext) {
    let owner: address = ctx.sender();
    let shop: Shop = new_shop(name, owner, ctx);

    let owner_cap: ShopOwnerCap = ShopOwnerCap {
        id: object::new(ctx),
        shop_address: shop_address(&shop),
        owner,
    };

    event::emit(ShopCreatedEvent {
        shop_address: shop_address(&shop),
        owner,
        name: shop.name,
        shop_owner_cap_id: object::uid_to_address(&owner_cap.id),
    });

    transfer::share_object(shop);
    transfer::public_transfer(owner_cap, owner);
}

/// Disable a shop permanently (buyer flows will reject new checkouts).
entry fun disable_shop(shop: &mut Shop, owner_cap: &ShopOwnerCap, ctx: &TxContext) {
    assert_owner_cap!(shop, owner_cap);
    shop.disabled = true;

    event::emit(ShopDisabledEvent {
        shop_address: shop_address(shop),
        owner: shop.owner,
        shop_owner_cap_id: object::uid_to_address(&owner_cap.id),
        disabled_by: ctx.sender(),
    });
}

/// Rotate the payout recipient for a shop.
///
/// Payouts should follow the current operator, not the address that originally created the shop.
/// Sui mindset:
/// - Access control is explicit: the operator must show the `ShopOwnerCap` rather than relying on
///   `ctx.sender()`. Rotating the cap keeps payouts aligned to the current operator.
/// - Buyers never handle capabilities--checkout remains permissionless against the shared `Shop`.
entry fun update_shop_owner(
    shop: &mut Shop,
    owner_cap: &mut ShopOwnerCap,
    new_owner: address,
    ctx: &TxContext,
) {
    assert_owner_cap!(shop, owner_cap);

    let previous_owner: address = shop.owner;
    shop.owner = new_owner;
    owner_cap.owner = new_owner;

    event::emit(ShopOwnerUpdatedEvent {
        shop_address: shop_address(shop),
        previous_owner,
        new_owner,
        shop_owner_cap_id: object::uid_to_address(&owner_cap.id),
        rotated_by: ctx.sender(),
    });
}

// === Item Listing ===

/// Add an `ItemListing` attached to the `Shop`. The generic `T` encodes what will eventually be
/// minted when a buyer completes checkout. Prices are provided in USD cents (e.g. $12.50 -> 1_250)
/// to avoid floating point math.
///
/// Sui mindset:
/// - Capability-first auth replaces Solidity modifiers: the operator must present `ShopOwnerCap`
///   minted during `create_shop`; `ctx.sender()` alone is never trusted. Losing the cap means losing
///   control--much like losing a private key--but without implicit global ownership variables.
/// - Listings are shared objects registered via a lightweight marker under the shared `Shop`.
///   Admin flows edit the listing object directly while the marker keeps membership checks cheap
///   and localized, avoiding a monolithic storage map like Solidity.
/// - The type parameter `T` captures what will be minted, keeping item receipt types explicit
///   (phantom-typed `ShopItem<T>`) rather than relying on ad-hoc metadata blobs common in EVM NFTs.
fun add_item_listing_core<T: store>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_template_id: Option<object::ID>,
    ctx: &mut TxContext,
): (ItemListing, object::ID, address) {
    assert_owner_cap!(shop, owner_cap);
    validate_listing_inputs!(
        shop,
        &name,
        base_price_usd_cents,
        stock,
        &spotlight_discount_template_id,
    );

    let shop_address: address = shop_address(shop);
    let (listing, listing_address) = new_item_listing<T>(
        shop_address,
        name,
        base_price_usd_cents,
        stock,
        spotlight_discount_template_id,
        ctx,
    );
    let listing_id: object::ID = object::id_from_address(listing_address);

    assert_spotlight_template_matches_listing!(
        shop,
        listing_id,
        &listing.spotlight_discount_template_id,
    );

    event::emit(ItemListingAddedEvent {
        shop_address,
        item_listing_address: listing_address,
        name: listing.name,
        base_price_usd_cents: listing.base_price_usd_cents,
        spotlight_discount_template_id: map_id_option_to_address(
            &listing.spotlight_discount_template_id,
        ),
        stock,
    });

    // Marker entries act like a membership index: the Shop stays slim while each listing mutates
    // independently, keeping shared-object contention low.
    add_listing_marker(shop, listing_id);
    (listing, listing_id, listing_address)
}

#[allow(lint(share_owned))]
entry fun add_item_listing<T: store>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_template_id: Option<object::ID>,
    ctx: &mut TxContext,
) {
    let (listing, _listing_id, _listing_address) = add_item_listing_core<T>(
        shop,
        owner_cap,
        name,
        base_price_usd_cents,
        stock,
        spotlight_discount_template_id,
        ctx,
    );
    transfer::share_object(listing);
}

/// Update the inventory count for a listing (0 inventory to pause selling).
entry fun update_item_listing_stock(
    shop: &Shop,
    owner_cap: &ShopOwnerCap,
    item_listing: &mut ItemListing,
    new_stock: u64,
    _ctx: &TxContext,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_listing_matches_shop!(shop, item_listing);

    item_listing.stock = new_stock;

    event::emit(ItemListingStockUpdatedEvent {
        shop_address: item_listing.shop_address,
        item_listing_address: object::uid_to_address(&item_listing.id),
        new_stock,
    });
}

/// Remove an item listing entirely.
///
/// This delists by removing the marker under the shop; the shared `ItemListing` remains addressable
/// for history while checkout paths refuse unregistered listings. This keeps contention scoped to
/// the marker without destroying the listing object.
entry fun remove_item_listing(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    item_listing: &ItemListing,
    _ctx: &TxContext,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_listing_matches_shop!(shop, item_listing);
    let item_listing_id = listing_id(item_listing);
    let _marker: ItemListingMarker = dynamic_field::remove(
        &mut shop.id,
        ItemListingKey(item_listing_id),
    );

    event::emit(ItemListingRemovedEvent {
        shop_address: shop_address(shop),
        item_listing_address: object::uid_to_address(&item_listing.id),
    });
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
/// - Each accepted currency is its own shared object; the Shop keeps a marker plus a
///   `coin_type -> ID` dynamic-field index for discovery. Creating or removing currencies mutates
///   the Shop (marker/index), while checkout only needs the specific `AcceptedCurrency` object and
///   listing.
/// - Callers supply the on-chain `PriceInfoObject` (fetched via RPC); the module re-validates feed
///   bytes and the Pyth object ID to defend against spoofed inputs. This reduces reliance on
///   off-chain metadata, but the caller still must provide the correct on-chain object.
/// - Sellers can optionally tighten oracle guardrails per currency (`max_price_age_secs_cap`,
///   `max_confidence_ratio_bps_cap`, `max_price_status_lag_secs_cap`). Buyers may only tighten
///   `max_price_age_secs`/`max_confidence_ratio_bps` further--never loosen--mirroring "slippage limits"
///   but enforced with object caps instead of unbounded calldata.
entry fun add_accepted_currency<T>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    currency: &coin_registry::Currency<T>,
    price_info_object: &price_info::PriceInfoObject,
    feed_id: vector<u8>,
    pyth_object_id: object::ID,
    max_price_age_secs_cap: Option<u64>,
    max_confidence_ratio_bps_cap: Option<u64>,
    max_price_status_lag_secs_cap: Option<u64>,
    ctx: &mut TxContext,
) {
    assert_owner_cap!(shop, owner_cap);

    let coin_type = currency_type<T>();

    // Bind this currency to a specific PriceInfoObject to prevent oracle feed spoofing.
    validate_accepted_currency_inputs!(
        shop,
        &coin_type,
        &feed_id,
        &pyth_object_id,
        price_info_object,
    );

    let decimals: u8 = coin_registry::decimals(currency);
    assert_supported_decimals!(decimals);
    let symbol: vector<u8> = string::into_bytes(coin_registry::symbol(currency));
    let shop_address: address = shop_address(shop);
    let age_cap: u64 = resolve_guardrail_cap(
        &max_price_age_secs_cap,
        MAX_PRICE_AGE_SECS_CAP,
    );
    let confidence_cap = resolve_guardrail_cap(
        &max_confidence_ratio_bps_cap,
        MAX_CONFIDENCE_RATIO_BPS_CAP,
    );
    let status_lag_cap = resolve_guardrail_cap(
        &max_price_status_lag_secs_cap,
        MAX_PRICE_STATUS_LAG_SECS_CAP,
    );

    let (accepted_currency, accepted_currency_address) = new_accepted_currency(
        shop_address,
        coin_type,
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
        age_cap,
        confidence_cap,
        status_lag_cap,
        ctx,
    );

    let accepted_currency_id = object::id_from_address(accepted_currency_address);
    add_currency_marker(shop, accepted_currency_id, coin_type);
    dynamic_field::add(
        &mut shop.id,
        AcceptedCurrencyTypeKey(coin_type),
        accepted_currency_id,
    );

    transfer::share_object(accepted_currency);

    event::emit(AcceptedCoinAddedEvent {
        shop_address,
        coin_type,
        feed_id,
        pyth_object_id,
        decimals,
    })
}

/// Deregister an accepted coin type and clean up its lookup index.
entry fun remove_accepted_currency(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    accepted_currency: &AcceptedCurrency,
    _ctx: &TxContext,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_currency_matches_shop!(shop, accepted_currency);
    let accepted_currency_id = accepted_currency_id(accepted_currency);
    let mapped_id_opt = accepted_currency_id_for_type(
        shop,
        accepted_currency.coin_type,
    );
    if (option::is_some(&mapped_id_opt)) {
        assert!(*option::borrow(&mapped_id_opt) == accepted_currency_id, EAcceptedCurrencyMissing);
    };
    remove_currency_field(shop, accepted_currency.coin_type);
    if (
        dynamic_field::exists_with_type<AcceptedCurrencyKey, AcceptedCurrencyMarker>(
            &shop.id,
            AcceptedCurrencyKey(accepted_currency_id),
        )
    ) {
        let _marker: AcceptedCurrencyMarker = dynamic_field::remove(
            &mut shop.id,
            AcceptedCurrencyKey(accepted_currency_id),
        );
    };

    event::emit(AcceptedCoinRemovedEvent {
        shop_address: accepted_currency.shop_address,
        coin_type: accepted_currency.coin_type,
    });
}

// === Discount ===

fun create_discount_template_core(
    shop: &mut Shop,
    applies_to_listing: Option<object::ID>,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    ctx: &mut TxContext,
): (DiscountTemplate, object::ID, DiscountRule, address) {
    validate_discount_template_inputs!(
        shop,
        &applies_to_listing,
        starts_at,
        &expires_at,
    );

    let discount_rule_kind: DiscountRuleKind = parse_rule_kind(rule_kind);
    let discount_rule: DiscountRule = build_discount_rule(
        discount_rule_kind,
        rule_value,
    );
    let shop_address: address = shop_address(shop);
    let (discount_template, discount_template_address) = new_discount_template(
        shop_address,
        applies_to_listing,
        discount_rule,
        starts_at,
        expires_at,
        max_redemptions,
        ctx,
    );

    let discount_template_id = object::id_from_address(discount_template_address);
    add_template_marker(shop, discount_template_id, applies_to_listing);
    (discount_template, discount_template_id, discount_rule, discount_template_address)
}

/// Create a discount template anchored under the shop.
///
/// Templates are shared configuration objects indexed by a marker under the shop; admin entry
/// points enforce `ShopOwnerCap` checks when creating/updating/toggling templates, and they remain
/// addressable by `object::ID` for UIs. Claims remain dynamic
/// fields under each template to enforce one-claim-per-address. Callers send primitive args
/// (`rule_kind` of `0 = fixed` or `1 = percent`), but we immediately convert them into the strongly
/// typed `DiscountRule` before persisting. For `Fixed` rules the `rule_value` is denominated in USD
/// cents to match listing prices.
/// Sui mindset:
/// - Discounts live as objects attached to the shared shop instead of rows in contract storage,
///   making them easy to compose or read without privileged endpoints. Each template can be fetched
///   by object ID rather than an index into a Solidity mapping.
/// - Converting user-friendly primitives into enums early avoids magic numbers and preserves type
///   safety. In EVM you might store raw ints and rely on comments; here the `DiscountRule` enum
///   forces exhaustive matching.
/// - Time windows and limits are stored on-chain and later checked against the shared `Clock`
///   (timestamp_ms -> seconds). On Sui, time is an explicit input object; on EVM, `block.timestamp`
///   is global state available to view/read-only calls but can drift within protocol bounds.
#[allow(lint(share_owned))]
entry fun create_discount_template(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    applies_to_listing: Option<object::ID>,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    ctx: &mut TxContext,
) {
    assert_owner_cap!(shop, owner_cap);
    let (
        discount_template,
        _discount_template_id,
        discount_rule,
        discount_template_address,
    ) = create_discount_template_core(
        shop,
        applies_to_listing,
        rule_kind,
        rule_value,
        starts_at,
        expires_at,
        max_redemptions,
        ctx,
    );
    transfer::share_object(discount_template);

    let shop_address: address = shop_address(shop);
    event::emit(DiscountTemplateCreatedEvent {
        shop_address,
        discount_template_id: discount_template_address,
        rule: discount_rule,
    });
}

/// Update mutable fields on a template (schedule, rule, limits).
/// For `Fixed` discounts the `rule_value` remains in USD cents.
/// Updates are only allowed before any tickets are issued or redeemed and before the template is
/// finished (expired or capped), so claim accounting cannot be retroactively changed.
entry fun update_discount_template(
    shop: &Shop,
    owner_cap: &ShopOwnerCap,
    discount_template: &mut DiscountTemplate,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    clock: &clock::Clock,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_template_matches_shop!(shop, discount_template);
    assert_schedule!(starts_at, &expires_at);

    let discount_rule_kind: DiscountRuleKind = parse_rule_kind(rule_kind);
    let discount_rule: DiscountRule = build_discount_rule(
        discount_rule_kind,
        rule_value,
    );
    let now: u64 = now_secs(clock);
    assert_template_updatable!(discount_template, now);

    apply_discount_template_updates(
        discount_template,
        discount_rule,
        starts_at,
        expires_at,
        max_redemptions,
    );

    event::emit(DiscountTemplateUpdatedEvent {
        shop_address: discount_template.shop_address,
        discount_template_id: template_address(discount_template),
    });
}

/// Quickly enable/disable a coupon without deleting it.
entry fun toggle_discount_template(
    shop: &Shop,
    owner_cap: &ShopOwnerCap,
    discount_template: &mut DiscountTemplate,
    active: bool,
    _ctx: &TxContext,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_template_matches_shop!(shop, discount_template);

    discount_template.active = active;

    event::emit(DiscountTemplateToggledEvent {
        shop_address: discount_template.shop_address,
        discount_template_id: template_address(discount_template),
        active,
    });
}

/// Surface a template alongside a listing so UIs can highlight the promotion.
entry fun attach_template_to_listing(
    shop: &Shop,
    owner_cap: &ShopOwnerCap,
    item_listing: &mut ItemListing,
    discount_template: &DiscountTemplate,
    _ctx: &TxContext,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_template_matches_shop!(shop, discount_template);
    assert_listing_matches_shop!(shop, item_listing);
    assert_spotlight_template_matches_listing!(
        shop,
        listing_id(item_listing),
        &option::some(template_id(discount_template)),
    );

    item_listing.spotlight_discount_template_id = option::some(template_id(discount_template));
}

/// Remove the promotion banner from a listing.
entry fun clear_template_from_listing(
    shop: &Shop,
    owner_cap: &ShopOwnerCap,
    item_listing: &mut ItemListing,
    _ctx: &TxContext,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_listing_matches_shop!(shop, item_listing);

    item_listing.spotlight_discount_template_id = option::none();
}

/// Mint a single-use discount ticket to the caller using the template schedule and limits.
///
/// Sui mindset:
/// - Discount tickets are owned objects rather than balances in contract storage, so callers can
///   compose claim + checkout. Use `claim_and_buy_item_with_discount` to mint and spend in one
///   transaction, or call this entry to mint a ticket that the wallet can redeem later.
/// - Per-wallet claim limits are enforced by writing a child object (keyed by the claimer's
///   address) under the template via dynamic fields. Each claim still increments counters on the
///   template, so claims for the same template contend on that shared object, but they do not need
///   to mutate the Shop.
/// - Time windows are checked against the shared `Clock` (seconds) to avoid surprises when epochs
///   are long-lived; passing the clock keeps the function pure from a caller perspective.
/// - Claims mutate only the template and its claim marker; the Shop is a read-only input. This
///   keeps shop-level contention out of the claim flow, even though claims for a single template
///   still serialize.
/// - Tickets are transferable as objects, but redemption is bound to the original claimer. If a
///   ticket is moved to another address, it cannot be redeemed by the recipient. In EVM you might
///   airdrop ERC-1155 coupons; here the object identity plus `ctx.sender()` check guarantee
///   single-claimer semantics without extra storage.
entry fun claim_discount_ticket(
    shop: &Shop,
    discount_template: &mut DiscountTemplate,
    clock: &clock::Clock,
    ctx: &mut TxContext,
): () {
    assert_shop_active!(shop);
    assert_template_matches_shop!(shop, discount_template);

    let now_secs: u64 = now_secs(clock);
    let (discount_ticket, claimer) = claim_discount_ticket_with_event(
        discount_template,
        now_secs,
        ctx,
    );

    transfer::public_transfer(discount_ticket, claimer);
}

/// Non-entry helper that returns the owned ticket so callers can inline claim + buy in one PTB.
/// Intended to be composed inside future `buy_item` logic or higher-level scripts.
/// The claimer is always bound to `ctx.sender()` to prevent third parties from minting on behalf of
/// other addresses and exhausting template quotas.
public fun claim_discount_ticket_inline(
    discount_template: &mut DiscountTemplate,
    now_secs: u64,
    ctx: &mut TxContext,
): DiscountTicket {
    let claimer = ctx.sender();
    assert_template_claimable!(discount_template, claimer, now_secs);

    let discount_ticket: DiscountTicket = new_discount_ticket(
        discount_template,
        claimer,
        ctx,
    );
    record_discount_claim(discount_template, claimer, ctx);
    discount_ticket
}

fun claim_discount_ticket_with_event(
    discount_template: &mut DiscountTemplate,
    now_secs: u64,
    ctx: &mut TxContext,
): (DiscountTicket, address) {
    let discount_ticket = claim_discount_ticket_inline(
        discount_template,
        now_secs,
        ctx,
    );
    let claimer = ctx.sender();

    event::emit(DiscountClaimedEvent {
        shop_address: discount_template.shop_address,
        discount_template_id: template_address(discount_template),
        claimer,
        discount_id: object::uid_to_address(&discount_ticket.id),
    });

    (discount_ticket, claimer)
}

/// Remove recorded claim markers for a template that is no longer serving new tickets.
/// Pruning is only allowed once the template is irrevocably finished (expired or maxed out)
/// so that a pause cannot be used to bypass the one-claim-per-address guarantee.
entry fun prune_discount_claims(
    shop: &Shop,
    owner_cap: &ShopOwnerCap,
    discount_template: &mut DiscountTemplate,
    claimers: vector<address>,
    clock: &clock::Clock,
) {
    assert_owner_cap!(shop, owner_cap);
    assert_template_matches_shop!(shop, discount_template);
    let now_secs = now_secs(clock);
    assert_template_prunable!(discount_template, now_secs);
    prune_claim_markers(discount_template, claimers);
}

// === Checkout ===

/// Execute a purchase priced in USD cents but settled with any previously registered `AcceptedCurrency`.
///
/// Sui mindset:
/// - There is no global ERC-20 allowance; the buyer passes an owned `Coin<T>`, the function splits
///   exactly what is needed, and refunds change in the same PTB.
/// - The `Shop` is a read-only input; only the listing mutates (stock decrements), so contention is
///   scoped to that listing and other listing/currency objects are unaffected by the write.
/// - Buyers pass explicit `mint_to` and `refund_extra_to` targets so PTBs can gift receipts or route
///   change without extra hops--common for custody or marketplace flows.
/// - Oracles are first-class objects. Callers supply a refreshed `PriceInfoObject`, and on-chain
///   logic verifies identity/freshness against the shared `Clock` and feed metadata.
/// - Guardrails (`max_price_age_secs`, `max_confidence_ratio_bps`) are caller-tunable only to
///   tighten them; overrides are capped at seller-set per-currency limits and `none` uses those caps.
/// - Compared to EVM: no `approve/transferFrom` race windows, no reliance on global stateful
///   oracles, and refunds happen in-line without reentrancy hooks because coin transfers are moves
///   of owned resources, not external calls.
entry fun buy_item<TItem: store, TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    price_info_object: &price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
    ctx: &mut TxContext,
) {
    assert_shop_active!(shop);
    assert_listing_matches_shop!(shop, item_listing);
    let base_price_usd_cents: u64 = item_listing.base_price_usd_cents;
    // Payment is a Coin<T> object; process_purchase splits the payment and returns change.
    let (owed_coin_opt, change_coin, minted_item) = process_purchase<TItem, TCoin>(
        shop,
        item_listing,
        accepted_currency,
        price_info_object,
        payment,
        mint_to,
        refund_extra_to,
        base_price_usd_cents,
        option::none(),
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );
    if (option::is_some(&owed_coin_opt)) {
        let owed_coin = option::destroy_some(owed_coin_opt);
        transfer::public_transfer(owed_coin, shop.owner);
    } else {
        option::destroy_none(owed_coin_opt);
    };
    if (change_coin.value() == 0) {
        change_coin.destroy_zero();
    } else {
        transfer::public_transfer(change_coin, refund_extra_to);
    };
    transfer::public_transfer(minted_item, mint_to);
}

/// Same as `buy_item` but also validates and burns a `DiscountTicket`.
///
/// Sui mindset:
/// - Promotions are owned objects (`DiscountTicket`). Burning here enforces single-use on-chain
///   without external allowlists or signatures.
/// - The discount template is a shared object anyone can read; this function validates the
///   template/listing/shop linkage and increments redemptions to keep limits accurate.
/// - Refund destination is explicitly provided (`refund_extra_to`) so "gift" flows can return change
///   to the payer or recipient.
/// - Oracle guardrails remain caller-tunable; pass `none` to use defaults.
/// - In EVM you might check a Merkle root or signature each time; here the coupon object plus
///   dynamic-field counters provide the proof and rate-limiting without bespoke off-chain infra.
entry fun buy_item_with_discount<TItem: store, TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    discount_template: &mut DiscountTemplate,
    discount_ticket: DiscountTicket,
    price_info_object: &price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
    ctx: &mut TxContext,
) {
    assert_shop_active!(shop);
    let buyer = ctx.sender();
    assert_template_matches_shop!(shop, discount_template);
    assert_listing_matches_shop!(shop, item_listing);
    let now = now_secs(clock);
    assert_discount_redemption_allowed!(discount_template, item_listing, now);
    assert_ticket_matches_context!(
        &discount_ticket,
        discount_template,
        item_listing,
        buyer,
    );

    let discounted_price_usd_cents = apply_discount(
        item_listing.base_price_usd_cents,
        &discount_template.rule,
    );
    let discount_template_id = option::some(template_address(discount_template));
    let ticket_id = object::uid_to_address(&discount_ticket.id);
    discount_template.redemptions = discount_template.redemptions + 1;

    let (owed_coin_opt, change_coin, minted_item) = process_purchase<TItem, TCoin>(
        shop,
        item_listing,
        accepted_currency,
        price_info_object,
        payment,
        mint_to,
        refund_extra_to,
        discounted_price_usd_cents,
        discount_template_id,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );
    if (option::is_some(&owed_coin_opt)) {
        let owed_coin = option::destroy_some(owed_coin_opt);
        transfer::public_transfer(owed_coin, shop.owner);
    } else {
        option::destroy_none(owed_coin_opt);
    };
    if (change_coin.value() == 0) {
        change_coin.destroy_zero();
    } else {
        transfer::public_transfer(change_coin, refund_extra_to);
    };
    transfer::public_transfer(minted_item, mint_to);

    event::emit(DiscountRedeemedEvent {
        shop_address: item_listing.shop_address,
        discount_template_id: template_address(discount_template),
        discount_id: ticket_id,
        listing_id: object::uid_to_address(&item_listing.id),
        buyer,
    });

    burn_discount_ticket(discount_ticket);
}

/// Claim a discount ticket for the sender and immediately redeem it during checkout within the
/// same PTB.
///
/// Sui mindset:
/// - Reduces front-end friction: callers do not need to manage a temporary `DiscountTicket`
///   transfer between separate transactions or commands.
/// - Emits the same `DiscountClaimedEvent` + `DiscountRedeemedEvent` events as the two-step flow so downstream
///   analytics remain consistent.
/// - The ticket is created and consumed inside one PTB, minimizing custody risk while still using
///   the template's dynamic fields to enforce one-claim-per-address.
/// - This pattern highlights Sui's composability: objects can be created, used, and destroyed in a
///   single PTB without extra approvals or intermediate transactions--something Solidity flows often
///   approximate with meta-transactions or batching routers.
entry fun claim_and_buy_item_with_discount<TItem: store, TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    discount_template: &mut DiscountTemplate,
    price_info_object: &price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
    ctx: &mut TxContext,
) {
    assert_shop_active!(shop);
    assert_template_matches_shop!(shop, discount_template);
    assert_listing_matches_shop!(shop, item_listing);
    let now_secs = now_secs(clock);
    let (discount_ticket, _claimer) = claim_discount_ticket_with_event(
        discount_template,
        now_secs,
        ctx,
    );

    buy_item_with_discount<TItem, TCoin>(
        shop,
        item_listing,
        accepted_currency,
        discount_template,
        discount_ticket,
        price_info_object,
        payment,
        mint_to,
        refund_extra_to,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );
}

// === Data ===

fun new_shop(name: String, owner: address, ctx: &mut TxContext): Shop {
    validate_shop_name!(&name);
    Shop {
        id: object::new(ctx),
        owner,
        name,
        disabled: false,
    }
}

fun new_accepted_currency(
    shop_address: address,
    coin_type: TypeName,
    feed_id: vector<u8>,
    pyth_object_id: object::ID,
    decimals: u8,
    symbol: vector<u8>,
    max_price_age_secs_cap: u64,
    max_confidence_ratio_bps_cap: u64,
    max_price_status_lag_secs_cap: u64,
    ctx: &mut TxContext,
): (AcceptedCurrency, address) {
    assert_supported_decimals!(decimals);

    let accepted_currency: AcceptedCurrency = AcceptedCurrency {
        id: object::new(ctx),
        shop_address,
        coin_type,
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
        max_price_age_secs_cap,
        max_confidence_ratio_bps_cap,
        max_price_status_lag_secs_cap,
    };
    let accepted_currency_address: address = object::uid_to_address(
        &accepted_currency.id,
    );

    (accepted_currency, accepted_currency_address)
}

fun new_item_listing<T: store>(
    shop_address: address,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_template_id: Option<object::ID>,
    ctx: &mut TxContext,
): (ItemListing, address) {
    let listing: ItemListing = ItemListing {
        id: object::new(ctx),
        shop_address,
        item_type: type_name::with_defining_ids<T>(),
        name,
        base_price_usd_cents,
        stock,
        spotlight_discount_template_id,
    };
    let listing_address: address = object::uid_to_address(&listing.id);

    (listing, listing_address)
}

fun new_discount_template(
    shop_address: address,
    applies_to_listing: Option<object::ID>,
    rule: DiscountRule,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    ctx: &mut TxContext,
): (DiscountTemplate, address) {
    let discount_template: DiscountTemplate = DiscountTemplate {
        id: object::new(ctx),
        shop_address,
        applies_to_listing,
        rule,
        starts_at,
        expires_at,
        max_redemptions,
        claims_issued: 0,
        redemptions: 0,
        active: true,
    };

    let discount_template_address: address = object::uid_to_address(
        &discount_template.id,
    );
    (discount_template, discount_template_address)
}

fun new_discount_ticket(
    template: &DiscountTemplate,
    claimer: address,
    ctx: &mut TxContext,
): DiscountTicket {
    DiscountTicket {
        id: object::new(ctx),
        discount_template_id: template_address(template),
        shop_address: template.shop_address,
        listing_id: template.applies_to_listing,
        claimer,
    }
}

fun record_discount_claim(template: &mut DiscountTemplate, claimer: address, ctx: &mut TxContext) {
    // Track issued tickets; actual uses are counted at redemption time.
    template.claims_issued = template.claims_issued + 1;

    dynamic_field::add(
        &mut template.id,
        DiscountClaimKey(claimer),
        DiscountClaim {
            id: object::new(ctx),
            claimer,
        },
    );
}

fun remove_discount_claim_if_exists(template: &mut DiscountTemplate, claimer: address) {
    if (
        dynamic_field::exists_with_type<DiscountClaimKey, DiscountClaim>(
            &template.id,
            DiscountClaimKey(claimer),
        )
    ) {
        let DiscountClaim { id, .. } = dynamic_field::remove(
            &mut template.id,
            DiscountClaimKey(claimer),
        );
        id.delete();
    };
}

fun prune_claim_markers(template: &mut DiscountTemplate, claimers: vector<address>) {
    claimers.destroy!(|claimer| remove_discount_claim_if_exists(template, claimer));
}

fun apply_discount_template_updates(
    discount_template: &mut DiscountTemplate,
    discount_rule: DiscountRule,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
) {
    discount_template.rule = discount_rule;
    discount_template.starts_at = starts_at;
    discount_template.expires_at = expires_at;
    discount_template.max_redemptions = max_redemptions;
}

fun remove_currency_field(shop: &mut Shop, coin_type: TypeName) {
    dynamic_field::remove_if_exists<AcceptedCurrencyTypeKey, object::ID>(
        &mut shop.id,
        AcceptedCurrencyTypeKey(coin_type),
    );
}

fun currency_type<T>(): TypeName {
    type_name::with_defining_ids<T>()
}

fun assert_listing_type_matches<TItem: store>(item_listing: &ItemListing) {
    let expected = type_name::with_defining_ids<TItem>();
    assert!(item_listing.item_type == expected, EItemTypeMismatch);
}

// === Helpers ===

fun shop_address(shop: &Shop): address {
    object::uid_to_address(&shop.id)
}

fun listing_id(listing: &ItemListing): object::ID {
    object::id_from_address(object::uid_to_address(&listing.id))
}

fun accepted_currency_id(accepted_currency: &AcceptedCurrency): object::ID {
    object::id_from_address(object::uid_to_address(&accepted_currency.id))
}

fun template_id(template: &DiscountTemplate): object::ID {
    object::id_from_address(template_address(template))
}

fun add_listing_marker(shop: &mut Shop, listing_id: object::ID) {
    dynamic_field::add(
        &mut shop.id,
        ItemListingKey(listing_id),
        ItemListingMarker {
            listing_id,
        },
    );
}

fun add_template_marker(
    shop: &mut Shop,
    template_id: object::ID,
    applies_to_listing: Option<object::ID>,
) {
    dynamic_field::add(
        &mut shop.id,
        DiscountTemplateKey(template_id),
        DiscountTemplateMarker {
            template_id,
            applies_to_listing,
        },
    );
}

fun add_currency_marker(shop: &mut Shop, accepted_currency_id: object::ID, coin_type: TypeName) {
    dynamic_field::add(
        &mut shop.id,
        AcceptedCurrencyKey(accepted_currency_id),
        AcceptedCurrencyMarker {
            accepted_currency_id,
            coin_type,
        },
    );
}

macro fun assert_template_registered($shop: &Shop, $template_id: object::ID) {
    let shop = $shop;
    let template_id = $template_id;
    assert!(
        dynamic_field::exists_with_type<DiscountTemplateKey, DiscountTemplateMarker>(
            &shop.id,
            DiscountTemplateKey(template_id),
        ),
        ETemplateShopMismatch,
    );
}

macro fun assert_currency_registered($shop: &Shop, $accepted_currency_id: object::ID) {
    let shop = $shop;
    let accepted_currency_id = $accepted_currency_id;
    assert!(
        dynamic_field::exists_with_type<AcceptedCurrencyKey, AcceptedCurrencyMarker>(
            &shop.id,
            AcceptedCurrencyKey(accepted_currency_id),
        ),
        EAcceptedCurrencyMissing,
    );
}

macro fun assert_listing_registered($shop: &Shop, $listing_id: object::ID) {
    let shop = $shop;
    let listing_id = $listing_id;
    assert!(
        dynamic_field::exists_with_type<ItemListingKey, ItemListingMarker>(
            &shop.id,
            ItemListingKey(listing_id),
        ),
        EListingShopMismatch,
    );
}

macro fun assert_template_matches_shop($shop: &Shop, $template: &DiscountTemplate) {
    let shop = $shop;
    let template = $template;
    assert_template_registered!(shop, template_id(template));
    assert!(template.shop_address == shop_address(shop), ETemplateShopMismatch);
}

macro fun assert_currency_matches_shop($shop: &Shop, $accepted_currency: &AcceptedCurrency) {
    let shop = $shop;
    let accepted_currency = $accepted_currency;
    assert_currency_registered!(shop, accepted_currency_id(accepted_currency));
    assert!(accepted_currency.shop_address == shop_address(shop), EAcceptedCurrencyMissing);
}

macro fun assert_listing_matches_shop($shop: &Shop, $listing: &ItemListing) {
    let shop = $shop;
    let listing = $listing;
    assert_listing_registered!(shop, listing_id(listing));
    assert!(listing.shop_address == shop_address(shop), EListingShopMismatch);
}

fun unwrap_or_default(value: &Option<u64>, default_value: u64): u64 {
    if (option::is_some(value)) {
        *option::borrow(value)
    } else {
        default_value
    }
}

/// Normalize a seller-provided guardrail cap, enforcing module-level ceilings and non-zero.
fun resolve_guardrail_cap(proposed_cap: &Option<u64>, module_cap: u64): u64 {
    let value = unwrap_or_default(proposed_cap, module_cap);
    assert!(value > 0, EInvalidGuardrailCap);
    clamp_max(value, module_cap)
}

/// Clamp a caller-provided override so oracle guardrails cannot be loosened.
fun clamp_max(value: u64, cap: u64): u64 {
    if (value <= cap) {
        value
    } else {
        cap
    }
}

/// Resolve caller overrides against seller caps so pricing guardrails stay tight.
fun resolve_effective_guardrails(
    max_price_age_secs: &Option<u64>,
    max_confidence_ratio_bps: &Option<u64>,
    accepted_currency: &AcceptedCurrency,
): (u64, u64) {
    let requested_max_age = unwrap_or_default(
        max_price_age_secs,
        accepted_currency.max_price_age_secs_cap,
    );
    let requested_confidence_ratio = unwrap_or_default(
        max_confidence_ratio_bps,
        accepted_currency.max_confidence_ratio_bps_cap,
    );
    let effective_max_age = clamp_max(
        requested_max_age,
        accepted_currency.max_price_age_secs_cap,
    );
    let effective_confidence_ratio = clamp_max(
        requested_confidence_ratio,
        accepted_currency.max_confidence_ratio_bps_cap,
    );
    (effective_max_age, effective_confidence_ratio)
}

/// Ensure checkout uses the currency object stored under the shop, not a forged caller value.
fun borrow_registered_accepted_currency(
    shop: &Shop,
    accepted_currency: &AcceptedCurrency,
): &AcceptedCurrency {
    assert_currency_matches_shop!(shop, accepted_currency);
    accepted_currency
}

fun quote_amount_with_guardrails(
    accepted_currency: &AcceptedCurrency,
    price_info_object: &price_info::PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: &Option<u64>,
    max_confidence_ratio_bps: &Option<u64>,
    clock: &clock::Clock,
): u64 {
    let (effective_max_age, effective_confidence_ratio) = resolve_effective_guardrails(
        max_price_age_secs,
        max_confidence_ratio_bps,
        accepted_currency,
    );
    let price_info = price_info::get_price_info_from_price_info_object(
        price_info_object,
    );
    let publish_time = price::get_timestamp(
        &price_feed::get_price(price_info::get_price_feed(&price_info)),
    );
    let now = now_secs(clock);
    assert!(now >= publish_time, EPriceTooStale);
    assert!(now - publish_time <= effective_max_age, EPriceTooStale);
    let price: price::Price = pyth::get_price_no_older_than(
        price_info_object,
        clock,
        effective_max_age,
    );
    quote_amount_from_usd_cents(
        price_usd_cents,
        accepted_currency.decimals,
        &price,
        effective_confidence_ratio,
    )
}

fun process_purchase<TItem: store, TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    price_info_object: &price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    discounted_price_usd_cents: u64,
    discount_template_id: Option<address>,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
    ctx: &mut TxContext,
): (Option<coin::Coin<TCoin>>, coin::Coin<TCoin>, ShopItem<TItem>) {
    assert_listing_type_matches<TItem>(item_listing);
    let accepted_currency = borrow_registered_accepted_currency(
        shop,
        accepted_currency,
    );

    assert_listing_currency_match!(shop, item_listing, accepted_currency);
    process_purchase_core<TItem, TCoin>(
        item_listing,
        accepted_currency,
        price_info_object,
        payment,
        shop_address(shop),
        mint_to,
        refund_extra_to,
        discounted_price_usd_cents,
        discount_template_id,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    )
}

fun process_purchase_core<TItem: store, TCoin>(
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    price_info_object: &price_info::PriceInfoObject,
    mut payment: coin::Coin<TCoin>,
    shop_address: address,
    mint_to: address,
    refund_extra_to: address,
    discounted_price_usd_cents: u64,
    discount_template_id: Option<address>,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
    ctx: &mut TxContext,
): (Option<coin::Coin<TCoin>>, coin::Coin<TCoin>, ShopItem<TItem>) {
    ensure_price_info_matches_currency!(accepted_currency, price_info_object);
    assert_price_status_trading!(
        price_info_object,
        accepted_currency.max_price_status_lag_secs_cap,
    );
    assert_payment_coin_type!<TCoin>(accepted_currency);
    assert_stock_available!(item_listing);
    let quote_amount: u64 = quote_amount_with_guardrails(
        accepted_currency,
        price_info_object,
        discounted_price_usd_cents,
        &max_price_age_secs,
        &max_confidence_ratio_bps,
        clock,
    );

    let owed_coin_opt = split_payment(&mut payment, quote_amount, ctx);

    let buyer: address = ctx.sender();
    let change_amount = payment.value();

    decrement_stock(item_listing);

    event::emit(PurchaseCompletedEvent {
        shop_address,
        item_listing_address: object::uid_to_address(&item_listing.id),
        buyer,
        mint_to,
        coin_type: accepted_currency.coin_type,
        amount_paid: quote_amount,
        discount_template_id,
        accepted_currency_id: object::uid_to_address(&accepted_currency.id),
        feed_id: accepted_currency.feed_id,
        base_price_usd_cents: item_listing.base_price_usd_cents,
        discounted_price_usd_cents,
        quote_amount,
    });

    event::emit(ItemListingStockUpdatedEvent {
        shop_address,
        item_listing_address: object::uid_to_address(&item_listing.id),
        new_stock: item_listing.stock,
    });

    let minted_item = mint_shop_item<TItem>(item_listing, clock, ctx);
    let minted_item_id = object::uid_to_address(&minted_item.id);

    event::emit(MintingCompletedEvent {
        shop_address,
        item_listing_address: object::uid_to_address(&item_listing.id),
        buyer,
        minted_item_id,
        mint_to,
        refund_to: refund_extra_to,
        change_amount,
        coin_type: accepted_currency.coin_type,
    });
    (owed_coin_opt, payment, minted_item)
}

fun parse_rule_kind(raw_kind: u8): DiscountRuleKind {
    if (raw_kind == 0) {
        DiscountRuleKind::Fixed
    } else {
        assert!(raw_kind == 1, EInvalidRuleKind);
        DiscountRuleKind::Percent
    }
}

fun build_discount_rule(rule_kind: DiscountRuleKind, rule_value: u64): DiscountRule {
    match (rule_kind) {
        DiscountRuleKind::Fixed => DiscountRule::Fixed { amount_cents: rule_value },
        DiscountRuleKind::Percent => {
            assert!(rule_value <= 10_000, EInvalidRuleValue);
            DiscountRule::Percent { bps: rule_value as u16 }
        },
    }
}

fun map_id_option_to_address(source: &Option<object::ID>): Option<address> {
    if (option::is_some(source)) {
        option::some(object::id_to_address(option::borrow(source)))
    } else {
        option::none()
    }
}

fun template_address(template: &DiscountTemplate): address {
    object::uid_to_address(&template.id)
}

/// Pull consensus timestamp seconds from the shared clock to enforce time windows predictably.
fun now_secs(clock: &clock::Clock): u64 {
    clock::timestamp_ms(clock) / 1000
}

fun quote_amount_from_usd_cents(
    usd_cents: u64,
    coin_decimals: u8,
    price: &price::Price,
    max_confidence_ratio_bps: u64,
): u64 {
    let price_value = price::get_price(price);
    let mantissa = positive_price_to_u128(&price_value);
    let confidence = as_u128_from_u64(price::get_conf(price));
    let exponent = price::get_expo(price);
    let exponent_is_negative = i64::get_is_negative(&exponent);
    let exponent_magnitude = if (exponent_is_negative) {
        i64::get_magnitude_if_negative(&exponent)
    } else {
        i64::get_magnitude_if_positive(&exponent)
    };
    let conservative_mantissa = conservative_price_mantissa(
        mantissa,
        confidence,
        max_confidence_ratio_bps,
    );

    let coin_decimals_pow10 = pow10_u128(as_u64_from_u8(coin_decimals));
    let exponent_pow10 = pow10_u128(exponent_magnitude);

    let mut numerator = as_u128_from_u64(usd_cents);
    numerator = checked_mul_u128(numerator, coin_decimals_pow10);

    if (exponent_is_negative) {
        numerator = checked_mul_u128(numerator, exponent_pow10);
    };

    let mut denominator = checked_mul_u128(
        conservative_mantissa,
        as_u128_from_u64(CENTS_PER_DOLLAR),
    );
    if (!exponent_is_negative) {
        denominator = checked_mul_u128(denominator, exponent_pow10);
    };

    let amount = ceil_div_u128(numerator, denominator);
    let maybe_amount = u128::try_as_u64(amount);
    maybe_amount.destroy_or!(abort EPriceOverflow)
}

fun pow10_u128(exponent: u64): u128 {
    assert!(exponent <= MAX_DECIMAL_POWER, EPriceOverflow);
    let pow10_table = POW10_U128;
    pow10_table[exponent]
}

/// Multiplication with an explicit overflow guard so we can surface `EPriceOverflow` instead of a generic abort.
fun checked_mul_u128(lhs: u128, rhs: u128): u128 {
    if (lhs == 0 || rhs == 0) {
        0
    } else {
        assert!(lhs <= u128::max_value!() / rhs, EPriceOverflow);
        lhs * rhs
    }
}

fun ceil_div_u128(numerator: u128, denominator: u128): u128 {
    assert!(denominator != 0, EPriceOverflow);
    u128::divide_and_round_up(numerator, denominator)
}

fun positive_price_to_u128(value: &i64::I64): u128 {
    assert!(!i64::get_is_negative(value), EPriceNonPositive);
    as_u128_from_u64(i64::get_magnitude_if_positive(value))
}

/// Apply mu-sigma per Pyth best practices to avoid undercharging when prices are uncertain.
fun conservative_price_mantissa(
    mantissa: u128,
    confidence: u128,
    max_confidence_ratio_bps: u64,
): u128 {
    assert!(mantissa > confidence, EConfidenceExceedsPrice);
    let scaled_confidence = confidence * as_u128_from_u64(BASIS_POINT_DENOMINATOR);
    let max_allowed = mantissa * as_u128_from_u64(max_confidence_ratio_bps);
    assert!(scaled_confidence <= max_allowed, EConfidenceIntervalTooWide);
    mantissa - confidence
}

fun split_payment<TCoin>(
    payment: &mut coin::Coin<TCoin>,
    amount_due: u64,
    ctx: &mut TxContext,
): Option<coin::Coin<TCoin>> {
    if (amount_due == 0) {
        return option::none()
    };

    let available = payment.value();
    assert!(available >= amount_due, EInsufficientPayment);
    let owed = payment.split(amount_due, ctx);
    option::some(owed)
}

fun decrement_stock(item_listing: &mut ItemListing) {
    item_listing.stock = item_listing.stock - 1;
}

fun mint_shop_item<TItem: store>(
    item_listing: &ItemListing,
    clock: &clock::Clock,
    ctx: &mut TxContext,
): ShopItem<TItem> {
    assert_listing_type_matches<TItem>(item_listing);

    ShopItem {
        id: object::new(ctx),
        shop_address: item_listing.shop_address,
        item_listing_address: object::uid_to_address(&item_listing.id),
        item_type: item_listing.item_type,
        name: item_listing.name,
        acquired_at: now_secs(clock),
    }
}

fun apply_discount(base_price_usd_cents: u64, rule: &DiscountRule): u64 {
    match (rule) {
        DiscountRule::Fixed { amount_cents } => {
            if (*amount_cents >= base_price_usd_cents) {
                0
            } else {
                base_price_usd_cents - *amount_cents
            }
        },
        DiscountRule::Percent { bps } => {
            let remaining_bps = BASIS_POINT_DENOMINATOR - as_u64_from_u16(*bps);
            let product = as_u128_from_u64(base_price_usd_cents) * as_u128_from_u64(remaining_bps);
            let discounted = ceil_div_u128(
                product,
                as_u128_from_u64(BASIS_POINT_DENOMINATOR),
            );
            let maybe_discounted = u128::try_as_u64(discounted);
            maybe_discounted.destroy_or!(abort EPriceOverflow)
        },
    }
}

fun burn_discount_ticket(discount_ticket: DiscountTicket) {
    let DiscountTicket { id, .. } = discount_ticket;
    id.delete();
}

fun bytes_equal(left: &vector<u8>, right: &vector<u8>): bool {
    if (left.length() != right.length()) {
        return false
    };
    let mut matches = true;
    let mut i: u64 = 0;
    left.do_ref!(|value| {
        if (matches) {
            if (*value != right[i]) {
                matches = false;
            };
        };
        i = i + 1;
    });
    matches
}

fun as_u64_from_u8(value: u8): u64 {
    value as u64
}

fun as_u64_from_u16(value: u16): u64 {
    value as u64
}

fun as_u128_from_u64(value: u64): u128 {
    value as u128
}

// === Asserts and validations ===

macro fun assert_owner_cap($shop: &Shop, $owner_cap: &ShopOwnerCap) {
    let shop = $shop;
    let owner_cap = $owner_cap;
    assert!(owner_cap.shop_address == object::uid_to_address(&shop.id), EInvalidOwnerCap);
}

macro fun assert_shop_active($shop: &Shop) {
    let shop = $shop;
    assert!(!shop.disabled, EShopDisabled);
}

macro fun assert_non_zero_stock($stock: u64) {
    let stock = $stock;
    assert!(stock > 0, EZeroStock)
}

macro fun assert_stock_available($item_listing: &ItemListing) {
    let item_listing = $item_listing;
    assert!(item_listing.stock > 0, EOutOfStock);
}

macro fun assert_schedule($starts_at: u64, $expires_at: &Option<u64>) {
    let starts_at = $starts_at;
    let expires_at = $expires_at;
    if (option::is_some(expires_at)) {
        assert!(*option::borrow(expires_at) > starts_at, ETemplateWindow);
    }
}

macro fun validate_listing_inputs(
    $shop: &Shop,
    $name: &String,
    $base_price_usd_cents: u64,
    $stock: u64,
    $spotlight_discount_template_id: &Option<object::ID>,
) {
    let shop = $shop;
    let name = $name;
    let base_price_usd_cents = $base_price_usd_cents;
    let stock = $stock;
    let spotlight_discount_template_id = $spotlight_discount_template_id;

    assert_non_zero_stock!(stock);
    assert!(!string::as_bytes(name).is_empty(), EEmptyItemName);
    assert!(base_price_usd_cents > 0, EInvalidPrice);

    assert_belongs_to_shop_if_some!(
        shop,
        ReferenceKind::Template,
        spotlight_discount_template_id,
    );
}

macro fun validate_shop_name($name: &String) {
    let name = $name;
    assert!(!string::as_bytes(name).is_empty(), EEmptyShopName);
}

macro fun validate_discount_template_inputs(
    $shop: &Shop,
    $applies_to_listing: &Option<object::ID>,
    $starts_at: u64,
    $expires_at: &Option<u64>,
) {
    let shop = $shop;
    let applies_to_listing = $applies_to_listing;
    let starts_at = $starts_at;
    let expires_at = $expires_at;

    assert_schedule!(starts_at, expires_at);
    assert_belongs_to_shop_if_some!(
        shop,
        ReferenceKind::Listing,
        applies_to_listing,
    );
}

macro fun assert_template_in_time_window($template: &DiscountTemplate, $now_secs: u64) {
    let template = $template;
    let now_secs = $now_secs;
    assert!(template.starts_at <= now_secs, ETemplateTooEarly);

    if (option::is_some(&template.expires_at)) {
        assert!(now_secs < *option::borrow(&template.expires_at), ETemplateExpired);
    };
}

fun redemption_cap_reached(template: &DiscountTemplate): bool {
    if (option::is_some(&template.max_redemptions)) {
        let max_redemptions = *option::borrow(&template.max_redemptions);
        (max_redemptions > 0) && (template.redemptions >= max_redemptions)
    } else {
        false
    }
}

fun template_finished(template: &DiscountTemplate, now: u64): bool {
    let expired =
        option::is_some(&template.expires_at)
        && now >= *option::borrow(&template.expires_at);
    let maxed_out = redemption_cap_reached(template);
    expired || maxed_out
}

macro fun assert_template_prunable($template: &DiscountTemplate, $now: u64) {
    let template = $template;
    let now = $now;
    assert!(template_finished(template, now), EDiscountClaimsNotPrunable);
}

macro fun assert_template_updatable($template: &DiscountTemplate, $now: u64) {
    let template = $template;
    let now = $now;
    assert!(template.claims_issued == 0, ETemplateFinalized);
    assert!(template.redemptions == 0, ETemplateFinalized);
    assert!(!template_finished(template, now), ETemplateFinalized);
}

macro fun assert_discount_redemption_allowed(
    $discount_template: &DiscountTemplate,
    $item_listing: &ItemListing,
    $now: u64,
) {
    let discount_template = $discount_template;
    let item_listing = $item_listing;
    let now = $now;
    assert!(discount_template.active, ETemplateInactive);
    assert!(discount_template.shop_address == item_listing.shop_address, EDiscountShopMismatch);
    let applies_to = map_id_option_to_address(
        &discount_template.applies_to_listing,
    );
    if (option::is_some(&applies_to)) {
        assert!(
            *option::borrow(&applies_to) == object::uid_to_address(&item_listing.id),
            EDiscountTicketListingMismatch,
        );
    };
    assert_template_in_time_window!(discount_template, now);
    assert!(discount_template.claims_issued > discount_template.redemptions, ETemplateMaxedOut);
    assert!(!redemption_cap_reached(discount_template), ETemplateMaxedOut);
}

macro fun assert_ticket_matches_context(
    $discount_ticket: &DiscountTicket,
    $discount_template: &DiscountTemplate,
    $item_listing: &ItemListing,
    $buyer: address,
) {
    let discount_ticket = $discount_ticket;
    let discount_template = $discount_template;
    let item_listing = $item_listing;
    let buyer = $buyer;
    assert!(discount_ticket.shop_address == item_listing.shop_address, EDiscountTicketShopMismatch);
    assert!(
        discount_ticket.discount_template_id == template_address(discount_template),
        EDiscountTicketMismatch,
    );
    assert!(discount_ticket.claimer == buyer, EDiscountTicketOwnerMismatch);
    let applies_to_listing = map_id_option_to_address(
        &discount_ticket.listing_id,
    );
    if (option::is_some(&applies_to_listing)) {
        assert!(
            *option::borrow(&applies_to_listing) == object::uid_to_address(&item_listing.id),
            EDiscountTicketListingMismatch,
        );
    };
}

macro fun validate_accepted_currency_inputs(
    $shop: &Shop,
    $coin_type: &TypeName,
    $feed_id: &vector<u8>,
    $pyth_object_id: &object::ID,
    $price_info_object: &price_info::PriceInfoObject,
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

macro fun assert_valid_feed_id($feed_id: &vector<u8>) {
    let feed_id = $feed_id;
    assert!(!feed_id.is_empty(), EEmptyFeedId);
    assert!(feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH, EInvalidFeedIdLength);
}

macro fun assert_price_info_identity(
    $expected_feed_id: &vector<u8>,
    $expected_pyth_object_id: &object::ID,
    $price_info_object: &price_info::PriceInfoObject,
) {
    let expected_feed_id = $expected_feed_id;
    let expected_pyth_object_id = $expected_pyth_object_id;
    let price_info_object = $price_info_object;
    let confirmed_price_object = price_info::uid_to_inner(price_info_object);
    assert!(confirmed_price_object == *expected_pyth_object_id, EPythObjectMismatch);

    let price_info = price_info::get_price_info_from_price_info_object(
        price_info_object,
    );
    let identifier = price_info::get_price_identifier(&price_info);
    let identifier_bytes = price_identifier::get_bytes(&identifier);
    assert!(bytes_equal(expected_feed_id, &identifier_bytes), EFeedIdentifierMismatch);
}

macro fun assert_currency_not_registered($shop: &Shop, $coin_type: &TypeName) {
    let shop = $shop;
    let coin_type = $coin_type;
    assert!(
        !dynamic_field::exists_<AcceptedCurrencyTypeKey>(
            &shop.id,
            AcceptedCurrencyTypeKey(*coin_type),
        ),
        EAcceptedCurrencyExists,
    );
}

macro fun assert_supported_decimals($decimals: u8) {
    let decimals = $decimals;
    assert!(as_u64_from_u8(decimals) <= MAX_DECIMAL_POWER, EUnsupportedCurrencyDecimals);
}

macro fun assert_listing_currency_match(
    $shop: &Shop,
    $item_listing: &ItemListing,
    $accepted_currency: &AcceptedCurrency,
) {
    let shop = $shop;
    let item_listing = $item_listing;
    let accepted_currency = $accepted_currency;
    assert!(item_listing.shop_address == shop_address(shop), EListingShopMismatch);
    assert!(item_listing.shop_address == accepted_currency.shop_address, ECurrencyListingMismatch);
}

macro fun ensure_price_info_matches_currency(
    $accepted_currency: &AcceptedCurrency,
    $price_info_object: &price_info::PriceInfoObject,
) {
    let accepted_currency = $accepted_currency;
    let price_info_object = $price_info_object;
    assert_price_info_identity!(
        &accepted_currency.feed_id,
        &accepted_currency.pyth_object_id,
        price_info_object,
    );
}

macro fun assert_price_status_trading(
    $price_info_object: &price_info::PriceInfoObject,
    $max_price_status_lag_secs: u64,
) {
    let price_info_object = $price_info_object;
    let max_price_status_lag_secs = $max_price_status_lag_secs;
    let price_info = price_info::get_price_info_from_price_info_object(
        price_info_object,
    );
    let attestation_time = price_info::get_attestation_time(&price_info);
    let publish_time = price::get_timestamp(
        &price_feed::get_price(price_info::get_price_feed(&price_info)),
    );
    // Treat feeds with stale attestations as unavailable even if Pyth doesn't expose an explicit status.
    assert!(attestation_time >= publish_time, EPriceStatusNotTrading);
    let attestation_lag_secs = attestation_time - publish_time;
    assert!(attestation_lag_secs <= max_price_status_lag_secs, EPriceStatusNotTrading);
}

macro fun assert_payment_coin_type<$TCoin>($accepted_currency: &AcceptedCurrency) {
    let accepted_currency = $accepted_currency;
    let payment_type = type_name::with_defining_ids<$TCoin>();
    assert!(accepted_currency.coin_type == payment_type, EInvalidPaymentCoinType);
}

macro fun assert_template_belongs_to_shop($shop: &Shop, $discount_template_id: object::ID) {
    let shop = $shop;
    let discount_template_id = $discount_template_id;
    assert_template_registered!(shop, discount_template_id);
}

macro fun assert_listing_belongs_to_shop($shop: &Shop, $listing_id: object::ID) {
    let shop = $shop;
    let listing_id = $listing_id;
    assert_listing_registered!(shop, listing_id);
}

/// Internal selector for which reference to validate.
public enum ReferenceKind has copy, drop {
    Template,
    Listing,
}

macro fun assert_belongs_to_shop_if_some(
    $shop: &Shop,
    $kind: ReferenceKind,
    $maybe_id: &Option<object::ID>,
) {
    let shop = $shop;
    let kind = $kind;
    let maybe_id = $maybe_id;
    if (option::is_some(maybe_id)) {
        let id = *option::borrow(maybe_id);
        match (kind) {
            ReferenceKind::Template => assert_template_belongs_to_shop!(shop, id),
            ReferenceKind::Listing => assert_listing_belongs_to_shop!(shop, id),
        };
    };
}

macro fun assert_spotlight_template_matches_listing(
    $shop: &Shop,
    $listing_id: object::ID,
    $discount_template_id: &Option<object::ID>,
) {
    let shop = $shop;
    let listing_id = $listing_id;
    let discount_template_id = $discount_template_id;
    if (option::is_some(discount_template_id)) {
        let listing_address = object::id_to_address(&listing_id);
        let template_id = *option::borrow(discount_template_id);
        assert_template_belongs_to_shop!(shop, template_id);
        let marker: &DiscountTemplateMarker = dynamic_field::borrow(
            &shop.id,
            DiscountTemplateKey(template_id),
        );
        let applies_to_listing = map_id_option_to_address(
            &marker.applies_to_listing,
        );
        if (option::is_some(&applies_to_listing)) {
            assert!(
                *option::borrow(&applies_to_listing) == listing_address,
                ESpotlightTemplateListingMismatch,
            );
        };
    };
}

/// Guardrails to keep claims inside schedule/limits and unique per address.
macro fun assert_template_claimable($template: &DiscountTemplate, $claimer: address, $now_secs: u64) {
    let template = $template;
    let claimer = $claimer;
    let now_secs = $now_secs;
    assert!(template.active, ETemplateInactive);
    assert_template_in_time_window!(template, now_secs);

    if (option::is_some(&template.max_redemptions)) {
        let max_redemptions = *option::borrow(&template.max_redemptions);
        assert!(template.claims_issued < max_redemptions, ETemplateMaxedOut);
        assert!(template.redemptions < max_redemptions, ETemplateMaxedOut);
    };

    assert!(
        !dynamic_field::exists_with_type<DiscountClaimKey, DiscountClaim>(
            &template.id,
            DiscountClaimKey(claimer),
        ),
        EDiscountAlreadyClaimed,
    );
}

// === View helpers ===

/// Returns true if the listing is registered under the shop.
public fun listing_exists(shop: &Shop, listing_id: object::ID): bool {
    dynamic_field::exists_with_type<ItemListingKey, ItemListingMarker>(
        &shop.id,
        ItemListingKey(listing_id),
    )
}

/// Returns true if the discount template is registered under the shop.
public fun discount_template_exists(shop: &Shop, template_id: object::ID): bool {
    dynamic_field::exists_with_type<DiscountTemplateKey, DiscountTemplateMarker>(
        &shop.id,
        DiscountTemplateKey(template_id),
    )
}

/// Returns true if the accepted currency is registered under the shop.
public fun accepted_currency_exists(shop: &Shop, accepted_currency_id: object::ID): bool {
    dynamic_field::exists_with_type<AcceptedCurrencyKey, AcceptedCurrencyMarker>(
        &shop.id,
        AcceptedCurrencyKey(accepted_currency_id),
    )
}

/// Returns the accepted currency ID for a coin type if registered.
public fun accepted_currency_id_for_type(shop: &Shop, coin_type: TypeName): Option<object::ID> {
    if (
        dynamic_field::exists_with_type<AcceptedCurrencyTypeKey, object::ID>(
            &shop.id,
            AcceptedCurrencyTypeKey(coin_type),
        )
    ) {
        option::some(
            *dynamic_field::borrow<AcceptedCurrencyTypeKey, object::ID>(
                &shop.id,
                AcceptedCurrencyTypeKey(coin_type),
            ),
        )
    } else {
        option::none()
    }
}

/// Returns the listing ID for a listing address if registered.
public fun listing_id_for_address(shop: &Shop, listing_address: address): Option<object::ID> {
    let listing_id = object::id_from_address(listing_address);
    if (listing_exists(shop, listing_id)) {
        option::some(listing_id)
    } else {
        option::none()
    }
}

/// Returns the template ID for a template address if registered.
public fun discount_template_id_for_address(
    shop: &Shop,
    template_address: address,
): Option<object::ID> {
    let template_id = object::id_from_address(template_address);
    if (discount_template_exists(shop, template_id)) {
        option::some(template_id)
    } else {
        option::none()
    }
}

/// Returns listing fields after validating shop membership.
public fun listing_values(
    shop: &Shop,
    listing: &ItemListing,
): (String, u64, u64, address, Option<object::ID>) {
    assert_listing_matches_shop!(shop, listing);
    (
        listing.name,
        listing.base_price_usd_cents,
        listing.stock,
        listing.shop_address,
        listing.spotlight_discount_template_id,
    )
}

/// Returns accepted currency fields after validating shop membership.
public fun accepted_currency_values(
    shop: &Shop,
    accepted_currency: &AcceptedCurrency,
): (address, TypeName, vector<u8>, object::ID, u8, vector<u8>, u64, u64, u64) {
    assert_currency_matches_shop!(shop, accepted_currency);
    (
        accepted_currency.shop_address,
        accepted_currency.coin_type,
        accepted_currency.feed_id,
        accepted_currency.pyth_object_id,
        accepted_currency.decimals,
        accepted_currency.symbol,
        accepted_currency.max_price_age_secs_cap,
        accepted_currency.max_confidence_ratio_bps_cap,
        accepted_currency.max_price_status_lag_secs_cap,
    )
}

/// Returns discount template fields after validating shop membership.
public fun discount_template_values(
    shop: &Shop,
    template: &DiscountTemplate,
): (
    address,
    Option<object::ID>,
    DiscountRule,
    u64,
    Option<u64>,
    Option<u64>,
    u64,
    u64,
    bool,
) {
    assert_template_matches_shop!(shop, template);
    (
        template.shop_address,
        template.applies_to_listing,
        template.rule,
        template.starts_at,
        template.expires_at,
        template.max_redemptions,
        template.claims_issued,
        template.redemptions,
        template.active,
    )
}

/// Quotes the coin amount for a price info object with guardrails.
entry fun quote_amount_for_price_info_object(
    shop: &Shop,
    accepted_currency: &AcceptedCurrency,
    price_info_object: &price_info::PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
): u64 {
    assert_currency_matches_shop!(shop, accepted_currency);
    ensure_price_info_matches_currency!(accepted_currency, price_info_object);
    assert_price_status_trading!(
        price_info_object,
        accepted_currency.max_price_status_lag_secs_cap,
    );
    // Entry-only quote helper; clients call via dev-inspect instead of storing quotes on-chain.
    quote_amount_with_guardrails(
        accepted_currency,
        price_info_object,
        price_usd_cents,
        &max_price_age_secs,
        &max_confidence_ratio_bps,
        clock,
    )
}

// === #[test_only] API ===

#[test_only]
public struct TestPublisherOTW has drop {}

#[test_only]
public fun test_claim_publisher(ctx: &mut TxContext): package::Publisher {
    package::test_claim<TestPublisherOTW>(TestPublisherOTW {}, ctx)
}

#[test_only]
public fun test_init(ctx: &mut TxContext) {
    init(SHOP {}, ctx)
}

#[test_only]
public fun test_setup_shop(owner: address, ctx: &mut TxContext): (Shop, ShopOwnerCap) {
    let shop = new_shop(b"Shop".to_string(), owner, ctx);
    let owner_cap = ShopOwnerCap {
        id: object::new(ctx),
        shop_address: object::uid_to_address(&shop.id),
        owner,
    };
    (shop, owner_cap)
}

#[test_only]
public fun test_template_id(template: &DiscountTemplate): object::ID {
    template_id(template)
}

#[test_only]
public fun test_create_discount_template_local(
    shop: &mut Shop,
    applies_to_listing: Option<object::ID>,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    ctx: &mut TxContext,
): (DiscountTemplate, object::ID) {
    let (template, template_id, discount_rule, template_address) = create_discount_template_core(
        shop,
        applies_to_listing,
        rule_kind,
        rule_value,
        starts_at,
        expires_at,
        max_redemptions,
        ctx,
    );

    event::emit(DiscountTemplateCreatedEvent {
        shop_address: shop_address(shop),
        discount_template_id: template_address,
        rule: discount_rule,
    });

    (template, template_id)
}

#[test_only]
public fun test_quote_amount_from_usd_cents(
    usd_cents: u64,
    coin_decimals: u8,
    price: &price::Price,
    max_confidence_ratio_bps: u64,
): u64 {
    quote_amount_from_usd_cents(
        usd_cents,
        coin_decimals,
        price,
        max_confidence_ratio_bps,
    )
}

#[test_only]
public fun test_quote_amount_for_price_info_object(
    shop: &Shop,
    accepted_currency: &AcceptedCurrency,
    price_info_object: &price_info::PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
): u64 {
    quote_amount_for_price_info_object(
        shop,
        accepted_currency,
        price_info_object,
        price_usd_cents,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
    )
}

#[test_only]
public fun test_max_price_status_lag_secs(): u64 {
    DEFAULT_MAX_PRICE_STATUS_LAG_SECS
}

#[test_only]
public fun test_default_max_price_status_lag_secs(): u64 {
    DEFAULT_MAX_PRICE_STATUS_LAG_SECS
}

#[test_only]
public fun test_assert_price_status_trading(price_info_object: &price_info::PriceInfoObject) {
    assert_price_status_trading!(
        price_info_object,
        DEFAULT_MAX_PRICE_STATUS_LAG_SECS,
    );
}

#[test_only]
public fun test_default_max_price_age_secs(): u64 {
    DEFAULT_MAX_PRICE_AGE_SECS
}

#[test_only]
public fun test_default_max_confidence_ratio_bps(): u64 {
    DEFAULT_MAX_CONFIDENCE_RATIO_BPS
}

#[test_only]
public fun test_max_decimal_power(): u64 {
    MAX_DECIMAL_POWER
}

#[test_only]
public fun test_listing_values(
    shop: &Shop,
    listing: &ItemListing,
): (String, u64, u64, address, Option<object::ID>) {
    listing_values(shop, listing)
}

#[test_only]
public fun test_listing_exists(shop: &Shop, listing_id: object::ID): bool {
    listing_exists(shop, listing_id)
}

#[test_only]
public fun test_listing_id_from_value(listing: &ItemListing): object::ID {
    listing_id(listing)
}

#[test_only]
public fun test_listing_address(listing: &ItemListing): address {
    object::uid_to_address(&listing.id)
}

#[test_only]
public fun test_accepted_currency_exists(shop: &Shop, accepted_currency_id: object::ID): bool {
    accepted_currency_exists(shop, accepted_currency_id)
}

#[test_only]
public fun test_accepted_currency_values(
    shop: &Shop,
    accepted_currency: &AcceptedCurrency,
): (address, TypeName, vector<u8>, object::ID, u8, vector<u8>, u64, u64, u64) {
    accepted_currency_values(shop, accepted_currency)
}

#[test_only]
public fun test_accepted_currency_id_for_type(shop: &Shop, coin_type: TypeName): object::ID {
    accepted_currency_id_for_type(shop, coin_type).destroy_or!(abort EAcceptedCurrencyMissing)
}

#[test_only]
public fun test_discount_template_exists(shop: &Shop, template_id: object::ID): bool {
    discount_template_exists(shop, template_id)
}

#[test_only]
public fun test_discount_template_values(
    shop: &Shop,
    template: &DiscountTemplate,
): (address, Option<object::ID>, DiscountRule, u64, Option<u64>, Option<u64>, u64, u64, bool) {
    discount_template_values(shop, template)
}

#[test_only]
public fun test_discount_claim_exists(template: &DiscountTemplate, claimer: address): bool {
    dynamic_field::exists_with_type<DiscountClaimKey, DiscountClaim>(
        &template.id,
        DiscountClaimKey(claimer),
    )
}

#[test_only]
public fun test_abort_invalid_owner_cap() {
    abort EInvalidOwnerCap
}

#[test_only]
public fun test_abort_accepted_currency_missing() {
    abort EAcceptedCurrencyMissing
}

#[test_only]
public fun test_claim_discount_ticket(
    shop: &Shop,
    template: &mut DiscountTemplate,
    clock: &clock::Clock,
    ctx: &mut TxContext,
): () {
    claim_discount_ticket(shop, template, clock, ctx)
}

#[test_only]
public fun test_claim_discount_ticket_inline(
    shop: &Shop,
    template: &mut DiscountTemplate,
    now_secs: u64,
    ctx: &mut TxContext,
): DiscountTicket {
    assert_template_matches_shop!(shop, template);
    claim_discount_ticket_inline(template, now_secs, ctx)
}

#[test_only]
public fun test_claim_and_buy_with_ids<TItem: store, TCoin>(
    shop: &mut Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    discount_template: &mut DiscountTemplate,
    price_info_object: &price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u64>,
    clock: &clock::Clock,
    ctx: &mut TxContext,
) {
    let shop_owner = shop.owner;
    let shop_address = shop_address(shop);
    assert_listing_matches_shop!(shop, item_listing);
    assert_currency_matches_shop!(shop, accepted_currency);
    assert_template_matches_shop!(shop, discount_template);

    let now = now_secs(clock);
    let (discount_ticket, claimer) = claim_discount_ticket_with_event(
        discount_template,
        now,
        ctx,
    );

    let discounted_price_usd_cents = apply_discount(
        item_listing.base_price_usd_cents,
        &discount_template.rule,
    );
    let discount_template_id = option::some(template_address(discount_template));
    let ticket_id = object::uid_to_address(&discount_ticket.id);
    discount_template.redemptions = discount_template.redemptions + 1;

    let (owed_coin_opt, change_coin, minted_item) = process_purchase_core<TItem, TCoin>(
        item_listing,
        accepted_currency,
        price_info_object,
        payment,
        shop_address,
        mint_to,
        refund_extra_to,
        discounted_price_usd_cents,
        discount_template_id,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );
    if (option::is_some(&owed_coin_opt)) {
        let owed_coin = option::destroy_some(owed_coin_opt);
        transfer::public_transfer(owed_coin, shop_owner);
    } else {
        option::destroy_none(owed_coin_opt);
    };
    if (change_coin.value() == 0) {
        change_coin.destroy_zero();
    } else {
        transfer::public_transfer(change_coin, refund_extra_to);
    };
    transfer::public_transfer(minted_item, mint_to);

    event::emit(DiscountRedeemedEvent {
        shop_address,
        discount_template_id: template_address(discount_template),
        discount_id: ticket_id,
        listing_id: object::uid_to_address(&item_listing.id),
        buyer: claimer,
    });

    burn_discount_ticket(discount_ticket);
}

#[test_only]
public fun test_discount_rule_kind(rule: DiscountRule): u8 {
    match (rule) {
        DiscountRule::Fixed { .. } => 0,
        DiscountRule::Percent { .. } => 1,
    }
}

#[test_only]
public fun test_discount_rule_value(rule: DiscountRule): u64 {
    match (rule) {
        DiscountRule::Fixed { amount_cents } => amount_cents,
        DiscountRule::Percent { bps } => bps as u64,
    }
}

#[test_only]
public fun test_apply_percent_discount(base_price_usd_cents: u64, bps: u16): u64 {
    apply_discount(
        base_price_usd_cents,
        &DiscountRule::Percent { bps },
    )
}

#[test_only]
public fun test_bytes_equal(left: vector<u8>, right: vector<u8>): bool {
    bytes_equal(&left, &right)
}

#[test_only]
public fun test_discount_template_created_shop(event: &DiscountTemplateCreatedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_discount_template_created_id(event: &DiscountTemplateCreatedEvent): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_template_created_rule(event: &DiscountTemplateCreatedEvent): DiscountRule {
    event.rule
}

#[test_only]
public fun test_discount_template_updated_shop(event: &DiscountTemplateUpdatedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_discount_template_updated_id(event: &DiscountTemplateUpdatedEvent): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_template_toggled_shop(event: &DiscountTemplateToggledEvent): address {
    event.shop_address
}

#[test_only]
public fun test_discount_template_toggled_id(event: &DiscountTemplateToggledEvent): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_template_toggled_active(event: &DiscountTemplateToggledEvent): bool {
    event.active
}

#[test_only]
public fun test_purchase_completed_discounted_price(event: &PurchaseCompletedEvent): u64 {
    event.discounted_price_usd_cents
}

#[test_only]
public fun test_purchase_completed_shop(event: &PurchaseCompletedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_purchase_completed_listing(event: &PurchaseCompletedEvent): address {
    event.item_listing_address
}

#[test_only]
public fun test_purchase_completed_buyer(event: &PurchaseCompletedEvent): address {
    event.buyer
}

#[test_only]
public fun test_purchase_completed_mint_to(event: &PurchaseCompletedEvent): address {
    event.mint_to
}

#[test_only]
public fun test_purchase_completed_coin_type(event: &PurchaseCompletedEvent): TypeName {
    event.coin_type
}

#[test_only]
public fun test_purchase_completed_amount_paid(event: &PurchaseCompletedEvent): u64 {
    event.amount_paid
}

#[test_only]
public fun test_purchase_completed_discount_template_id(
    event: &PurchaseCompletedEvent,
): Option<address> {
    event.discount_template_id
}

#[test_only]
public fun test_purchase_completed_accepted_currency_id(event: &PurchaseCompletedEvent): address {
    event.accepted_currency_id
}

#[test_only]
public fun test_purchase_completed_feed_id(event: &PurchaseCompletedEvent): vector<u8> {
    event.feed_id
}

#[test_only]
public fun test_purchase_completed_base_price_usd_cents(event: &PurchaseCompletedEvent): u64 {
    event.base_price_usd_cents
}

#[test_only]
public fun test_purchase_completed_quote_amount(event: &PurchaseCompletedEvent): u64 {
    event.quote_amount
}

#[test_only]
public fun test_minting_completed_shop(event: &MintingCompletedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_minting_completed_listing(event: &MintingCompletedEvent): address {
    event.item_listing_address
}

#[test_only]
public fun test_minting_completed_buyer(event: &MintingCompletedEvent): address {
    event.buyer
}

#[test_only]
public fun test_minting_completed_minted_item_id(event: &MintingCompletedEvent): address {
    event.minted_item_id
}

#[test_only]
public fun test_minting_completed_mint_to(event: &MintingCompletedEvent): address {
    event.mint_to
}

#[test_only]
public fun test_minting_completed_refund_to(event: &MintingCompletedEvent): address {
    event.refund_to
}

#[test_only]
public fun test_minting_completed_change_amount(event: &MintingCompletedEvent): u64 {
    event.change_amount
}

#[test_only]
public fun test_minting_completed_coin_type(event: &MintingCompletedEvent): TypeName {
    event.coin_type
}

#[test_only]
public fun test_discount_redeemed_shop(event: &DiscountRedeemedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_discount_redeemed_template_id(event: &DiscountRedeemedEvent): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_redeemed_discount_id(event: &DiscountRedeemedEvent): address {
    event.discount_id
}

#[test_only]
public fun test_discount_redeemed_listing_id(event: &DiscountRedeemedEvent): address {
    event.listing_id
}

#[test_only]
public fun test_discount_redeemed_buyer(event: &DiscountRedeemedEvent): address {
    event.buyer
}

#[test_only]
public fun test_discount_claimed_shop(event: &DiscountClaimedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_discount_claimed_template_id(event: &DiscountClaimedEvent): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_claimed_claimer(event: &DiscountClaimedEvent): address {
    event.claimer
}

#[test_only]
public fun test_discount_claimed_discount_id(event: &DiscountClaimedEvent): address {
    event.discount_id
}

#[test_only]
public fun test_discount_ticket_values(
    ticket: &DiscountTicket,
): (address, address, Option<object::ID>, address) {
    (ticket.discount_template_id, ticket.shop_address, ticket.listing_id, ticket.claimer)
}

#[test_only]
public fun test_last_created_id(ctx: &TxContext): object::ID {
    object::id_from_address(tx_context::last_created_object_id(ctx))
}

#[test_only]
public fun test_add_item_listing_local<T: store>(
    shop: &mut Shop,
    owner_cap: &ShopOwnerCap,
    name: String,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_template_id: Option<object::ID>,
    ctx: &mut TxContext,
): (ItemListing, object::ID) {
    let (listing, listing_id, _listing_address) = add_item_listing_core<T>(
        shop,
        owner_cap,
        name,
        base_price_usd_cents,
        stock,
        spotlight_discount_template_id,
        ctx,
    );
    (listing, listing_id)
}

#[test_only]
public fun test_listing_values_local(
    listing: &ItemListing,
): (String, u64, u64, address, Option<object::ID>) {
    (
        listing.name,
        listing.base_price_usd_cents,
        listing.stock,
        listing.shop_address,
        listing.spotlight_discount_template_id,
    )
}

#[test_only]
public fun test_remove_listing(shop: &mut Shop, listing_id: object::ID) {
    if (
        dynamic_field::exists_with_type<ItemListingKey, ItemListingMarker>(
            &shop.id,
            ItemListingKey(listing_id),
        )
    ) {
        let _marker: ItemListingMarker = dynamic_field::remove(
            &mut shop.id,
            ItemListingKey(listing_id),
        );
    };
}

#[test_only]
public fun test_remove_currency_field(shop: &mut Shop, coin_type: TypeName) {
    remove_currency_field(shop, coin_type)
}

#[test_only]
public fun test_remove_template(shop: &mut Shop, template_id: object::ID) {
    if (
        dynamic_field::exists_with_type<DiscountTemplateKey, DiscountTemplateMarker>(
            &shop.id,
            DiscountTemplateKey(template_id),
        )
    ) {
        let _marker: DiscountTemplateMarker = dynamic_field::remove(
            &mut shop.id,
            DiscountTemplateKey(template_id),
        );
    };
}

#[test_only]
public fun test_shop_id(shop: &Shop): address {
    object::uid_to_address(&shop.id)
}

#[test_only]
public fun test_shop_owner(shop: &Shop): address {
    shop.owner
}

#[test_only]
public fun test_shop_name(shop: &Shop): String {
    shop.name
}

#[test_only]
public fun test_shop_disabled(shop: &Shop): bool {
    shop.disabled
}

#[test_only]
public fun test_shop_owner_cap_owner(owner_cap: &ShopOwnerCap): address {
    owner_cap.owner
}

#[test_only]
public fun test_shop_owner_cap_id(owner_cap: &ShopOwnerCap): address {
    object::uid_to_address(&owner_cap.id)
}

#[test_only]
public fun test_shop_owner_cap_shop_address(owner_cap: &ShopOwnerCap): address {
    owner_cap.shop_address
}

#[test_only]
public fun test_shop_created_owner(event: &ShopCreatedEvent): address {
    event.owner
}

#[test_only]
public fun test_shop_created_name(event: &ShopCreatedEvent): String {
    event.name
}

#[test_only]
public fun test_shop_created_owner_cap_id(event: &ShopCreatedEvent): address {
    event.shop_owner_cap_id
}

#[test_only]
public fun test_shop_created_shop_address(event: &ShopCreatedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_shop_owner_updated_shop(event: &ShopOwnerUpdatedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_shop_owner_updated_previous(event: &ShopOwnerUpdatedEvent): address {
    event.previous_owner
}

#[test_only]
public fun test_shop_owner_updated_new(event: &ShopOwnerUpdatedEvent): address {
    event.new_owner
}

#[test_only]
public fun test_shop_owner_updated_cap_id(event: &ShopOwnerUpdatedEvent): address {
    event.shop_owner_cap_id
}

#[test_only]
public fun test_shop_owner_updated_rotated_by(event: &ShopOwnerUpdatedEvent): address {
    event.rotated_by
}

#[test_only]
public fun test_shop_disabled_shop(event: &ShopDisabledEvent): address {
    event.shop_address
}

#[test_only]
public fun test_shop_disabled_owner(event: &ShopDisabledEvent): address {
    event.owner
}

#[test_only]
public fun test_shop_disabled_cap_id(event: &ShopDisabledEvent): address {
    event.shop_owner_cap_id
}

#[test_only]
public fun test_shop_disabled_by(event: &ShopDisabledEvent): address {
    event.disabled_by
}

#[test_only]
public fun test_item_listing_stock_updated_shop(event: &ItemListingStockUpdatedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_item_listing_stock_updated_listing(event: &ItemListingStockUpdatedEvent): address {
    event.item_listing_address
}

#[test_only]
public fun test_item_listing_stock_updated_new_stock(event: &ItemListingStockUpdatedEvent): u64 {
    event.new_stock
}

#[test_only]
public fun test_item_listing_added_shop(event: &ItemListingAddedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_item_listing_added_listing(event: &ItemListingAddedEvent): address {
    event.item_listing_address
}

#[test_only]
public fun test_item_listing_added_name(event: &ItemListingAddedEvent): String {
    event.name
}

#[test_only]
public fun test_item_listing_added_base_price_usd_cents(event: &ItemListingAddedEvent): u64 {
    event.base_price_usd_cents
}

#[test_only]
public fun test_item_listing_added_spotlight_template(
    event: &ItemListingAddedEvent,
): Option<address> {
    event.spotlight_discount_template_id
}

#[test_only]
public fun test_item_listing_added_stock(event: &ItemListingAddedEvent): u64 {
    event.stock
}

#[test_only]
public fun test_item_listing_removed_shop(event: &ItemListingRemovedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_item_listing_removed_listing(event: &ItemListingRemovedEvent): address {
    event.item_listing_address
}

#[test_only]
public fun test_accepted_coin_added_shop(event: &AcceptedCoinAddedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_accepted_coin_added_coin_type(event: &AcceptedCoinAddedEvent): TypeName {
    event.coin_type
}

#[test_only]
public fun test_accepted_coin_added_feed_id(event: &AcceptedCoinAddedEvent): vector<u8> {
    event.feed_id
}

#[test_only]
public fun test_accepted_coin_added_pyth_object_id(event: &AcceptedCoinAddedEvent): object::ID {
    event.pyth_object_id
}

#[test_only]
public fun test_accepted_coin_added_decimals(event: &AcceptedCoinAddedEvent): u8 {
    event.decimals
}

#[test_only]
public fun test_accepted_coin_removed_shop(event: &AcceptedCoinRemovedEvent): address {
    event.shop_address
}

#[test_only]
public fun test_accepted_coin_removed_coin_type(event: &AcceptedCoinRemovedEvent): TypeName {
    event.coin_type
}
