#[allow(lint(public_entry), unused_field)]
module sui_oracle_market::shop;

use std::option as opt;
use std::string as string;
use std::type_name::{Self as type_name, TypeName as TypeInfo};
use std::vector as vec;
use sui::clock;
use sui::coin_registry as registry;
use sui::dynamic_field;
use sui::event;
use sui::object as obj;
use sui::package as pkg;
use sui::transfer as txf;
use sui::tx_context as tx;

///=========///
/// Errors ///
///=========///
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
const ETemplateInactive: u64 = 14;
const ETemplateTooEarly: u64 = 15;
const ETemplateExpired: u64 = 16;
const ETemplateMaxedOut: u64 = 17;
const EDiscountAlreadyClaimed: u64 = 18;

///====================///
/// Capability & Core ///
///====================///

/// Capability that proves the caller can administer a specific `Shop`.
/// Holding and using this object is the Sui-native equivalent of matching `onlyOwner` criteria in Solidity.
public struct ShopOwnerCap has key, store {
    id: obj::UID,
    shop_address: address,
    owner: address,
}

/// Shared shop that stores item listings to sell, accepted currencies, and discount templates via dynamic fields.
public struct Shop has key, store {
    id: obj::UID,
    owner: address,
}

/// Item listing metadata keyed under the shared `Shop`, will be using to mint specific items on purchase.
/// Discounts can be attached to highlight promotions in the UI.
public struct ItemListing has key, store {
    id: obj::UID,
    shop_address: address,
    item_type: TypeInfo,
    name: vector<u8>,
    base_price_usd: u64,
    stock: u64,
    spotlight_discount_template_id: opt::Option<obj::ID>,
}

/// Generic item type for receipts.
public struct GenericItem has key, store {
    id: obj::UID,
    shop_address: address,
    item_listing_address: address,
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

/// Discount rules mirror the spec: fixed or percentage basis points off.
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
    minted_discounts: u64,
    active: bool,
}

/// Discount ticket that future buyers will redeem to later use during purchase flow.
public struct DiscountTicket has key, store {
    id: obj::UID,
    discount_template_id: address,
    shop_address: address,
    listing_id: opt::Option<obj::ID>,
    owner: address,
    redeemed: bool,
}

/// Tracks which addresses already claimed a discount from a template.
public struct DiscountClaim has key, store {
    id: obj::UID,
    claimer: address,
}

/// Auto discount configuration (to be consumed by future purchase flow).
public struct AutoDiscount has store {
    rule: DiscountRule,
    starts_at: u64,
    expires_at: opt::Option<u64>,
}

///====================///
/// Event Definitions ///
///====================///
public struct ShopCreated has copy, drop {
    shop_address: address,
    owner: address,
    shop_owner_cap_id: address,
}

public struct ItemListingAdded has copy, drop {
    shop_address: address,
    item_listing_address: address,
    name: vector<u8>,
    base_price_usd: u64,
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
    coin_type: TypeInfo,
    amount_paid: u64,
    discount_template_id: opt::Option<address>,
}

public struct PriceUsed has copy, drop {
    shop_address: address,
    accepted_currency_id: address,
    feed_id: vector<u8>,
    base_price_usd: u64,
    discounted_price_usd: u64,
    quote_amount: u64,
    discount_template_id: opt::Option<address>,
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
/// * Ownership does not comes from `msg.sender` instead they comes from explicit capability objects,
/// here a ShopOwnerCap that will be minted as an object that will later be used to access specific functions.
/// * Application state is modeled as shareable objects, not contract storage.
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

/// * Item Listing * ///

/// Add an ItemListing attached to the Shop. The generic `T` encodes what will eventually be minted
/// when a buyer completes checkout.
///
/// Sui mindset:
/// * For access control, we are not using modifier like `onlyOwner`,
/// instead we require the ShopOwnerCap object that was minted on shop creation to be passed in the function itself.
/// * Dynamic fields let each listing live inside its own child object,
/// so different listings can be updated or sold in parallel without accessing a single shared Shop,
/// this allows better concurrency and throughput that would not been possible if each buyer would have to write to the same store object one by one.
public entry fun add_item_listing<T: store>(
    shop: &mut Shop,
    name: vector<u8>,
    base_price_usd: u64,
    stock: u64,
    spotlight_discount_template_id: opt::Option<obj::ID>,
    owner_cap: &ShopOwnerCap,
    ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    validate_listing_inputs(shop, &name, base_price_usd, stock, &spotlight_discount_template_id);

    let shop_address: address = shop_address(shop);
    let (listing, listing_address) = new_item_listing<T>(
        shop_address,
        name,
        base_price_usd,
        stock,
        spotlight_discount_template_id,
        ctx,
    );

    event::emit(ItemListingAdded {
        shop_address,
        item_listing_address: listing_address,
        name: listing.name,
        base_price_usd: listing.base_price_usd,
        spotlight_discount_template_id: map_id_option_to_address(
            &listing.spotlight_discount_template_id,
        ),
        stock,
    });

    dynamic_field::add(&mut shop.id, obj::id_from_address(listing_address), listing);
}

/// Update the inventory count for a listing.
///
/// We mutate the child object in-place which keeps PTBs or Programmable Transaction Blocks
/// deterministic since only the listing being changed is locked for consensus, not the full shop.
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
/// * State mutation happens on owned objects. There’s no global contract storage like Solidity’s mapping.
/// In this example Inventory lives in child objects attached to the shared Shop,
/// so removing one item only touches its own record, no global mapping or shared vector needed
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
/// * Payment assets are native Move resources (`Coin<T>`, Currency<T>) not ERC20 balances, so registration works
///   by storing rich type info instead of interface addresses.
/// * Coin metadata (symbol, decimals) is globally stored in coin_registry (or coin_metadata) rather than queried via contract calls
/// * Capability-based access control keeps the logic honest; only the matching `ShopOwnerCap`
///   can mutate the shop configuration.
/// * Dynamic fields keep each accepted currency as its own child object, so updating one feed does
///   not serialize writes to the entire shop.
public entry fun add_accepted_currency<T: store>(
    shop: &mut Shop,
    currency: &registry::Currency<T>,
    feed_id: vector<u8>,
    pyth_object_id: obj::ID,
    owner_cap: &ShopOwnerCap,
    ctx: &mut tx::TxContext,
) {
    assert_owner_cap(shop, owner_cap);
    let coin_type = currency_type<T>();
    validate_accepted_currency_inputs(shop, &coin_type, &feed_id);

    let decimals: u8 = registry::decimals(currency);
    let symbol: vector<u8> = string::into_bytes(registry::symbol(currency));
    let shop_address: address = shop_address(shop);

    let (accepted_currency, accepted_currency_address, _feed_for_event) = new_accepted_currency(
        shop_address,
        coin_type,
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
        ctx,
    );

    dynamic_field::add(
        &mut shop.id,
        obj::id_from_address(accepted_currency_address),
        accepted_currency,
    );

    dynamic_field::add(&mut shop.id, coin_type, obj::id_from_address(accepted_currency_address));

    event::emit(AcceptedCoinAdded {
        shop_address,
        coin_type,
        feed_id,
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

/// Create a discount template anchored under the shop.
///
/// Templates are shared immutable configs: by storing them as dynamic-field
/// children they automatically inherit the shop’s access control and remain
/// addressable by obj::ID for UIs. Callers still send primitive args (`rule_kind`
/// of `0 = fixed` or `1 = percent`), but we immediately convert them into the
/// strongly typed `DiscountRuleKind` for internal use.
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
    validate_schedule(starts_at, &expires_at);

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
/// * Discount tickets are owned objects rather than balances in contract storage, so callers can
///   compose `claim_discount_ticket` and checkout in one PTB without extra approvals.
/// * Per-wallet claim limits are enforced by writing a child object (keyed by the claimer’s
///   address) under the template via dynamic fields. This keeps redemptions parallel—each wallet
///   touches only its own claim marker.
/// * Time windows are checked against the shared `Clock` (seconds) to avoid surprises when epochs
///   are long-lived; passing the clock keeps the function pure from a caller perspective.
public entry fun claim_discount_ticket(
    discount_template: &mut DiscountTemplate,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
) {
    let claimer: address = tx::sender(ctx);
    let now_secs: u64 = now_secs(clock);

    assert_template_claimable(discount_template, claimer, now_secs);

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

    let listing: &mut ItemListing = dynamic_field::borrow_mut(&mut shop.id, item_listing_id);
    listing.spotlight_discount_template_id = discount_template_id;
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
        base_price_usd: _,
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
): (AcceptedCurrency, address, vector<u8>) {
    let feed_for_event: vector<u8> = feed_id;

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

    (accepted_currency, accepted_currency_address, feed_for_event)
}

fun new_item_listing<T: store>(
    shop_address: address,
    name: vector<u8>,
    base_price_usd: u64,
    stock: u64,
    spotlight_discount_template_id: opt::Option<obj::ID>,
    ctx: &mut tx::TxContext,
): (ItemListing, address) {
    let listing: ItemListing = ItemListing {
        id: obj::new(ctx),
        shop_address,
        item_type: type_name::with_defining_ids<T>(),
        name,
        base_price_usd,
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
        minted_discounts: 0,
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
        redeemed: false,
    }
}

fun record_discount_claim(
    template: &mut DiscountTemplate,
    claimer: address,
    ctx: &mut tx::TxContext,
) {
    dynamic_field::add(
        &mut template.id,
        claimer,
        DiscountClaim {
            id: obj::new(ctx),
            claimer,
        },
    );
    template.minted_discounts = template.minted_discounts + 1;
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

// ======================= //
// Asserts and validations //
// ======================= //

fun assert_owner_cap(shop: &Shop, owner_cap: &ShopOwnerCap) {
    assert!(owner_cap.shop_address == obj::uid_to_address(&shop.id), EInvalidOwnerCap);
}

fun assert_non_zero_stock(stock: u64) {
    assert!(stock > 0, EZeroStock)
}

fun validate_schedule(starts_at: u64, expires_at: &opt::Option<u64>) {
    if (opt::is_some(expires_at)) {
        assert!(*opt::borrow(expires_at) > starts_at, ETemplateWindow);
    }
}

fun validate_listing_inputs(
    shop: &Shop,
    name: &vector<u8>,
    base_price_usd: u64,
    stock: u64,
    spotlight_discount_template_id: &opt::Option<obj::ID>,
) {
    assert_non_zero_stock(stock);
    assert!(!name.is_empty(), EEmptyItemName);
    assert!(base_price_usd > 0, EInvalidPrice);

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
    validate_schedule(starts_at, expires_at);
    validate_belongs_to_shop_if_some(ReferenceKind::Listing, shop, applies_to_listing);
}

fun validate_accepted_currency_inputs(shop: &Shop, coin_type: &TypeInfo, feed_id: &vector<u8>) {
    assert_currency_not_registered(shop, coin_type);
    assert_valid_feed_id(feed_id);
}

// TODO add asserts from pyth module
fun assert_valid_feed_id(feed_id: &vector<u8>) {
    assert!(!vec::is_empty(feed_id), EEmptyFeedId);
}

fun assert_accepted_currency_exists(shop: &Shop, accepted_currency_id: obj::ID) {
    assert!(
        dynamic_field::exists_with_type<obj::ID, AcceptedCurrency>(&shop.id, accepted_currency_id),
        EAcceptedCurrencyMissing,
    );
}

fun assert_currency_not_registered(shop: &Shop, coin_type: &TypeInfo) {
    assert!(!dynamic_field::exists_<TypeInfo>(&shop.id, *coin_type), EAcceptedCurrencyExists);
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

/// Guardrails to keep claims inside schedule/limits and unique per address.
fun assert_template_claimable(template: &DiscountTemplate, claimer: address, now_secs: u64) {
    assert!(template.active, ETemplateInactive);
    assert!(template.starts_at <= now_secs, ETemplateTooEarly);

    if (opt::is_some(&template.expires_at)) {
        assert!(now_secs < *opt::borrow(&template.expires_at), ETemplateExpired);
    };

    if (opt::is_some(&template.max_redemptions)) {
        assert!(
            template.minted_discounts < *opt::borrow(&template.max_redemptions),
            ETemplateMaxedOut,
        );
    };

    assert!(
        !dynamic_field::exists_with_type<address, DiscountClaim>(&template.id, claimer),
        EDiscountAlreadyClaimed,
    );
}

///==================///
/// #[test_only] API ///
///==================///

#[test_only]
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
public fun test_listing_values(
    shop: &Shop,
    listing_id: obj::ID,
): (vector<u8>, u64, u64, address, opt::Option<obj::ID>) {
    let listing: &ItemListing = dynamic_field::borrow(&shop.id, listing_id);
    (
        clone_bytes(&listing.name),
        listing.base_price_usd,
        listing.stock,
        listing.shop_address,
        listing.spotlight_discount_template_id,
    )
}

#[test_only]
public fun test_listing_exists(shop: &Shop, listing_id: obj::ID): bool {
    dynamic_field::exists_<obj::ID>(&shop.id, listing_id)
}

#[test_only]
public fun test_accepted_currency_exists(shop: &Shop, accepted_currency_id: obj::ID): bool {
    dynamic_field::exists_with_type<obj::ID, AcceptedCurrency>(&shop.id, accepted_currency_id)
}

#[test_only]
public fun test_accepted_currency_values(
    shop: &Shop,
    accepted_currency_id: obj::ID,
): (address, TypeInfo, vector<u8>, obj::ID, u8, vector<u8>) {
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

#[test_only]
public fun test_accepted_currency_id_for_type(shop: &Shop, coin_type: TypeInfo): obj::ID {
    *dynamic_field::borrow<TypeInfo, obj::ID>(&shop.id, coin_type)
}

#[test_only]
public fun test_discount_template_exists(shop: &Shop, template_id: obj::ID): bool {
    dynamic_field::exists_<obj::ID>(&shop.id, template_id)
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
    bool,
) {
    let template: &DiscountTemplate = dynamic_field::borrow(&shop.id, template_id);
    (
        template.shop_address,
        template.applies_to_listing,
        template.rule,
        template.starts_at,
        template.expires_at,
        template.max_redemptions,
        template.minted_discounts,
        template.active,
    )
}

#[test_only]
public fun test_discount_claim_exists(
    shop: &Shop,
    template_id: obj::ID,
    claimer: address,
): bool {
    let template: &DiscountTemplate = dynamic_field::borrow(&shop.id, template_id);
    dynamic_field::exists_with_type<address, DiscountClaim>(&template.id, claimer)
}

#[test_only]
public fun test_claim_discount_ticket(
    shop: &mut Shop,
    template_id: obj::ID,
    clock: &clock::Clock,
    ctx: &mut tx::TxContext,
) {
    let template: &mut DiscountTemplate = dynamic_field::borrow_mut(&mut shop.id, template_id);
    claim_discount_ticket(template, clock, ctx);
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
public fun test_discount_ticket_values(
    ticket: &DiscountTicket,
): (address, address, opt::Option<obj::ID>, address, bool) {
    (
        ticket.discount_template_id,
        ticket.shop_address,
        ticket.listing_id,
        ticket.owner,
        ticket.redeemed,
    )
}

#[test_only]
public fun test_destroy_discount_ticket(ticket: DiscountTicket) {
    let DiscountTicket {
        id,
        discount_template_id: _,
        shop_address: _,
        listing_id: _,
        owner: _,
        redeemed: _,
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
public fun test_item_listing_added_base_price(event: &ItemListingAdded): u64 {
    event.base_price_usd
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
        minted_discounts: _,
        active: _,
    } = template;
    id.delete();
}
