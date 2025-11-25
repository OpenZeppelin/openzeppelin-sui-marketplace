#[allow(lint(public_entry), unused_field)]
module sui_oracle_market::shop;

use pyth::i64 as pyth_i64;
use pyth::price as pyth_price;
use pyth::price_identifier as pyth_price_identifier;
use pyth::price_info as pyth_price_info;
use pyth::pyth;
use std::option as opt;
use std::string as string;
use std::type_name::{Self as type_name, TypeName as TypeInfo};
use std::u128;
use std::vector as vec;
use sui::clock;
use sui::coin;
use sui::coin_registry as registry;
use sui::dynamic_field;
use sui::event;
use sui::object as obj;
use sui::package as pkg;
use sui::transfer as txf;
use sui::tx_context as tx;

/// =======///
/// Errors ///
/// =======///
const EInvalidPublisher: u64 = 1;
const EInvalidOwnerCap: u64 = 2;
const EEmptyItemName: u64 = 3;
const EInvalidPrice: u64 = 4;
const EZeroStock: u64 = 5;
const ETemplateWindow: u64 = 6;
const ETemplateShopMismatch: u64 = 7;
const EListingShopMismatch: u64 = 8;
const EInvalidRuleKind: u64 = 9;
const EInvalidRuleValue: u64 = 10;
const EAcceptedCurrencyExists: u64 = 11;
const EAcceptedCurrencyMissing: u64 = 12;
const EEmptyFeedId: u64 = 13;
const EInvalidFeedIdLength: u64 = 34;
const ETemplateInactive: u64 = 14;
const ETemplateTooEarly: u64 = 15;
const ETemplateExpired: u64 = 16;
const ETemplateMaxedOut: u64 = 17;
const EDiscountAlreadyClaimed: u64 = 18;
const EOutOfStock: u64 = 19;
const EInvalidPaymentCoinType: u64 = 20;
const EPythObjectMismatch: u64 = 21;
const EFeedIdentifierMismatch: u64 = 22;
const EPriceNonPositive: u64 = 23;
const EPriceOverflow: u64 = 24;
const EInsufficientPayment: u64 = 25;
const EDiscountTicketMismatch: u64 = 26;
const EDiscountTicketOwnerMismatch: u64 = 27;
const EDiscountTicketListingMismatch: u64 = 28;
const EDiscountTicketShopMismatch: u64 = 29;
const ECurrencyListingMismatch: u64 = 30;
const EDiscountShopMismatch: u64 = 31;
const EConfidenceIntervalTooWide: u64 = 32;
const EConfidenceExceedsPrice: u64 = 33;
const ESpotlightTemplateListingMismatch: u64 = 35;
const EDiscountClaimsNotPrunable: u64 = 36;

const CENTS_PER_DOLLAR: u64 = 100;
const BASIS_POINT_DENOMINATOR: u64 = 10_000;
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;
const MAX_DECIMAL_POWER: u64 = 38;
const DEFAULT_MAX_CONFIDENCE_RATIO_BPS: u64 = 1_000; // Reject price feeds with σ/μ above 10%.
const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;
// Powers of 10 from 10^0 through 10^38 for scaling Pyth prices and coin decimals.
const POW10_U128: vector<u128> = vector[
    1,
    10,
    100,
    1_000,
    10_000,
    100_000,
    1_000_000,
    10_000_000,
    100_000_000,
    1_000_000_000,
    10_000_000_000,
    100_000_000_000,
    1_000_000_000_000,
    10_000_000_000_000,
    100_000_000_000_000,
    1_000_000_000_000_000,
    10_000_000_000_000_000,
    100_000_000_000_000_000,
    1_000_000_000_000_000_000,
    10_000_000_000_000_000_000,
    100_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000_000_000_000,
    1_000_000_000_000_000_000_000_000_000_000_000_000,
    10_000_000_000_000_000_000_000_000_000_000_000_000,
    100_000_000_000_000_000_000_000_000_000_000_000_000,
];

///====================///
/// Capability & Core ///
///====================///

/// Capability that proves the caller can administer a specific `Shop`.
/// Holding and using this object is the Sui-native equivalent of matching `onlyOwner` criteria in Solidity.
public struct ShopOwnerCap has key, store {
    id: obj::UID,
    shop_address: address,
    owner: address, // Tracks the current payout address for operators rotating the cap.
}

/// Shared shop that stores item listings to sell, accepted currencies, and discount templates via dynamic fields.
public struct Shop has key, store {
    id: obj::UID,
    owner: address, // Payout recipient for sales.
}

/// Item listing metadata keyed under the shared `Shop`, will be using to mint specific items on purchase.
/// Discounts can be attached to highlight promotions in the UI.
public struct ItemListing has key, store {
    id: obj::UID,
    shop_address: address,
    item_type: TypeInfo,
    name: vector<u8>,
    base_price_usd_cents: u64, // Stored in USD cents to avoid floating point math.
    stock: u64,
    spotlight_discount_template_id: opt::Option<obj::ID>,
}

/// Shop item type for receipts.
public struct ShopItem has key, store {
    id: obj::UID,
    shop_address: address,
    item_listing_address: address,
    item_type: TypeInfo,
    name: vector<u8>,
    acquired_at: u64,
}

/// Example strongly-typed item.
public struct Bike has key, store {
    id: obj::UID,
    shop_address: address,
    item_listing_address: address,
    name: vector<u8>,
    brand: vector<u8>,
    acquired_at: u64,
}

public struct Tire has key, store {
    id: obj::UID,
    shop_address: address,
    item_listing_address: address,
    name: vector<u8>,
    brand: vector<u8>,
    acquired_at: u64,
}

/// Defines which external coins the shop is able to price/accept.
public struct AcceptedCurrency has key, store {
    id: obj::UID,
    shop_address: address,
    coin_type: TypeInfo,
    feed_id: vector<u8>, // Pyth price feed identifier (e.g. SUI/USD)
    pyth_object_id: obj::ID, // ID of Pyth PriceInfoObject
    decimals: u8,
    symbol: vector<u8>,
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
    id: obj::UID,
    shop_address: address,
    applies_to_listing: opt::Option<obj::ID>,
    rule: DiscountRule,
    starts_at: u64,
    expires_at: opt::Option<u64>,
    max_redemptions: opt::Option<u64>,
    claims_issued: u64,
    redemptions: u64,
    active: bool,
}

/// Discount ticket that future buyers will redeem to later use during purchase flow.
public struct DiscountTicket has key, store {
    id: obj::UID,
    discount_template_id: address,
    shop_address: address,
    listing_id: opt::Option<obj::ID>,
    owner: address,
}

/// Tracks which addresses already claimed a discount from a template.
public struct DiscountClaim has key, store {
    id: obj::UID,
    claimer: address,
}

///====================///
/// Event Definitions ///
///====================///
public struct ShopCreated has copy, drop {
    shop_address: address,
    owner: address,
    shop_owner_cap_id: address,
}

public struct ShopOwnerUpdated has copy, drop {
    shop_address: address,
    previous_owner: address,
    new_owner: address,
    shop_owner_cap_id: address,
    rotated_by: address,
}

public struct ItemListingAdded has copy, drop {
    shop_address: address,
    item_listing_address: address,
    name: vector<u8>,
    base_price_usd_cents: u64,
    spotlight_discount_template_id: opt::Option<address>,
    stock: u64,
}

public struct ItemListingStockUpdated has copy, drop {
    shop_address: address,
    item_listing_address: address,
    new_stock: u64,
}

public struct ItemListingRemoved has copy, drop {
    shop_address: address,
    item_listing_address: address,
}

public struct DiscountTemplateCreated has copy, drop {
    shop_address: address,
    discount_template_id: address,
    rule: DiscountRule,
}

public struct DiscountTemplateUpdated has copy, drop {
    shop_address: address,
    discount_template_id: address,
}

public struct DiscountTemplateToggled has copy, drop {
    shop_address: address,
    discount_template_id: address,
    active: bool,
}

public struct AcceptedCoinAdded has copy, drop {
    shop_address: address,
    coin_type: TypeInfo,
    feed_id: vector<u8>,
    pyth_object_id: obj::ID,
    decimals: u8,
}

public struct AcceptedCoinRemoved has copy, drop {
    shop_address: address,
    coin_type: TypeInfo,
}

public struct DiscountClaimed has copy, drop {
    shop_address: address,
    discount_template_id: address,
    claimer: address,
    discount_id: address,
}

public struct DiscountRedeem has copy, drop {
    shop_address: address,
    discount_template_id: address,
    discount_id: address,
    listing_id: address,
    buyer: address,
}

public struct PurchaseCompleted has copy, drop {
    shop_address: address,
    item_listing_address: address,
    buyer: address,
    mint_to: address,
    coin_type: TypeInfo,
    amount_paid: u64,
    discount_template_id: opt::Option<address>,
    accepted_currency_id: address,
    feed_id: vector<u8>,
    base_price_usd_cents: u64,
    discounted_price_usd_cents: u64,
    quote_amount: u64,
}

public struct MintingCompleted has copy, drop {
    shop_address: address,
    item_listing_address: address,
    buyer: address,
    minted_item_id: address,
    mint_to: address,
    refund_to: address,
    change_amount: u64,
    coin_type: TypeInfo,
}

///======================///
/// Entry Point Methods ///
///======================///

/// * Shop * ///

/// Create a new shop and its owner capability.
///
/// The function consumes a `pkg::Publisher` so only the package author can spin up
/// curated shops.
/// Sui mindset:
/// - Ownership does not comes from `msg.sender` instead they comes from explicit capability objects,
/// here a ShopOwnerCap that will be minted as an object that will later be used to access specific functions.
/// - Application state is modeled as shareable objects, not contract storage.
public entry fun create_shop(publisher: &pkg::Publisher, ctx: &mut tx::TxContext) {
    // Ensure the capability comes from this module; otherwise users could pass an
    // unrelated publisher.
    assert!(pkg::from_module<Shop>(publisher), EInvalidPublisher);

    let owner: address = tx::sender(ctx);

    let shop: Shop = Shop {
        id: obj::new(ctx),
        owner,
    };

    let owner_cap: ShopOwnerCap = ShopOwnerCap {
        id: obj::new(ctx),
        shop_address: shop_address(&shop),
        owner,
    };

    event::emit(ShopCreated {
        shop_address: shop_address(&shop),
        owner,
        shop_owner_cap_id: obj::uid_to_address(&owner_cap.id),
    });

    txf::share_object(shop);
    txf::public_transfer(owner_cap, owner);
}

/// Rotate the payout recipient for a shop.
///
/// Payouts should follow the current operator, not the address that originally created the shop.
/// Sui mindset:
/// - The operator proves authority with `ShopOwnerCap`; buyers keep using the shared `Shop` and do not
///   need to pass any extra capabilities when purchasing.
public entry fun update_shop_owner(
    shop: &mut Shop,
    owner_cap: &mut ShopOwnerCap,
    new_owner: address,
    ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);

    let previous_owner: address = shop.owner;
    shop.owner = new_owner;
    owner_cap.owner = new_owner;

    event::emit(ShopOwnerUpdated {
        shop_address: shop_address(shop),
        previous_owner,
        new_owner,
        shop_owner_cap_id: obj::uid_to_address(&owner_cap.id),
        rotated_by: tx::sender(ctx),
    });
}

/// * Item Listing * ///

/// Add an ItemListing attached to the Shop. The generic `T` encodes what will eventually be minted
/// when a buyer completes checkout. Prices are provided in USD cents (e.g. $12.50 -> 125_00) to
/// avoid floating point math.
///
/// Sui mindset:
/// - For access control, we are not using modifier like `onlyOwner`,
/// instead we require the ShopOwnerCap object that was minted on shop creation to be passed in the function itself.
/// - Dynamic fields let each listing live inside its own child object,
/// so different listings can be updated or sold in parallel without accessing a single shared Shop,
/// this allows better concurrency and throughput that would not been possible if each buyer would have to write to the same store object one by one.
public entry fun add_item_listing<T: store>(
    shop: &mut Shop,
    name: vector<u8>,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_template_id: opt::Option<obj::ID>,
    owner_cap: &ShopOwnerCap,
    ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    validate_listing_inputs(
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

    assert_spotlight_template_matches_listing(
        shop,
        listing_address,
        &listing.spotlight_discount_template_id,
    );

    let listing_name_for_event = clone_bytes(&listing.name);
    event::emit(ItemListingAdded {
        shop_address,
        item_listing_address: listing_address,
        name: listing_name_for_event,
        base_price_usd_cents: listing.base_price_usd_cents,
        spotlight_discount_template_id: map_id_option_to_address(
            &listing.spotlight_discount_template_id,
        ),
        stock,
    });

    dynamic_field::add(&mut shop.id, obj::id_from_address(listing_address), listing);
}

/// Update the inventory count for a listing.
///
public entry fun update_item_listing_stock(
    shop: &mut Shop,
    item_listing_id: obj::ID,
    new_stock: u64,
    owner_cap: &ShopOwnerCap,
    _ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    assert_non_zero_stock(new_stock);

    let listing: &mut ItemListing = dynamic_field::borrow_mut(&mut shop.id, item_listing_id);
    listing.stock = new_stock;

    event::emit(ItemListingStockUpdated {
        shop_address: listing.shop_address,
        item_listing_address: obj::id_to_address(&item_listing_id),
        new_stock,
    });
}

/// Remove an item listing entirely.
///
/// Removing a dynamic field detaches that child object, allowing us to delete
/// it cleanly without iterating over any collection.
/// Sui mindset:
/// - State mutation happens on owned objects. There’s no global contract storage like Solidity’s mapping.
///   In this example Inventory lives in child objects attached to the shared Shop,
///   so removing one item only touches its own record, no global mapping or shared vector needed
public entry fun remove_item_listing(
    shop: &mut Shop,
    item_listing_id: obj::ID,
    owner_cap: &ShopOwnerCap,
    _ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);

    let listing: ItemListing = dynamic_field::remove(&mut shop.id, item_listing_id);
    let shop_address: address = listing.shop_address;
    let listing_address: address = obj::uid_to_address(&listing.id);
    destroy_listing(listing);

    event::emit(ItemListingRemoved {
        shop_address,
        item_listing_address: listing_address,
    });
}

/// * Accepted currencies * ///

/// Register a coin type that the shop will price through an oracle feed.
///
/// Sui mindset:
/// - Payment assets are native Move resources (`Coin<T>`, Currency<T>) not ERC20 balances, so registration works
///   by storing rich type info instead of interface addresses.
/// - Coin metadata (symbol, decimals) is globally stored in coin_registry (or coin_metadata) rather than queried via contract calls
/// - Capability-based access control keeps the logic honest; only the matching `ShopOwnerCap`
///   can mutate the shop configuration.
/// - Dynamic fields keep each accepted currency as its own child object, so updating one feed does
///   not serialize writes to the entire shop.
public entry fun add_accepted_currency<T: store>(
    shop: &mut Shop,
    currency: &registry::Currency<T>,
    feed_id: vector<u8>,
    pyth_object_id: obj::ID,
    price_info_object: &pyth_price_info::PriceInfoObject,
    owner_cap: &ShopOwnerCap,
    ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    let coin_type = currency_type<T>();
    validate_accepted_currency_inputs(
        shop,
        &coin_type,
        &feed_id,
        &pyth_object_id,
        price_info_object,
    );

    let confirmed_price_object = pyth_price_info::uid_to_inner(price_info_object);
    assert!(confirmed_price_object == pyth_object_id, EPythObjectMismatch);

    let decimals: u8 = registry::decimals(currency);
    let symbol: vector<u8> = string::into_bytes(registry::symbol(currency));
    let shop_address: address = shop_address(shop);

    let (accepted_currency, accepted_currency_address) = new_accepted_currency(
        shop_address,
        coin_type,
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
        ctx,
    );
    let feed_for_event = clone_bytes(&accepted_currency.feed_id);

    dynamic_field::add(
        &mut shop.id,
        obj::id_from_address(accepted_currency_address),
        accepted_currency,
    );

    dynamic_field::add(&mut shop.id, coin_type, obj::id_from_address(accepted_currency_address));

    event::emit(AcceptedCoinAdded {
        shop_address,
        coin_type,
        feed_id: feed_for_event,
        pyth_object_id,
        decimals,
    })
}

/// Deregister an accepted coin type and clean up its lookup index.
public entry fun remove_accepted_currency(
    shop: &mut Shop,
    accepted_currency_id: obj::ID,
    owner_cap: &ShopOwnerCap,
    _ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    assert_accepted_currency_exists(shop, accepted_currency_id);

    let accepted_currency: AcceptedCurrency = dynamic_field::remove(
        &mut shop.id,
        accepted_currency_id,
    );

    remove_currency_field(shop, accepted_currency.coin_type);

    event::emit(AcceptedCoinRemoved {
        shop_address: accepted_currency.shop_address,
        coin_type: accepted_currency.coin_type,
    });

    destroy_accepted_currency(accepted_currency);
}

/// * Discount * ///

/// Create a discount template anchored under the shop.
///
/// Templates are shared immutable configs: by storing them as dynamic-field
/// children they automatically inherit the shop’s access control and remain
/// addressable by obj::ID for UIs. Callers still send primitive args (`rule_kind`
/// of `0 = fixed` or `1 = percent`), but we immediately convert them into the
/// strongly typed `DiscountRuleKind` for internal use.
/// For `Fixed` rules the `rule_value` is denominated in USD cents to match listing prices.
public entry fun create_discount_template(
    shop: &mut Shop,
    applies_to_listing: opt::Option<obj::ID>,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: opt::Option<u64>,
    max_redemptions: opt::Option<u64>,
    owner_cap: &ShopOwnerCap,
    ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    validate_discount_template_inputs(
        shop,
        &applies_to_listing,
        starts_at,
        &expires_at,
    );

    let discount_rule_kind: DiscountRuleKind = parse_rule_kind(rule_kind);
    let discount_rule: DiscountRule = build_discount_rule(discount_rule_kind, rule_value);
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

    dynamic_field::add(
        &mut shop.id,
        obj::id_from_address(discount_template_address),
        discount_template,
    );

    event::emit(DiscountTemplateCreated {
        shop_address,
        discount_template_id: discount_template_address,
        rule: discount_rule,
    });
}

/// Update mutable fields on a template (schedule, rule, limits).
/// For `Fixed` discounts the `rule_value` remains in USD cents.
public entry fun update_discount_template(
    shop: &mut Shop,
    discount_template_id: obj::ID,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: opt::Option<u64>,
    max_redemptions: opt::Option<u64>,
    owner_cap: &ShopOwnerCap,
) {
    assert_owner_cap(shop, owner_cap);
    assert_template_belongs_to_shop(shop, discount_template_id);
    assert_schedule(starts_at, &expires_at);

    let discount_rule_kind: DiscountRuleKind = parse_rule_kind(rule_kind);
    let discount_rule: DiscountRule = build_discount_rule(discount_rule_kind, rule_value);
    let discount_template: &mut DiscountTemplate = dynamic_field::borrow_mut(
        &mut shop.id,
        discount_template_id,
    );

    apply_discount_template_updates(
        discount_template,
        discount_rule,
        starts_at,
        expires_at,
        max_redemptions,
    );

    event::emit(DiscountTemplateUpdated {
        shop_address: discount_template.shop_address,
        discount_template_id: obj::id_to_address(&discount_template_id),
    });
}

/// Quickly enable/disable a coupon without deleting it.
public entry fun toggle_discount_template(
    shop: &mut Shop,
    discount_template_id: obj::ID,
    active: bool,
    owner_cap: &ShopOwnerCap,
    _ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    assert_template_belongs_to_shop(shop, discount_template_id);

    let discount_template: &mut DiscountTemplate = dynamic_field::borrow_mut(
        &mut shop.id,
        discount_template_id,
    );

    discount_template.active = active;

    event::emit(DiscountTemplateToggled {
        shop_address: discount_template.shop_address,
        discount_template_id: obj::id_to_address(&discount_template_id),
        active,
    });
}

/// Surface a template alongside a listing so UIs can highlight the promotion.
public entry fun attach_template_to_listing(
    shop: &mut Shop,
    item_listing_id: obj::ID,
    discount_template_id: obj::ID,
    owner_cap: &ShopOwnerCap,
    _ctx: &mut tx::TxContext,
) {
    toggle_template_on_listing(
        shop,
        item_listing_id,
        opt::some(discount_template_id),
        owner_cap,
        _ctx,
    )
}

/// Remove the promotion banner from a listing.
public entry fun clear_template_from_listing(
    shop: &mut Shop,
    item_listing_id: obj::ID,
    owner_cap: &ShopOwnerCap,
    _ctx: &mut tx::TxContext,
) {
    toggle_template_on_listing(shop, item_listing_id, opt::none(), owner_cap, _ctx)
}

/// Mint a single-use discount ticket to the caller using the template schedule and limits.
///
/// Sui mindset:
/// - Discount tickets are owned objects rather than balances in contract storage, so callers can
///   compose claim + checkout. Use `claim_and_buy_item_with_discount` to mint and spend in one
///   transaction, or call this entry to mint a ticket that the wallet can redeem later.
/// - Per-wallet claim limits are enforced by writing a child object (keyed by the claimer’s
///   address) under the template via dynamic fields. This keeps redemptions parallel—each wallet
///   touches only its own claim marker.
/// - Time windows are checked against the shared `Clock` (seconds) to avoid surprises when epochs
///   are long-lived; passing the clock keeps the function pure from a caller perspective.
/// - Claims only touch the template (not the shared `Shop`), so PTBs avoid global shop contention
///   and can mint tickets in parallel.
public entry fun claim_discount_ticket(
    discount_template: &mut DiscountTemplate,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
): () {
    let claimer: address = tx::sender(ctx);
    let now_secs: u64 = now_secs(clock);

    let discount_ticket: DiscountTicket = claim_discount_ticket_inline(
        discount_template,
        claimer,
        now_secs,
        ctx,
    );

    event::emit(DiscountClaimed {
        shop_address: discount_template.shop_address,
        discount_template_id: template_address(discount_template),
        claimer,
        discount_id: obj::uid_to_address(&discount_ticket.id),
    });

    txf::public_transfer(discount_ticket, claimer);
}

/// Non-entry helper that returns the owned ticket so callers can inline claim + buy in one PTB.
/// Intended to be composed inside future `buy_item` logic or higher-level scripts.
public fun claim_discount_ticket_inline(
    discount_template: &mut DiscountTemplate,
    claimer: address,
    now_secs: u64,
    ctx: &mut tx::TxContext,
): DiscountTicket {
    assert_template_claimable(discount_template, claimer, now_secs);

    let discount_ticket: DiscountTicket = mew_discount_ticket(discount_template, claimer, ctx);
    record_discount_claim(discount_template, claimer, ctx);
    discount_ticket
}

/// Remove recorded claim markers for a template that is no longer serving new tickets.
/// The template must be paused, expired, or maxed out so that pruning does not weaken
/// the one-claim-per-address guarantee while the promotion is active.
public entry fun prune_discount_claims(
    shop: &mut Shop,
    discount_template_id: obj::ID,
    claimers: vector<address>,
    owner_cap: &ShopOwnerCap,
    clock: &clock::Clock,
) {
    assert_owner_cap(shop, owner_cap);
    assert_template_belongs_to_shop(shop, discount_template_id);

    let template: &mut DiscountTemplate = dynamic_field::borrow_mut(
        &mut shop.id,
        discount_template_id,
    );
    let now_secs = now_secs(clock);
    assert_template_prunable(template, now_secs);
    prune_claim_markers(template, claimers);
}

/// Attach or clear a template banner on a listing depending on whether the `Option` carries an id.
entry fun toggle_template_on_listing(
    shop: &mut Shop,
    item_listing_id: obj::ID,
    discount_template_id: opt::Option<obj::ID>,
    owner_cap: &ShopOwnerCap,
    _ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    assert_listing_belongs_to_shop(shop, item_listing_id);
    validate_belongs_to_shop_if_some(ReferenceKind::Template, shop, &discount_template_id);
    assert_spotlight_template_matches_listing(
        shop,
        obj::id_to_address(&item_listing_id),
        &discount_template_id,
    );

    let item_listing: &mut ItemListing = dynamic_field::borrow_mut(&mut shop.id, item_listing_id);
    item_listing.spotlight_discount_template_id = discount_template_id;
}

/// * Checkout * ///

/// Execute a purchase priced in USD cents but settled with any previously registered `AcceptedCurrency`.
///
/// Sui mindset:
/// - There is no global ERC20 allowance. The buyer passes an owned `Coin<T>` directly,
///   the function splits only what is needed, and refunds the rest inside the same PTB.
/// - The shared `Shop` is only read (not mutated) so the PTB only locks the specific listing
///   and accepted currency records, keeping purchases parallel.
/// - Buyers pass an explicit `mint_to` target so PTBs can gift or redirect receipts separate
///   from the payer.
/// - Refunds (any leftover payment) are sent to an explicit `refund_extra_to` address so PTBs can
///   choose whether change returns to the payer or the recipient.
/// - Oracles are first-class objects. The buyer supplies a refreshed `PriceInfoObject`
///   so on-chain logic can deterministically verify freshness without off-chain trust.
/// - Callers can tune oracle guardrails by passing `max_price_age_secs` / `max_confidence_ratio_bps`;
///   `none` uses module defaults.
#[allow(lint(self_transfer))]
public entry fun buy_item<TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    price_info_object: &pyth_price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: opt::Option<u64>,
    max_confidence_ratio_bps: opt::Option<u64>,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
) {
    let base_price_usd_cents: u64 = item_listing.base_price_usd_cents;
    process_purchase(
        shop,
        item_listing,
        accepted_currency,
        price_info_object,
        payment,
        mint_to,
        refund_extra_to,
        base_price_usd_cents,
        opt::none(),
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );
}

/// Same as `buy_item` but also validates and burns a `DiscountTicket`.
///
/// Sui mindset:
/// - Promotions are modeled as owned objects (`DiscountTicket`). They are burnt here so the
///   on-chain state itself enforces single-use guarantees without external allowlists.
/// - The discount template is a shared object that any PTB can read; callers do not need
///   privileged APIs to prove the rule being applied.
/// - Refund destination is explicitly provided (`refund_extra_to`) so “gift” flows can return change
///   to the payer or recipient.
/// - Oracle guardrails remain caller-tunable; pass `none` to use defaults.
#[allow(lint(self_transfer))]
public entry fun buy_item_with_discount<TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    discount_template: &mut DiscountTemplate,
    discount_ticket: DiscountTicket,
    price_info_object: &pyth_price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: opt::Option<u64>,
    max_confidence_ratio_bps: opt::Option<u64>,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
) {
    let buyer = tx::sender(ctx);
    let now = now_secs(clock);
    assert_discount_redemption_allowed(discount_template, item_listing, now);
    assert_ticket_matches_context(&discount_ticket, discount_template, item_listing, buyer);

    let discounted_price_usd_cents = apply_discount(
        item_listing.base_price_usd_cents,
        &discount_template.rule,
    );
    let discount_template_id = opt::some(template_address(discount_template));
    let ticket_id = obj::uid_to_address(&discount_ticket.id);
    discount_template.redemptions = discount_template.redemptions + 1;

    process_purchase(
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

    event::emit(DiscountRedeem {
        shop_address: item_listing.shop_address,
        discount_template_id: template_address(discount_template),
        discount_id: ticket_id,
        listing_id: obj::uid_to_address(&item_listing.id),
        buyer,
    });

    remove_discount_claim_if_exists(discount_template, buyer);
    burn_discount_ticket(discount_ticket);
}

/// Claim a discount ticket for the sender and immediately redeem it during checkout within the
/// same PTB.
///
/// Sui mindset:
/// - Reduces front-end friction: callers do not need to manage a temporary `DiscountTicket`
///   transfer between separate transactions or commands.
/// - Emits the same `DiscountClaimed` + `DiscountRedeem` events as the two-step flow so downstream
///   analytics remain consistent.
#[allow(lint(self_transfer))]
public entry fun claim_and_buy_item_with_discount<TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    discount_template: &mut DiscountTemplate,
    price_info_object: &pyth_price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: opt::Option<u64>,
    max_confidence_ratio_bps: opt::Option<u64>,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
) {
    let claimer = tx::sender(ctx);
    let now_secs = now_secs(clock);
    let discount_ticket = claim_discount_ticket_inline(
        discount_template,
        claimer,
        now_secs,
        ctx,
    );

    event::emit(DiscountClaimed {
        shop_address: discount_template.shop_address,
        discount_template_id: template_address(discount_template),
        claimer,
        discount_id: obj::uid_to_address(&discount_ticket.id),
    });

    buy_item_with_discount(
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

// ==== //
// Data //
// ==== //

fun destroy_listing(listing: ItemListing) {
    let ItemListing {
        id,
        shop_address: _,
        item_type: _,
        name: _,
        base_price_usd_cents: _,
        stock: _,
        spotlight_discount_template_id: _,
    } = listing;
    id.delete();
}

fun destroy_accepted_currency(accepted_currency: AcceptedCurrency) {
    let AcceptedCurrency {
        id,
        shop_address: _,
        coin_type: _,
        feed_id: _,
        pyth_object_id: _,
        decimals: _,
        symbol: _,
    } = accepted_currency;
    id.delete();
}

fun new_accepted_currency(
    shop_address: address,
    coin_type: TypeInfo,
    feed_id: vector<u8>,
    pyth_object_id: obj::ID,
    decimals: u8,
    symbol: vector<u8>,
    ctx: &mut tx::TxContext,
): (AcceptedCurrency, address) {
    let accepted_currency: AcceptedCurrency = AcceptedCurrency {
        id: obj::new(ctx),
        shop_address,
        coin_type,
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
    };
    let accepted_currency_address: address = obj::uid_to_address(&accepted_currency.id);

    (accepted_currency, accepted_currency_address)
}

fun new_item_listing<T: store>(
    shop_address: address,
    name: vector<u8>,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_template_id: opt::Option<obj::ID>,
    ctx: &mut tx::TxContext,
): (ItemListing, address) {
    let listing: ItemListing = ItemListing {
        id: obj::new(ctx),
        shop_address,
        item_type: type_name::with_defining_ids<T>(),
        name,
        base_price_usd_cents,
        stock,
        spotlight_discount_template_id,
    };
    let listing_address: address = obj::uid_to_address(&listing.id);
    (listing, listing_address)
}

fun new_discount_template(
    shop_address: address,
    applies_to_listing: opt::Option<obj::ID>,
    rule: DiscountRule,
    starts_at: u64,
    expires_at: opt::Option<u64>,
    max_redemptions: opt::Option<u64>,
    ctx: &mut tx::TxContext,
): (DiscountTemplate, address) {
    let discount_template: DiscountTemplate = DiscountTemplate {
        id: obj::new(ctx),
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

    let discount_template_address: address = obj::uid_to_address(&discount_template.id);
    (discount_template, discount_template_address)
}

fun mew_discount_ticket(
    template: &DiscountTemplate,
    claimer: address,
    ctx: &mut tx::TxContext,
): DiscountTicket {
    DiscountTicket {
        id: obj::new(ctx),
        discount_template_id: template_address(template),
        shop_address: template.shop_address,
        listing_id: template.applies_to_listing,
        owner: claimer,
    }
}

fun record_discount_claim(
    template: &mut DiscountTemplate,
    claimer: address,
    ctx: &mut tx::TxContext,
) {
    // Track issued tickets; actual uses are counted at redemption time.
    template.claims_issued = template.claims_issued + 1;

    dynamic_field::add(
        &mut template.id,
        claimer,
        DiscountClaim {
            id: obj::new(ctx),
            claimer,
        },
    );
}

fun remove_discount_claim_if_exists(template: &mut DiscountTemplate, claimer: address) {
    if (dynamic_field::exists_with_type<address, DiscountClaim>(&template.id, claimer)) {
        let DiscountClaim {
            id,
            claimer: _,
        } = dynamic_field::remove(&mut template.id, claimer);
        id.delete();
    };
}

fun prune_claim_markers(template: &mut DiscountTemplate, claimers: vector<address>) {
    let mut i = 0;
    let total = vec::length(&claimers);
    while (i < total) {
        let claimer = *vec::borrow(&claimers, i);
        remove_discount_claim_if_exists(template, claimer);
        i = i + 1;
    };
}

fun apply_discount_template_updates(
    discount_template: &mut DiscountTemplate,
    discount_rule: DiscountRule,
    starts_at: u64,
    expires_at: opt::Option<u64>,
    max_redemptions: opt::Option<u64>,
) {
    discount_template.rule = discount_rule;
    discount_template.starts_at = starts_at;
    discount_template.expires_at = expires_at;
    discount_template.max_redemptions = max_redemptions;
}

fun remove_currency_field(shop: &mut Shop, coin_type: TypeInfo) {
    dynamic_field::remove_if_exists<TypeInfo, obj::ID>(&mut shop.id, coin_type);
}

fun currency_type<T: store>(): TypeInfo {
    type_name::with_defining_ids<T>()
}

// ======= //
// Helpers //
// ======= //

fun shop_address(shop: &Shop): address {
    obj::uid_to_address(&shop.id)
}

fun unwrap_or_default(value: &opt::Option<u64>, default_value: u64): u64 {
    if (opt::is_some(value)) {
        *opt::borrow(value)
    } else {
        default_value
    }
}

fun process_purchase<TCoin>(
    shop: &Shop,
    item_listing: &mut ItemListing,
    accepted_currency: &AcceptedCurrency,
    price_info_object: &pyth_price_info::PriceInfoObject,
    mut payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    discounted_price_usd_cents: u64,
    discount_template_id: opt::Option<address>,
    max_price_age_secs: opt::Option<u64>,
    max_confidence_ratio_bps: opt::Option<u64>,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
): () {
    assert_listing_currency_match(shop, item_listing, accepted_currency);
    ensure_price_info_matches_currency(accepted_currency, price_info_object);
    ensure_payment_coin_type<TCoin>(accepted_currency);
    assert_stock_available(item_listing);
    let effective_max_age = unwrap_or_default(&max_price_age_secs, DEFAULT_MAX_PRICE_AGE_SECS);
    let effective_confidence_ratio = unwrap_or_default(
        &max_confidence_ratio_bps,
        DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );
    let price: pyth_price::Price = pyth::get_price_no_older_than(
        price_info_object,
        clock,
        effective_max_age,
    );
    let quote_amount: u64 = quote_amount_from_usd_cents(
        discounted_price_usd_cents,
        accepted_currency.decimals,
        &price,
        effective_confidence_ratio,
    );

    pay_shop(&mut payment, quote_amount, shop.owner, ctx);

    let buyer: address = tx::sender(ctx);
    let change_amount = coin::value(&payment);
    refund_or_destroy(payment, refund_extra_to);

    decrement_stock(item_listing);

    event::emit(PurchaseCompleted {
        shop_address: item_listing.shop_address,
        item_listing_address: obj::uid_to_address(&item_listing.id),
        buyer,
        mint_to,
        coin_type: accepted_currency.coin_type,
        amount_paid: quote_amount,
        discount_template_id,
        accepted_currency_id: obj::uid_to_address(&accepted_currency.id),
        feed_id: clone_bytes(&accepted_currency.feed_id),
        base_price_usd_cents: item_listing.base_price_usd_cents,
        discounted_price_usd_cents,
        quote_amount,
    });

    event::emit(ItemListingStockUpdated {
        shop_address: item_listing.shop_address,
        item_listing_address: obj::uid_to_address(&item_listing.id),
        new_stock: item_listing.stock,
    });

    let minted_item_id = mint_and_transfer_item(item_listing, mint_to, clock, ctx);

    event::emit(MintingCompleted {
        shop_address: item_listing.shop_address,
        item_listing_address: obj::uid_to_address(&item_listing.id),
        buyer,
        minted_item_id,
        mint_to,
        refund_to: refund_extra_to,
        change_amount,
        coin_type: accepted_currency.coin_type,
    });
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

fun map_id_option_to_address(source: &opt::Option<obj::ID>): opt::Option<address> {
    if (opt::is_some(source)) {
        opt::some(obj::id_to_address(opt::borrow(source)))
    } else {
        opt::none()
    }
}

fun template_address(template: &DiscountTemplate): address {
    obj::uid_to_address(&template.id)
}

/// Pull current wall-clock seconds from the shared clock to enforce time windows predictably.
fun now_secs(clock: &clock::Clock): u64 {
    clock::timestamp_ms(clock) / 1000
}

fun quote_amount_from_usd_cents(
    usd_cents: u64,
    coin_decimals: u8,
    price: &pyth_price::Price,
    max_confidence_ratio_bps: u64,
): u64 {
    let price_value = pyth_price::get_price(price);
    let mantissa = positive_price_to_u128(&price_value);
    let confidence = as_u128_from_u64(pyth_price::get_conf(price));
    let exponent = pyth_price::get_expo(price);
    let exponent_is_negative = pyth_i64::get_is_negative(&exponent);
    let exponent_magnitude = if (exponent_is_negative) {
        pyth_i64::get_magnitude_if_negative(&exponent)
    } else {
        pyth_i64::get_magnitude_if_positive(&exponent)
    };
    let conservative_mantissa = conservative_price_mantissa(
        mantissa,
        confidence,
        max_confidence_ratio_bps,
    );

    let mut numerator = as_u128_from_u64(usd_cents);
    numerator = numerator * pow10_u128(as_u64_from_u8(coin_decimals));

    if (exponent_is_negative) {
        numerator = numerator * pow10_u128(exponent_magnitude);
    };

    let mut denominator = conservative_mantissa * as_u128_from_u64(CENTS_PER_DOLLAR);
    if (!exponent_is_negative) {
        denominator = denominator * pow10_u128(exponent_magnitude);
    };

    let amount = ceil_div_u128(numerator, denominator);
    let maybe_amount = u128::try_as_u64(amount);
    assert!(opt::is_some(&maybe_amount), EPriceOverflow);
    opt::destroy_some(maybe_amount)
}

fun pow10_u128(exponent: u64): u128 {
    assert!(exponent <= MAX_DECIMAL_POWER, EPriceOverflow);
    let pow10_table = POW10_U128;
    *vec::borrow(&pow10_table, exponent)
}

fun ceil_div_u128(numerator: u128, denominator: u128): u128 {
    let quotient = numerator / denominator;
    if (numerator % denominator == 0) {
        quotient
    } else {
        quotient + 1
    }
}

fun positive_price_to_u128(value: &pyth_i64::I64): u128 {
    assert!(!pyth_i64::get_is_negative(value), EPriceNonPositive);
    as_u128_from_u64(pyth_i64::get_magnitude_if_positive(value))
}

/// Apply μ-σ per Pyth best practices to avoid undercharging when prices are uncertain.
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

fun pay_shop<TCoin>(
    payment: &mut coin::Coin<TCoin>,
    amount_due: u64,
    owner: address,
    ctx: &mut tx::TxContext,
) {
    if (amount_due == 0) {
        return
    };

    let available = coin::value(payment);
    assert!(available >= amount_due, EInsufficientPayment);
    let owed = coin::split(payment, amount_due, ctx);
    txf::public_transfer(owed, owner);
}

fun refund_or_destroy<TCoin>(payment: coin::Coin<TCoin>, recipient: address) {
    if (coin::value(&payment) == 0) {
        coin::destroy_zero(payment);
    } else {
        txf::public_transfer(payment, recipient);
    };
}

fun decrement_stock(item_listing: &mut ItemListing) {
    item_listing.stock = item_listing.stock - 1;
}

fun mint_shop_item(
    item_listing: &ItemListing,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
): ShopItem {
    ShopItem {
        id: obj::new(ctx),
        shop_address: item_listing.shop_address,
        item_listing_address: obj::uid_to_address(&item_listing.id),
        item_type: item_listing.item_type,
        name: clone_bytes(&item_listing.name),
        acquired_at: now_secs(clock),
    }
}

fun mint_and_transfer_item(
    item_listing: &ItemListing,
    mint_to: address,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
): address {
    // Receipts are a single generic type that carries the original listing type for UIs/analytics.
    let item = mint_shop_item(item_listing, clock, ctx);
    let item_address = obj::uid_to_address(&item.id);
    txf::public_transfer(item, mint_to);
    item_address
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
            let discounted = product / as_u128_from_u64(BASIS_POINT_DENOMINATOR);
            let maybe_discounted = u128::try_as_u64(discounted);
            assert!(opt::is_some(&maybe_discounted), EPriceOverflow);
            opt::destroy_some(maybe_discounted)
        },
    }
}

fun burn_discount_ticket(discount_ticket: DiscountTicket) {
    let DiscountTicket {
        id,
        discount_template_id: _,
        shop_address: _,
        listing_id: _,
        owner: _,
    } = discount_ticket;
    id.delete();
}

fun bytes_equal(left: &vector<u8>, right: &vector<u8>): bool {
    if (vec::length(left) != vec::length(right)) {
        return false
    };
    let mut i: u64 = 0;
    let len = vec::length(left);
    while (i < len) {
        if (*vec::borrow(left, i) != *vec::borrow(right, i)) {
            return false
        };
        i = i + 1;
    };
    true
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

// ======================= //
// Asserts and validations //
// ======================= //

fun assert_owner_cap(shop: &Shop, owner_cap: &ShopOwnerCap) {
    assert!(owner_cap.shop_address == obj::uid_to_address(&shop.id), EInvalidOwnerCap);
}

fun assert_non_zero_stock(stock: u64) {
    assert!(stock > 0, EZeroStock)
}

fun assert_stock_available(item_listing: &ItemListing) {
    assert!(item_listing.stock > 0, EOutOfStock);
}

fun assert_schedule(starts_at: u64, expires_at: &opt::Option<u64>) {
    if (opt::is_some(expires_at)) {
        assert!(*opt::borrow(expires_at) > starts_at, ETemplateWindow);
    }
}

fun validate_listing_inputs(
    shop: &Shop,
    name: &vector<u8>,
    base_price_usd_cents: u64,
    stock: u64,
    spotlight_discount_template_id: &opt::Option<obj::ID>,
) {
    assert_non_zero_stock(stock);
    assert!(!vec::is_empty(name), EEmptyItemName);
    assert!(base_price_usd_cents > 0, EInvalidPrice);

    validate_belongs_to_shop_if_some(
        ReferenceKind::Template,
        shop,
        spotlight_discount_template_id,
    );
}

fun validate_discount_template_inputs(
    shop: &Shop,
    applies_to_listing: &opt::Option<obj::ID>,
    starts_at: u64,
    expires_at: &opt::Option<u64>,
) {
    assert_schedule(starts_at, expires_at);
    validate_belongs_to_shop_if_some(ReferenceKind::Listing, shop, applies_to_listing);
}

fun assert_template_prunable(template: &DiscountTemplate, now: u64) {
    let expired =
        opt::is_some(&template.expires_at)
        && now >= *opt::borrow(&template.expires_at);
    let maxed_out = if (opt::is_some(&template.max_redemptions)) {
        let max_redemptions = *opt::borrow(&template.max_redemptions);
        (template.claims_issued >= max_redemptions) || (template.redemptions >= max_redemptions)
    } else {
        false
    };
    assert!(!template.active || expired || maxed_out, EDiscountClaimsNotPrunable);
}

fun assert_discount_redemption_allowed(
    discount_template: &DiscountTemplate,
    item_listing: &ItemListing,
    now: u64,
) {
    assert!(discount_template.active, ETemplateInactive);
    assert!(discount_template.shop_address == item_listing.shop_address, EDiscountShopMismatch);
    let applies_to = map_id_option_to_address(&discount_template.applies_to_listing);
    if (opt::is_some(&applies_to)) {
        assert!(
            *opt::borrow(&applies_to) == obj::uid_to_address(&item_listing.id),
            EDiscountTicketListingMismatch,
        );
    };
    assert!(discount_template.starts_at <= now, ETemplateTooEarly);
    if (opt::is_some(&discount_template.expires_at)) {
        assert!(now < *opt::borrow(&discount_template.expires_at), ETemplateExpired);
    };
    if (opt::is_some(&discount_template.max_redemptions)) {
        assert!(
            discount_template.redemptions < *opt::borrow(&discount_template.max_redemptions),
            ETemplateMaxedOut,
        );
    };
}

fun assert_ticket_matches_context(
    discount_ticket: &DiscountTicket,
    discount_template: &DiscountTemplate,
    item_listing: &ItemListing,
    buyer: address,
) {
    assert!(discount_ticket.shop_address == item_listing.shop_address, EDiscountTicketShopMismatch);
    assert!(
        discount_ticket.discount_template_id == template_address(discount_template),
        EDiscountTicketMismatch,
    );
    assert!(discount_ticket.owner == buyer, EDiscountTicketOwnerMismatch);
    let applies_to_listing = map_id_option_to_address(&discount_ticket.listing_id);
    if (opt::is_some(&applies_to_listing)) {
        assert!(
            *opt::borrow(&applies_to_listing) == obj::uid_to_address(&item_listing.id),
            EDiscountTicketListingMismatch,
        );
    };
}

fun validate_accepted_currency_inputs(
    shop: &Shop,
    coin_type: &TypeInfo,
    feed_id: &vector<u8>,
    pyth_object_id: &obj::ID,
    price_info_object: &pyth_price_info::PriceInfoObject,
) {
    assert_currency_not_registered(shop, coin_type);
    assert_valid_feed_id(feed_id);
    assert_valid_price_feed_registration(feed_id, pyth_object_id, price_info_object);
}

fun assert_valid_feed_id(feed_id: &vector<u8>) {
    assert!(!vec::is_empty(feed_id), EEmptyFeedId);
    assert!(vec::length(feed_id) == PYTH_PRICE_IDENTIFIER_LENGTH, EInvalidFeedIdLength);
}

fun assert_valid_price_feed_registration(
    feed_id: &vector<u8>,
    pyth_object_id: &obj::ID,
    price_info_object: &pyth_price_info::PriceInfoObject,
) {
    let expected_object_id = pyth_price_info::uid_to_inner(price_info_object);
    assert!(expected_object_id == *pyth_object_id, EPythObjectMismatch);

    let price_info = pyth_price_info::get_price_info_from_price_info_object(price_info_object);
    let identifier = pyth_price_info::get_price_identifier(&price_info);
    let identifier_bytes = pyth_price_identifier::get_bytes(&identifier);
    assert!(bytes_equal(feed_id, &identifier_bytes), EFeedIdentifierMismatch);
}

fun assert_currency_not_registered(shop: &Shop, coin_type: &TypeInfo) {
    assert!(!dynamic_field::exists_<TypeInfo>(&shop.id, *coin_type), EAcceptedCurrencyExists);
}

fun assert_accepted_currency_exists(shop: &Shop, accepted_currency_id: obj::ID) {
    assert!(
        dynamic_field::exists_with_type<obj::ID, AcceptedCurrency>(&shop.id, accepted_currency_id),
        EAcceptedCurrencyMissing,
    );
}

fun assert_listing_currency_match(
    shop: &Shop,
    item_listing: &ItemListing,
    accepted_currency: &AcceptedCurrency,
) {
    assert!(item_listing.shop_address == shop_address(shop), EListingShopMismatch);
    assert!(item_listing.shop_address == accepted_currency.shop_address, ECurrencyListingMismatch);
}

fun ensure_price_info_matches_currency(
    accepted_currency: &AcceptedCurrency,
    price_info_object: &pyth_price_info::PriceInfoObject,
) {
    let expected_price_object = obj::id_to_address(&accepted_currency.pyth_object_id);
    let provided_object = obj::id_to_address(&pyth_price_info::uid_to_inner(price_info_object));
    assert!(expected_price_object == provided_object, EPythObjectMismatch);

    let price_info = pyth_price_info::get_price_info_from_price_info_object(price_info_object);
    let identifier = pyth_price_info::get_price_identifier(&price_info);
    let identifier_bytes = pyth_price_identifier::get_bytes(&identifier);
    assert!(bytes_equal(&accepted_currency.feed_id, &identifier_bytes), EFeedIdentifierMismatch);
}

fun ensure_payment_coin_type<TCoin>(accepted_currency: &AcceptedCurrency) {
    let payment_type = type_name::with_defining_ids<TCoin>();
    assert!(accepted_currency.coin_type == payment_type, EInvalidPaymentCoinType);
}

fun assert_template_belongs_to_shop(shop: &Shop, discount_template_id: obj::ID) {
    assert!(dynamic_field::exists_<obj::ID>(&shop.id, discount_template_id), ETemplateShopMismatch);
    let template: &DiscountTemplate = dynamic_field::borrow(&shop.id, discount_template_id);
    assert!(template.shop_address == obj::uid_to_address(&shop.id), ETemplateShopMismatch);
}

fun assert_listing_belongs_to_shop(shop: &Shop, listing_id: obj::ID) {
    assert!(dynamic_field::exists_<obj::ID>(&shop.id, listing_id), EListingShopMismatch);
    let listing: &ItemListing = dynamic_field::borrow(&shop.id, listing_id);
    assert!(listing.shop_address == obj::uid_to_address(&shop.id), EListingShopMismatch);
}

/// Internal selector for which reference to validate.
public enum ReferenceKind has copy, drop {
    Template,
    Listing,
}

fun validate_belongs_to_shop_if_some(
    kind: ReferenceKind,
    shop: &Shop,
    maybe_id: &opt::Option<obj::ID>,
) {
    if (opt::is_some(maybe_id)) {
        let id = *opt::borrow(maybe_id);
        match (kind) {
            ReferenceKind::Template => assert_template_belongs_to_shop(shop, id),
            ReferenceKind::Listing => assert_listing_belongs_to_shop(shop, id),
        };
    };
}

fun assert_spotlight_template_matches_listing(
    shop: &Shop,
    listing_address: address,
    discount_template_id: &opt::Option<obj::ID>,
) {
    if (opt::is_some(discount_template_id)) {
        let template_id = *opt::borrow(discount_template_id);
        let template: &DiscountTemplate = dynamic_field::borrow(&shop.id, template_id);
        let applies_to_listing = map_id_option_to_address(&template.applies_to_listing);
        if (opt::is_some(&applies_to_listing)) {
            assert!(
                *opt::borrow(&applies_to_listing) == listing_address,
                ESpotlightTemplateListingMismatch,
            );
        };
    };
}

/// Guardrails to keep claims inside schedule/limits and unique per address.
fun assert_template_claimable(template: &DiscountTemplate, claimer: address, now_secs: u64) {
    assert!(template.active, ETemplateInactive);
    assert!(template.starts_at <= now_secs, ETemplateTooEarly);

    if (opt::is_some(&template.expires_at)) {
        assert!(now_secs < *opt::borrow(&template.expires_at), ETemplateExpired);
    };

    if (opt::is_some(&template.max_redemptions)) {
        let max_redemptions = *opt::borrow(&template.max_redemptions);
        assert!(template.claims_issued < max_redemptions, ETemplateMaxedOut);
        assert!(template.redemptions < max_redemptions, ETemplateMaxedOut);
    };

    assert!(
        !dynamic_field::exists_with_type<address, DiscountClaim>(&template.id, claimer),
        EDiscountAlreadyClaimed,
    );
}

///================///
/// View helpers   ///
///================///

#[ext(view)]
public fun listing_exists(shop: &Shop, listing_id: obj::ID): bool {
    dynamic_field::exists_with_type<obj::ID, ItemListing>(&shop.id, listing_id)
}

#[ext(view)]
public fun discount_template_exists(shop: &Shop, template_id: obj::ID): bool {
    dynamic_field::exists_with_type<obj::ID, DiscountTemplate>(&shop.id, template_id)
}

#[ext(view)]
public fun accepted_currency_exists(shop: &Shop, accepted_currency_id: obj::ID): bool {
    dynamic_field::exists_with_type<obj::ID, AcceptedCurrency>(&shop.id, accepted_currency_id)
}

#[ext(view)]
public fun accepted_currency_id_for_type(shop: &Shop, coin_type: TypeInfo): opt::Option<obj::ID> {
    if (dynamic_field::exists_with_type<TypeInfo, obj::ID>(&shop.id, coin_type)) {
        opt::some(*dynamic_field::borrow<TypeInfo, obj::ID>(&shop.id, coin_type))
    } else {
        opt::none()
    }
}

#[ext(view)]
public fun listing_id_for_address(shop: &Shop, listing_address: address): opt::Option<obj::ID> {
    let listing_id = obj::id_from_address(listing_address);
    if (listing_exists(shop, listing_id)) {
        opt::some(listing_id)
    } else {
        opt::none()
    }
}

#[ext(view)]
public fun discount_template_id_for_address(
    shop: &Shop,
    template_address: address,
): opt::Option<obj::ID> {
    let template_id = obj::id_from_address(template_address);
    if (discount_template_exists(shop, template_id)) {
        opt::some(template_id)
    } else {
        opt::none()
    }
}

#[ext(view)]
public fun listing_values(
    shop: &Shop,
    listing_id: obj::ID,
): (vector<u8>, u64, u64, address, opt::Option<obj::ID>) {
    assert_listing_belongs_to_shop(shop, listing_id);
    let listing: &ItemListing = dynamic_field::borrow(&shop.id, listing_id);
    (
        clone_bytes(&listing.name),
        listing.base_price_usd_cents,
        listing.stock,
        listing.shop_address,
        listing.spotlight_discount_template_id,
    )
}

#[ext(view)]
public fun accepted_currency_values(
    shop: &Shop,
    accepted_currency_id: obj::ID,
): (address, TypeInfo, vector<u8>, obj::ID, u8, vector<u8>) {
    assert_accepted_currency_exists(shop, accepted_currency_id);
    let accepted_currency: &AcceptedCurrency = dynamic_field::borrow(
        &shop.id,
        accepted_currency_id,
    );
    (
        accepted_currency.shop_address,
        accepted_currency.coin_type,
        clone_bytes(&accepted_currency.feed_id),
        accepted_currency.pyth_object_id,
        accepted_currency.decimals,
        clone_bytes(&accepted_currency.symbol),
    )
}

#[ext(view)]
public fun discount_template_values(
    shop: &Shop,
    template_id: obj::ID,
): (
    address,
    opt::Option<obj::ID>,
    DiscountRule,
    u64,
    opt::Option<u64>,
    opt::Option<u64>,
    u64,
    u64,
    bool,
) {
    assert_template_belongs_to_shop(shop, template_id);
    let template: &DiscountTemplate = dynamic_field::borrow(&shop.id, template_id);
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

#[ext(view)]
public fun quote_amount_for_price_info_object(
    shop: &Shop,
    accepted_currency_id: obj::ID,
    price_info_object: &pyth_price_info::PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: opt::Option<u64>,
    max_confidence_ratio_bps: opt::Option<u64>,
    clock: &clock::Clock,
): u64 {
    assert_accepted_currency_exists(shop, accepted_currency_id);
    let accepted_currency: &AcceptedCurrency = dynamic_field::borrow(
        &shop.id,
        accepted_currency_id,
    );
    ensure_price_info_matches_currency(accepted_currency, price_info_object);
    let effective_max_age = unwrap_or_default(&max_price_age_secs, DEFAULT_MAX_PRICE_AGE_SECS);
    let effective_confidence_ratio = unwrap_or_default(
        &max_confidence_ratio_bps,
        DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );
    let price: pyth_price::Price = pyth::get_price_no_older_than(
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

///==================///
/// #[test_only] API ///
///==================///

fun clone_bytes(data: &vector<u8>): vector<u8> {
    let mut out: vector<u8> = vec::empty();
    let mut i: u64 = 0;
    let len: u64 = vec::length(data);
    while (i < len) {
        vec::push_back(&mut out, *vec::borrow(data, i));
        i = i + 1;
    };
    out
}

#[test_only]
public struct TestPublisherOTW has drop {}

#[test_only]
public fun test_claim_publisher(ctx: &mut tx::TxContext): pkg::Publisher {
    pkg::test_claim<TestPublisherOTW>(TestPublisherOTW {}, ctx)
}

#[test_only]
public fun test_destroy_publisher(publisher: pkg::Publisher) {
    pkg::burn_publisher(publisher);
}

#[test_only]
public fun test_setup_shop(owner: address, ctx: &mut tx::TxContext): (Shop, ShopOwnerCap) {
    let shop = Shop {
        id: obj::new(ctx),
        owner,
    };
    let owner_cap = ShopOwnerCap {
        id: obj::new(ctx),
        shop_address: obj::uid_to_address(&shop.id),
        owner,
    };
    (shop, owner_cap)
}

#[test_only]
public fun test_quote_amount_from_usd_cents(
    usd_cents: u64,
    coin_decimals: u8,
    price: &pyth_price::Price,
    max_confidence_ratio_bps: u64,
): u64 {
    quote_amount_from_usd_cents(usd_cents, coin_decimals, price, max_confidence_ratio_bps)
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
public fun test_listing_values(
    shop: &Shop,
    listing_id: obj::ID,
): (vector<u8>, u64, u64, address, opt::Option<obj::ID>) {
    listing_values(shop, listing_id)
}

#[test_only]
public fun test_listing_exists(shop: &Shop, listing_id: obj::ID): bool {
    listing_exists(shop, listing_id)
}

#[test_only]
public fun test_accepted_currency_exists(shop: &Shop, accepted_currency_id: obj::ID): bool {
    accepted_currency_exists(shop, accepted_currency_id)
}

#[test_only]
public fun test_accepted_currency_values(
    shop: &Shop,
    accepted_currency_id: obj::ID,
): (address, TypeInfo, vector<u8>, obj::ID, u8, vector<u8>) {
    accepted_currency_values(shop, accepted_currency_id)
}

#[test_only]
public fun test_accepted_currency_id_for_type(shop: &Shop, coin_type: TypeInfo): obj::ID {
    opt::destroy_some(accepted_currency_id_for_type(shop, coin_type))
}

#[test_only]
public fun test_discount_template_exists(shop: &Shop, template_id: obj::ID): bool {
    discount_template_exists(shop, template_id)
}

#[test_only]
public fun test_set_template_redemptions(shop: &mut Shop, template_id: obj::ID, value: u64) {
    let template: &mut DiscountTemplate = dynamic_field::borrow_mut(&mut shop.id, template_id);
    template.redemptions = value;
}

#[test_only]
public fun test_discount_template_values(
    shop: &Shop,
    template_id: obj::ID,
): (
    address,
    opt::Option<obj::ID>,
    DiscountRule,
    u64,
    opt::Option<u64>,
    opt::Option<u64>,
    u64,
    u64,
    bool,
) {
    discount_template_values(shop, template_id)
}

#[test_only]
public fun test_discount_claim_exists(shop: &Shop, template_id: obj::ID, claimer: address): bool {
    let template: &DiscountTemplate = dynamic_field::borrow(&shop.id, template_id);
    dynamic_field::exists_with_type<address, DiscountClaim>(&template.id, claimer)
}

#[test_only]
public fun test_claim_discount_ticket(
    shop: &mut Shop,
    template_id: obj::ID,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
): () {
    let discount_template: &mut DiscountTemplate = dynamic_field::borrow_mut(
        &mut shop.id,
        template_id,
    );
    claim_discount_ticket(discount_template, clock, ctx)
}

#[test_only]
public fun test_claim_discount_ticket_inline(
    shop: &mut Shop,
    template_id: obj::ID,
    claimer: address,
    now_secs: u64,
    ctx: &mut tx::TxContext,
): DiscountTicket {
    let template: &mut DiscountTemplate = dynamic_field::borrow_mut(&mut shop.id, template_id);
    claim_discount_ticket_inline(template, claimer, now_secs, ctx)
}

#[test_only]
public fun test_claim_and_buy_item_with_discount_ids<TCoin>(
    shop: &mut Shop,
    listing_id: obj::ID,
    accepted_currency_id: obj::ID,
    template_id: obj::ID,
    price_info_object: &pyth_price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: opt::Option<u64>,
    max_confidence_ratio_bps: opt::Option<u64>,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
): () {
    let accepted_currency: AcceptedCurrency = dynamic_field::remove(
        &mut shop.id,
        accepted_currency_id,
    );
    let mut listing: ItemListing = dynamic_field::remove(&mut shop.id, listing_id);
    let mut template: DiscountTemplate = dynamic_field::remove(&mut shop.id, template_id);

    claim_and_buy_item_with_discount(
        shop,
        &mut listing,
        &accepted_currency,
        &mut template,
        price_info_object,
        payment,
        mint_to,
        refund_extra_to,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );

    dynamic_field::add(&mut shop.id, listing_id, listing);
    dynamic_field::add(&mut shop.id, accepted_currency_id, accepted_currency);
    dynamic_field::add(&mut shop.id, template_id, template);
}

#[test_only]
public fun test_buy_item_with_discount_ids<TCoin>(
    shop: &mut Shop,
    listing_id: obj::ID,
    accepted_currency_id: obj::ID,
    template_id: obj::ID,
    ticket: DiscountTicket,
    price_info_object: &pyth_price_info::PriceInfoObject,
    payment: coin::Coin<TCoin>,
    mint_to: address,
    refund_extra_to: address,
    max_price_age_secs: opt::Option<u64>,
    max_confidence_ratio_bps: opt::Option<u64>,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
): () {
    let accepted_currency: AcceptedCurrency = dynamic_field::remove(
        &mut shop.id,
        accepted_currency_id,
    );
    let mut listing: ItemListing = dynamic_field::remove(&mut shop.id, listing_id);
    let mut template: DiscountTemplate = dynamic_field::remove(&mut shop.id, template_id);

    buy_item_with_discount(
        shop,
        &mut listing,
        &accepted_currency,
        &mut template,
        ticket,
        price_info_object,
        payment,
        mint_to,
        refund_extra_to,
        max_price_age_secs,
        max_confidence_ratio_bps,
        clock,
        ctx,
    );

    dynamic_field::add(&mut shop.id, listing_id, listing);
    dynamic_field::add(&mut shop.id, accepted_currency_id, accepted_currency);
    dynamic_field::add(&mut shop.id, template_id, template);
}

#[test_only]
public fun test_discount_rule_kind(rule: DiscountRule): u8 {
    match (rule) {
        DiscountRule::Fixed { amount_cents: _ } => 0,
        DiscountRule::Percent { bps: _ } => 1,
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
public fun test_discount_template_created_shop(event: &DiscountTemplateCreated): address {
    event.shop_address
}

#[test_only]
public fun test_discount_template_created_id(event: &DiscountTemplateCreated): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_template_created_rule(event: &DiscountTemplateCreated): DiscountRule {
    event.rule
}

#[test_only]
public fun test_discount_template_updated_shop(event: &DiscountTemplateUpdated): address {
    event.shop_address
}

#[test_only]
public fun test_discount_template_updated_id(event: &DiscountTemplateUpdated): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_template_toggled_shop(event: &DiscountTemplateToggled): address {
    event.shop_address
}

#[test_only]
public fun test_discount_template_toggled_id(event: &DiscountTemplateToggled): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_template_toggled_active(event: &DiscountTemplateToggled): bool {
    event.active
}

#[test_only]
public fun test_discount_redeem_template_id(event: &DiscountRedeem): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_redeem_listing_id(event: &DiscountRedeem): address {
    event.listing_id
}

#[test_only]
public fun test_discount_redeem_buyer(event: &DiscountRedeem): address {
    event.buyer
}

#[test_only]
public fun test_purchase_completed_discount_template_id(
    event: &PurchaseCompleted,
): opt::Option<address> {
    event.discount_template_id
}

#[test_only]
public fun test_purchase_completed_base_price(event: &PurchaseCompleted): u64 {
    event.base_price_usd_cents
}

#[test_only]
public fun test_purchase_completed_discounted_price(event: &PurchaseCompleted): u64 {
    event.discounted_price_usd_cents
}

#[test_only]
public fun test_discount_claimed_shop(event: &DiscountClaimed): address {
    event.shop_address
}

#[test_only]
public fun test_discount_claimed_template_id(event: &DiscountClaimed): address {
    event.discount_template_id
}

#[test_only]
public fun test_discount_claimed_claimer(event: &DiscountClaimed): address {
    event.claimer
}

#[test_only]
public fun test_discount_claimed_discount_id(event: &DiscountClaimed): address {
    event.discount_id
}

#[test_only]
public fun test_discount_ticket_id(ticket: &DiscountTicket): address {
    obj::uid_to_address(&ticket.id)
}

#[test_only]
public fun test_discount_ticket_values(
    ticket: &DiscountTicket,
): (address, address, opt::Option<obj::ID>, address) {
    (ticket.discount_template_id, ticket.shop_address, ticket.listing_id, ticket.owner)
}

#[test_only]
public fun test_destroy_discount_ticket(ticket: DiscountTicket) {
    let DiscountTicket {
        id,
        discount_template_id: _,
        shop_address: _,
        listing_id: _,
        owner: _,
    } = ticket;
    id.delete();
}

#[test_only]
public fun test_last_created_id(ctx: &tx::TxContext): obj::ID {
    obj::id_from_address(tx::last_created_object_id(ctx))
}

#[test_only]
public fun test_remove_listing(shop: &mut Shop, listing_id: obj::ID) {
    let listing = dynamic_field::remove(&mut shop.id, listing_id);
    destroy_listing(listing);
}

#[test_only]
public fun test_remove_template(shop: &mut Shop, template_id: obj::ID) {
    let template: DiscountTemplate = dynamic_field::remove(&mut shop.id, template_id);
    destroy_template(template);
}

#[test_only]
public fun test_destroy_shop(shop: Shop) {
    let Shop { id, owner: _ } = shop;
    obj::delete(id);
}

#[test_only]
public fun test_destroy_owner_cap(owner_cap: ShopOwnerCap) {
    let ShopOwnerCap {
        id,
        shop_address: _,
        owner: _,
    } = owner_cap;
    obj::delete(id);
}

#[test_only]
public fun test_shop_id(shop: &Shop): address {
    obj::uid_to_address(&shop.id)
}

#[test_only]
public fun test_shop_owner(shop: &Shop): address {
    shop.owner
}

#[test_only]
public fun test_shop_owner_cap_owner(owner_cap: &ShopOwnerCap): address {
    owner_cap.owner
}

#[test_only]
public fun test_shop_owner_cap_id(owner_cap: &ShopOwnerCap): address {
    obj::uid_to_address(&owner_cap.id)
}

#[test_only]
public fun test_shop_owner_cap_shop_address(owner_cap: &ShopOwnerCap): address {
    owner_cap.shop_address
}

#[test_only]
public fun test_shop_created_owner(event: &ShopCreated): address {
    event.owner
}

#[test_only]
public fun test_shop_created_owner_cap_id(event: &ShopCreated): address {
    event.shop_owner_cap_id
}

#[test_only]
public fun test_shop_created_shop_address(event: &ShopCreated): address {
    event.shop_address
}

#[test_only]
public fun test_shop_owner_updated_shop(event: &ShopOwnerUpdated): address {
    event.shop_address
}

#[test_only]
public fun test_shop_owner_updated_previous(event: &ShopOwnerUpdated): address {
    event.previous_owner
}

#[test_only]
public fun test_shop_owner_updated_new(event: &ShopOwnerUpdated): address {
    event.new_owner
}

#[test_only]
public fun test_shop_owner_updated_cap_id(event: &ShopOwnerUpdated): address {
    event.shop_owner_cap_id
}

#[test_only]
public fun test_shop_owner_updated_rotated_by(event: &ShopOwnerUpdated): address {
    event.rotated_by
}

#[test_only]
public fun test_item_listing_stock_updated_shop(event: &ItemListingStockUpdated): address {
    event.shop_address
}

#[test_only]
public fun test_item_listing_stock_updated_listing(event: &ItemListingStockUpdated): address {
    event.item_listing_address
}

#[test_only]
public fun test_item_listing_stock_updated_new_stock(event: &ItemListingStockUpdated): u64 {
    event.new_stock
}

#[test_only]
public fun test_item_listing_added_shop(event: &ItemListingAdded): address {
    event.shop_address
}

#[test_only]
public fun test_item_listing_added_listing(event: &ItemListingAdded): address {
    event.item_listing_address
}

#[test_only]
public fun test_item_listing_added_name(event: &ItemListingAdded): vector<u8> {
    clone_bytes(&event.name)
}

#[test_only]
public fun test_item_listing_added_base_price_usd_cents(event: &ItemListingAdded): u64 {
    event.base_price_usd_cents
}

#[test_only]
public fun test_item_listing_added_spotlight_template(
    event: &ItemListingAdded,
): opt::Option<address> {
    event.spotlight_discount_template_id
}

#[test_only]
public fun test_item_listing_added_stock(event: &ItemListingAdded): u64 {
    event.stock
}

#[test_only]
public fun test_item_listing_removed_shop(event: &ItemListingRemoved): address {
    event.shop_address
}

#[test_only]
public fun test_item_listing_removed_listing(event: &ItemListingRemoved): address {
    event.item_listing_address
}

#[test_only]
public fun test_accepted_coin_added_shop(event: &AcceptedCoinAdded): address {
    event.shop_address
}

#[test_only]
public fun test_accepted_coin_added_coin_type(event: &AcceptedCoinAdded): TypeInfo {
    event.coin_type
}

#[test_only]
public fun test_accepted_coin_added_feed_id(event: &AcceptedCoinAdded): vector<u8> {
    clone_bytes(&event.feed_id)
}

#[test_only]
public fun test_accepted_coin_added_pyth_object_id(event: &AcceptedCoinAdded): obj::ID {
    event.pyth_object_id
}

#[test_only]
public fun test_accepted_coin_added_decimals(event: &AcceptedCoinAdded): u8 {
    event.decimals
}

#[test_only]
public fun test_accepted_coin_removed_shop(event: &AcceptedCoinRemoved): address {
    event.shop_address
}

#[test_only]
public fun test_accepted_coin_removed_coin_type(event: &AcceptedCoinRemoved): TypeInfo {
    event.coin_type
}

#[test_only]
fun destroy_template(template: DiscountTemplate) {
    let DiscountTemplate {
        id,
        shop_address: _,
        applies_to_listing: _,
        rule: _,
        starts_at: _,
        expires_at: _,
        max_redemptions: _,
        claims_issued: _,
        redemptions: _,
        active: _,
    } = template;
    id.delete();
}
