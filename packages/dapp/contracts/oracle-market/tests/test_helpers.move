#[test_only]
module sui_oracle_market::test_helpers;

use pyth::i64;
use pyth::price;
use pyth::price_feed;
use pyth::price_identifier;
use pyth::price_info;
use std::type_name;
use std::unit_test::assert_eq;
use sui::clock::{Self, Clock};
use sui::coin_registry::{Self, Currency};
use sui::event;
use sui::test_scenario;
use sui_oracle_market::events;
use sui_oracle_market::shop;

// === Constants ===

const OWNER: address = @0xBEEF;
const SECOND_OWNER: address = @0xCAFE;
const THIRD_OWNER: address = @0xD00D;
const MISSING_LISTING_ID_ADDRESS: address = @0xBAD1;
const DEFAULT_SHOP_NAME: vector<u8> = b"Shop";
const PRIMARY_FEED_ID: vector<u8> =
    x"000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f";
const SECONDARY_FEED_ID: vector<u8> =
    x"101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f";
const SHORT_FEED_ID: vector<u8> = b"SHORT";
const TEST_DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;
const TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS: u16 = 1_000;
const TEST_MAX_DECIMAL_POWER: u64 = 24;

// === Structs ===

public struct TestCoin has key, store { id: UID }
public struct AltTestCoin has key, store { id: UID }
public struct HighDecimalCoin has key, store { id: UID }
public struct TestItem has store {}
public struct OtherItem has store {}
public struct Car has key, store { id: UID }
public struct Bike has key, store { id: UID }

// === Package Functions ===

public(package) macro fun assert_emitted<$T>($expected_event: $T) {
    let emitted_events = event::events_by_type<$T>();
    if (emitted_events.length() == 0) {
        std::debug::print(&b"Assertion failed. No events emitted.".to_string());
        abort
    };
    let found = emitted_events.any!(|event| event == $expected_event);
    if (!found) {
        std::debug::print(&b"Assertion failed. Different events emitted:".to_string());
        std::debug::print(&emitted_events);
        std::debug::print(&b"No matching events".to_string());
        abort
    };
}

public(package) fun owner(): address {
    OWNER
}

public(package) fun second_owner(): address {
    SECOND_OWNER
}

public(package) fun third_owner(): address {
    THIRD_OWNER
}

public(package) fun missing_listing_id_address(): address {
    MISSING_LISTING_ID_ADDRESS
}

public(package) fun default_shop_name(): vector<u8> {
    DEFAULT_SHOP_NAME
}

public(package) fun primary_feed_id(): vector<u8> {
    PRIMARY_FEED_ID
}

public(package) fun secondary_feed_id(): vector<u8> {
    SECONDARY_FEED_ID
}

public(package) fun short_feed_id(): vector<u8> {
    SHORT_FEED_ID
}

public(package) fun test_default_max_price_age_secs(): u64 {
    TEST_DEFAULT_MAX_PRICE_AGE_SECS
}

public(package) fun test_default_max_confidence_ratio_bps(): u16 {
    TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS
}

public(package) fun test_max_decimal_power(): u64 {
    TEST_MAX_DECIMAL_POWER
}

public(package) fun sample_price(): price::Price {
    let price_value = i64::new(1_000, false);
    price::new(price_value, 10, i64::new(2, true), 0)
}

public(package) fun missing_listing_id(): ID {
    missing_listing_id_address().to_id()
}

public(package) fun create_price_info_object_for_feed(
    feed_id: vector<u8>,
    ctx: &mut tx_context::TxContext,
): price_info::PriceInfoObject {
    create_price_info_object_for_feed_with_price(feed_id, sample_price(), ctx)
}

public(package) fun create_price_info_object_for_feed_with_price(
    feed_id: vector<u8>,
    value: price::Price,
    ctx: &mut tx_context::TxContext,
): price_info::PriceInfoObject {
    create_price_info_object_for_feed_with_price_and_times(
        feed_id,
        value,
        0,
        0,
        ctx,
    )
}

public(package) fun create_price_info_object_for_feed_with_price_and_times(
    feed_id: vector<u8>,
    value: price::Price,
    attestation_time: u64,
    arrival_time: u64,
    ctx: &mut tx_context::TxContext,
): price_info::PriceInfoObject {
    let price_identifier = price_identifier::from_byte_vec(feed_id);
    let created_price_feed = price_feed::new(price_identifier, value, value);
    price_info::new_price_info(
        attestation_time,
        arrival_time,
        created_price_feed,
    ).new_price_info_object_for_test(ctx)
}

public(package) fun add_currency_with_feed<T>(
    shop_obj: &mut shop::Shop,
    accepted_currency: &Currency<T>,
    feed_id: vector<u8>,
    owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx_context::TxContext,
): ID {
    let price_info_object = create_price_info_object_for_feed(feed_id, ctx);
    let price_info_id = price_info_object.uid_to_inner();
    shop_obj.add_accepted_currency<T>(
        owner_cap,
        accepted_currency,
        &price_info_object,
        feed_id,
        price_info_id,
        option::none(),
        option::none(),
    );
    transfer::public_share_object(price_info_object);
    price_info_id
}

public(package) fun add_test_coin_accepted_currency_for_scenario(
    scn: &mut test_scenario::Scenario,
    shop_obj: &mut shop::Shop,
    owner_cap: &shop::ShopOwnerCap,
    accepted_currency: &Currency<TestCoin>,
    feed_id: vector<u8>,
    max_price_age_secs_cap: Option<u64>,
    max_confidence_ratio_bps_cap: Option<u16>,
): ID {
    let price_info_object = create_price_info_object_for_feed(feed_id, scn.ctx());
    let pyth_object_id = price_info_object.uid_to_inner();
    shop_obj.add_accepted_currency<TestCoin>(
        owner_cap,
        accepted_currency,
        &price_info_object,
        feed_id,
        pyth_object_id,
        max_price_age_secs_cap,
        max_confidence_ratio_bps_cap,
    );
    transfer::public_share_object(price_info_object);
    pyth_object_id
}

public(package) fun remove_listing_if_exists(
    shop_obj: &mut shop::Shop,
    owner_cap: &shop::ShopOwnerCap,
    listing_id: ID,
) {
    if (shop_obj.listing_exists(listing_id)) {
        shop_obj.remove_item_listing(owner_cap, listing_id);
    };
}

public(package) fun remove_currency_if_exists<TCoin>(
    shop_obj: &mut shop::Shop,
    owner_cap: &shop::ShopOwnerCap,
) {
    let coin_type = type_name::with_defining_ids<TCoin>();
    if (shop_obj.currency_exists(coin_type)) {
        shop_obj.remove_accepted_currency<TCoin>(owner_cap);
    };
}

public(package) fun create_shop_and_owner_cap_ids_for_sender(
    scn: &mut test_scenario::Scenario,
    shop_name: vector<u8>,
): (ID, ID) {
    let (shop_id, owner_cap) = shop::create_shop(shop_name.to_string(), scn.ctx());
    let owner_cap_id = object::id(&owner_cap);

    assert_emitted!(events::shop_created(shop_id, owner_cap_id));
    transfer::public_transfer(owner_cap, scn.sender());
    let sender = scn.sender();
    scn.next_tx(sender);

    (shop_id, owner_cap_id)
}

public(package) fun create_default_shop_and_owner_cap_ids_for_sender(
    scn: &mut test_scenario::Scenario,
): (ID, ID) {
    create_shop_and_owner_cap_ids_for_sender(scn, default_shop_name())
}

public(package) fun create_test_clock_at(
    ctx: &mut tx_context::TxContext,
    timestamp_secs: u64,
): Clock {
    let mut clock_object = clock::create_for_testing(ctx);
    clock::set_for_testing(&mut clock_object, timestamp_secs);
    clock_object
}

public(package) fun begin_buyer_checkout_context(
    scn: &mut test_scenario::Scenario,
    buyer: address,
    shop_id: ID,
    price_info_id: ID,
    timestamp_secs: u64,
): (shop::Shop, price_info::PriceInfoObject, Clock) {
    let _ = scn.next_tx(buyer);
    let shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_object = scn.take_shared_by_id(price_info_id);
    let clock_object = create_test_clock_at(scn.ctx(), timestamp_secs);
    (shared_shop, price_info_object, clock_object)
}

public(package) fun close_buyer_checkout_context(
    shared_shop: shop::Shop,
    price_info_object: price_info::PriceInfoObject,
    clock_object: Clock,
) {
    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_object);
    std::unit_test::destroy(clock_object);
}

public(package) fun assert_listing_spotlight_discount_id(
    shop_obj: &shop::Shop,
    listing_id: ID,
    expected_discount_id: ID,
) {
    let listing = shop_obj.listing(listing_id);
    let spotlight_discount_id = listing.spotlight_discount_id();
    assert!(option::is_some(&spotlight_discount_id));
    spotlight_discount_id.do_ref!(|value| {
        assert_eq!(*value, expected_discount_id);
    });
}

public(package) fun assert_listing_scoped_percent_discount(
    shop_obj: &shop::Shop,
    discount_id: ID,
    listing_id: ID,
    expected_rule_value: u64,
    expected_starts_at: u64,
    expected_max_redemptions: u64,
) {
    let discount = shop_obj.discount(discount_id);
    let applies_to_listing = discount.applies_to_listing();
    let discount_rule = discount.rule();
    let starts_at = discount.starts_at();
    let expires_at = discount.expires_at();
    let max_redemptions = discount.max_redemptions();
    let redemptions = discount.redemptions();
    let active = discount.active();
    assert!(option::is_some(&applies_to_listing));
    applies_to_listing.do_ref!(|value| {
        assert_eq!(*value, listing_id);
    });
    let rule_kind = discount_rule.kind();
    let rule_value = discount_rule.value();
    assert_eq!(rule_kind, 1);
    assert_eq!(rule_value, expected_rule_value);
    assert_eq!(starts_at, expected_starts_at);
    assert!(option::is_none(&expires_at));
    assert!(option::is_some(&max_redemptions));
    max_redemptions.do_ref!(|value| {
        assert_eq!(*value, expected_max_redemptions);
    });
    assert_eq!(redemptions, 0);
    assert!(active);
}

public(package) fun create_test_currency(ctx: &mut tx_context::TxContext): Currency<TestCoin> {
    let mut registry_obj = coin_registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = coin_registry::new_currency<TestCoin>(
        &mut registry_obj,
        9,
        b"TCO".to_string(),
        b"Test Coin".to_string(),
        b"Test coin for shop".to_string(),
        b"".to_string(),
        ctx,
    );
    let currency_obj = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    transfer::public_share_object(treasury_cap);
    currency_obj
}

public(package) fun create_alt_test_currency(
    ctx: &mut tx_context::TxContext,
): Currency<AltTestCoin> {
    let mut registry_obj = coin_registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = coin_registry::new_currency<AltTestCoin>(
        &mut registry_obj,
        6,
        b"ATC".to_string(),
        b"Alt Test Coin".to_string(),
        b"Alternate test coin for shop".to_string(),
        b"".to_string(),
        ctx,
    );
    let currency_obj = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    transfer::public_share_object(treasury_cap);
    currency_obj
}

public(package) fun create_high_decimal_currency(
    ctx: &mut tx_context::TxContext,
): Currency<HighDecimalCoin> {
    let mut registry_obj = coin_registry::create_coin_data_registry_for_testing(ctx);
    let over_max_decimals = (test_max_decimal_power() + 1) as u8;
    let (init, treasury_cap) = coin_registry::new_currency<HighDecimalCoin>(
        &mut registry_obj,
        over_max_decimals,
        b"HDC".to_string(),
        b"High Decimal Coin".to_string(),
        b"Test coin with >MAX_DECIMAL_POWER decimals".to_string(),
        b"".to_string(),
        ctx,
    );
    let currency_obj = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    transfer::public_share_object(treasury_cap);
    currency_obj
}

public(package) fun prepare_test_currency_for_owner(
    scn: &mut test_scenario::Scenario,
    owner: address,
): Currency<TestCoin> {
    let _ = scn.next_tx(@0x0);
    let currency_obj = create_test_currency(scn.ctx());
    let _ = scn.next_tx(owner);
    currency_obj
}

public(package) fun test_coin_type(): type_name::TypeName {
    type_name::with_defining_ids<TestCoin>()
}

public(package) fun create_discount(
    shop_obj: &mut shop::Shop,
    owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx_context::TxContext,
): ID {
    shop_obj.create_discount(
        owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        ctx,
    )
}

public(package) fun setup_shop_with_currency_listing_and_price_info(
    scn: &mut test_scenario::Scenario,
    base_price_usd_cents: u64,
    stock: u64,
): (ID, ID, ID, ID) {
    setup_shop_with_currency_listing_and_price_info_for_item<TestItem>(
        scn,
        b"Checkout Item",
        base_price_usd_cents,
        stock,
    )
}

public(package) fun setup_shop_with_listing_and_price_info(
    scn: &mut test_scenario::Scenario,
    base_price_usd_cents: u64,
    stock: u64,
): (ID, ID, ID) {
    let (
        shop_id,
        _pyth_object_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(
        scn,
        base_price_usd_cents,
        stock,
    );
    (shop_id, listing_id, price_info_id)
}

public(package) fun setup_shop_with_currency_listing_and_price_info_for_item<TItem: store>(
    scn: &mut test_scenario::Scenario,
    item_name: vector<u8>,
    base_price_usd_cents: u64,
    stock: u64,
): (ID, ID, ID, ID) {
    let currency_obj = prepare_test_currency_for_owner(scn, owner());

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        owner(),
        scn.ctx(),
    );
    let shop_id = object::id(&shop_obj);
    let price_info_object = create_price_info_object_for_feed(
        primary_feed_id(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency_obj,
        &price_info_object,
        primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    let pyth_object_id = price_info_id;
    std::unit_test::destroy(currency_obj);

    let listing_id = shop_obj.add_item_listing<TItem>(
        &owner_cap,
        item_name.to_string(),
        base_price_usd_cents,
        stock,
        option::none(),
        scn.ctx(),
    );

    transfer::public_share_object(price_info_object);
    transfer::public_share_object(shop_obj);
    transfer::public_transfer(owner_cap, @0x0);

    (shop_id, pyth_object_id, listing_id, price_info_id)
}
