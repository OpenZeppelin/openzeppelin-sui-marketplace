#[test_only]
module sui_oracle_market::shop_tests;

use pyth::i64;
use pyth::price;
use pyth::price_feed;
use pyth::price_identifier;
use pyth::price_info;
use pyth::pyth;
use std::type_name;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin;
use sui::coin_registry;
use sui::event;
use sui::test_scenario;
use sui_oracle_market::shop;
use sui_oracle_market::events;

// === Constants ===

const TEST_OWNER: address = @0xBEEF;
const OTHER_OWNER: address = @0xCAFE;
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
const TEST_DEFAULT_MAX_PRICE_STATUS_LAG_SECS: u64 = 5;
const TEST_MAX_DECIMAL_POWER: u64 = 24;

// === Test Types ===

/// Test coin used in unit tests.
public struct TestCoin has key, store { id: UID }
/// Alternate test coin used in unit tests.
public struct AltTestCoin has key, store { id: UID }
/// Test coin with high decimals to validate precision handling.
public struct HighDecimalCoin has key, store { id: UID }
/// Test item type used in unit tests.
public struct TestItem has store {}
/// Alternate item type used in unit tests.
public struct OtherItem has store {}

/// Test vehicle object used in unit tests.
public struct Car has key, store {
    id: UID,
}

/// Test vehicle object used in unit tests.
public struct Bike has key, store {
    id: UID,
}

TODO#q: fix unit tests

// === Test Helpers ===

fun sample_price(): price::Price {
    let price_value = i64::new(1_000, false);
    price::new(price_value, 10, i64::new(2, true), 0)
}

fun missing_listing_id(): ID {
    MISSING_LISTING_ID_ADDRESS.to_id()
}

fun create_price_info_object_for_feed(
    feed_id: vector<u8>,
    ctx: &mut tx_context::TxContext,
): price_info::PriceInfoObject {
    create_price_info_object_for_feed_with_price(feed_id, sample_price(), ctx)
}

fun create_price_info_object_for_feed_with_price(
    feed_id: vector<u8>,
    price: price::Price,
    ctx: &mut tx_context::TxContext,
): price_info::PriceInfoObject {
    create_price_info_object_for_feed_with_price_and_times(
        feed_id,
        price,
        0,
        0,
        ctx,
    )
}

fun create_price_info_object_for_feed_with_price_and_times(
    feed_id: vector<u8>,
    price: price::Price,
    attestation_time: u64,
    arrival_time: u64,
    ctx: &mut tx_context::TxContext,
): price_info::PriceInfoObject {
    let price_identifier = price_identifier::from_byte_vec(feed_id);
    let price_feed = price_feed::new(price_identifier, price, price);
    price_info::new_price_info(
        attestation_time,
        arrival_time,
        price_feed,
    ).new_price_info_object_for_test(ctx)
}

fun take_shared_shop(scn: &test_scenario::Scenario, shop_id: ID): shop::Shop {
    scn.take_shared_by_id<shop::Shop>(shop_id)
}

fun add_currency_with_feed<T>(
    shop: &mut shop::Shop,
    currency: &coin_registry::Currency<T>,
    feed_id: vector<u8>,
    owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx_context::TxContext,
): ID {
    let price_info_object = create_price_info_object_for_feed(
        feed_id,
        ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();
    shop.add_accepted_currency<T>(
        owner_cap,
        currency,
        &price_info_object,
        feed_id,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    transfer::public_share_object(price_info_object);
    price_info_id
}

fun add_test_coin_accepted_currency_for_scenario(
    scn: &mut test_scenario::Scenario,
    shop: &mut shop::Shop,
    owner_cap: &shop::ShopOwnerCap,
    currency: &coin_registry::Currency<TestCoin>,
    feed_id: vector<u8>,
    max_price_age_secs_cap: Option<u64>,
    max_confidence_ratio_bps_cap: Option<u16>,
    max_price_status_lag_secs_cap: Option<u64>,
): ID {
    let price_info_object = create_price_info_object_for_feed(
        feed_id,
        test_scenario::ctx(scn),
    );
    let accepted_currency_id = price_info_object.uid_to_inner();
    shop.add_accepted_currency<TestCoin>(
        owner_cap,
        currency,
        &price_info_object,
        feed_id,
        accepted_currency_id,
        max_price_age_secs_cap,
        max_confidence_ratio_bps_cap,
        max_price_status_lag_secs_cap,
    );
    transfer::public_share_object(price_info_object);
    accepted_currency_id
}

/// Setup policy:
/// - `test_scenario` helpers are used for shared-object lifecycle and entry-path behavior.
/// - `tx_context` + this helper are used for deterministic local tests where shared lifecycle is
///   not part of the behavior under test.
fun setup_local_shop_and_owner_cap(
    owner: address,
    ctx: &mut tx_context::TxContext,
): (shop::Shop, shop::ShopOwnerCap) {
    shop::test_setup_shop(owner, ctx)
}

fun remove_listing_if_exists(
    shop: &mut shop::Shop,
    owner_cap: &shop::ShopOwnerCap,
    listing_id: ID,
) {
    if (shop.listing_exists(listing_id)) {
        shop.remove_item_listing(owner_cap, listing_id);
    };
}

fun remove_currency_if_exists<TCoin>(shop: &mut shop::Shop, owner_cap: &shop::ShopOwnerCap) {
    let coin_type = type_name::with_defining_ids<TCoin>();
    if (shop.accepted_currency_exists(coin_type)) {
        shop.remove_accepted_currency<TCoin>(owner_cap);
    };
}

fun create_shop_and_owner_cap_ids_for_sender(
    scn: &mut test_scenario::Scenario,
    shop_name: vector<u8>,
): (ID, ID) {
    let (shop_id, owner_cap_id) = shop::create_shop(shop_name.to_string(), test_scenario::ctx(scn));

    assert_emitted!(events::shop_created(shop_id, owner_cap_id));
    let sender = scn.sender();
    scn.next_tx(sender);

    (shop_id, owner_cap_id)
}

fun create_default_shop_and_owner_cap_ids_for_sender(scn: &mut test_scenario::Scenario): (ID, ID) {
    create_shop_and_owner_cap_ids_for_sender(scn, DEFAULT_SHOP_NAME)
}

fun create_test_clock_at(ctx: &mut tx_context::TxContext, timestamp_secs: u64): clock::Clock {
    let mut clock_object = clock::create_for_testing(ctx);
    clock::set_for_testing(&mut clock_object, timestamp_secs);
    clock_object
}

fun begin_buyer_checkout_context(
    scn: &mut test_scenario::Scenario,
    buyer: address,
    shop_id: ID,
    price_info_id: ID,
    timestamp_secs: u64,
): (shop::Shop, price_info::PriceInfoObject, clock::Clock) {
    let _ = test_scenario::next_tx(scn, buyer);
    let shared_shop = take_shared_shop(scn, shop_id);
    let price_info_object = test_scenario::take_shared_by_id(
        scn,
        price_info_id,
    );
    let clock_object = create_test_clock_at(test_scenario::ctx(scn), timestamp_secs);
    (shared_shop, price_info_object, clock_object)
}

fun close_buyer_checkout_context(
    shared_shop: shop::Shop,
    price_info_object: price_info::PriceInfoObject,
    clock_object: clock::Clock,
) {
    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_object);
    std::unit_test::destroy(clock_object);
}

fun assert_listing_spotlight_template_id(
    shop: &shop::Shop,
    listing_id: ID,
    expected_template_id: ID,
) {
    let listing = shop.listing(listing_id);
    let spotlight_template_id = listing.listing_spotlight_discount_template_id();
    assert!(option::is_some(&spotlight_template_id));
    spotlight_template_id.do_ref!(|value| {
        assert_eq!(*value, expected_template_id);
    });
}

/// Asserts that `expected_event` of type `T` was emitted.
macro fun assert_emitted<$T>($expected_event: $T) {
    let events = event::events_by_type<$T>();
    if (events.length() == 0) {
        std::debug::print(&b"Assertion failed. No events emitted.".to_string());
        abort
    };
    let emitted = events.any!(|event| event == $expected_event);
    if (!emitted) {
        std::debug::print(&b"Assertion failed. Different events emitted:".to_string());
        std::debug::print(&events);
        std::debug::print(&b"No matching events".to_string());
        abort
    };
}

// === Tests ===

#[test]
fun create_shop_emits_event_and_records_ids() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );
    let _ = test_scenario::end(scn);
}

#[test]
fun create_shop_allows_multiple_shops_per_sender() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 2, 0, 0, 0);
    let starting_ids = tx_context::get_ids_created(&ctx);

    shop::create_shop(DEFAULT_SHOP_NAME.to_string(), &mut ctx);
    shop::create_shop(DEFAULT_SHOP_NAME.to_string(), &mut ctx);

    assert_eq!(event::events_by_type<shop::ShopCreatedEvent>().length(), 2);
    assert_eq!(tx_context::get_ids_created(&ctx), starting_ids + 10);
}

#[test]
fun create_shop_emits_unique_shop_and_cap_ids() {
    let mut scn = test_scenario::begin(TEST_OWNER);

    let (first_shop_id, first_owner_cap_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let (second_shop_id, second_owner_cap_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    assert!(first_shop_id != second_shop_id);
    assert!(first_owner_cap_id != second_owner_cap_id);

    let _ = test_scenario::end(scn);
}

#[test]
fun create_shop_records_sender_in_event() {
    let mut scn = test_scenario::begin(OTHER_OWNER);
    let (_, owner_cap_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );
    let sender_owner_cap_ids = test_scenario::ids_for_sender<shop::ShopOwnerCap>(&scn);
    assert_eq!(sender_owner_cap_ids.length(), 1);
    assert_eq!(sender_owner_cap_ids[0], owner_cap_id);
    let _ = test_scenario::end(scn);
}

#[test]
fun create_shop_handles_existing_id_counts() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 6, 0, 0, 0);

    let (temp_shop, temp_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    std::unit_test::destroy(temp_cap);
    std::unit_test::destroy(temp_shop);

    let starting_ids = tx_context::get_ids_created(&ctx);

    shop::create_shop(DEFAULT_SHOP_NAME.to_string(), &mut ctx);

    assert_eq!(tx_context::get_ids_created(&ctx), starting_ids + 5);
}

#[test]
fun create_shop_shares_shop_and_transfers_owner_cap() {
    let mut scn = test_scenario::begin(TEST_OWNER);

    let (shop_id, _) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let shared_shop = test_scenario::take_shared<shop::Shop>(&scn);
    assert_eq!(object::id(&shared_shop), shop_id);
    assert_eq!(shared_shop.shop_owner(), TEST_OWNER);
    assert_eq!(shared_shop.shop_name(), DEFAULT_SHOP_NAME.to_string());
    assert!(!shared_shop.shop_disabled());

    test_scenario::return_shared(shared_shop);
    let _ = test_scenario::end(scn);
}

#[test]
fun update_shop_owner_rotates_payout_and_emits_event() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 40, 0, 0, 0);
    let (mut shop, owner_cap) = setup_local_shop_and_owner_cap(TEST_OWNER, &mut ctx);

    shop.update_shop_owner(&owner_cap, OTHER_OWNER);

    assert_eq!(shop.shop_owner(), OTHER_OWNER);
    let cap_id = owner_cap.shop_owner_cap_id();
    assert_emitted!(
        events::shop_owner_updated(
            shop.shop_id(),
            cap_id,
        ),
    );

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun update_shop_owner_emits_event_even_when_unchanged() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 42, 0, 0, 0);
    let (mut shop, owner_cap) = setup_local_shop_and_owner_cap(TEST_OWNER, &mut ctx);

    shop.update_shop_owner(&owner_cap, TEST_OWNER);

    assert_eq!(shop.shop_owner(), TEST_OWNER);
    let cap_id = owner_cap.shop_owner_cap_id();
    let shop_id = shop.shop_id();
    assert_emitted!(events::shop_owner_updated(shop_id, cap_id));

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun update_shop_owner_records_rotated_by_sender() {
    let mut ctx = tx_context::new_from_hint(THIRD_OWNER, 43, 0, 0, 0);
    let (mut shop, owner_cap) = setup_local_shop_and_owner_cap(TEST_OWNER, &mut ctx);

    shop.update_shop_owner(&owner_cap, OTHER_OWNER);
    let cap_id = owner_cap.shop_owner_cap_id();

    assert_eq!(shop.shop_owner(), OTHER_OWNER);
    assert_emitted!(
        events::shop_owner_updated(
            shop.shop_id(),
            cap_id,
        ),
    );

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun disable_shop_sets_flag_and_emits_event() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 44, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop.disable_shop(&owner_cap);

    assert!(shop.shop_disabled());

    let shop_id = shop.shop_id();
    let cap_id = owner_cap.shop_owner_cap_id();
    assert_emitted!(events::shop_disabled(shop_id, cap_id));

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun disable_shop_rejects_foreign_cap() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 45, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop.disable_shop(&other_cap);

    std::unit_test::destroy(other_cap);
    std::unit_test::destroy(other_shop);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_shop_owner_rejects_foreign_cap() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 41, 0, 0, 0);
    let (mut shop, owner_cap) = setup_local_shop_and_owner_cap(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = setup_local_shop_and_owner_cap(
        OTHER_OWNER,
        &mut ctx,
    );

    shop.update_shop_owner(&other_cap, OTHER_OWNER);

    std::unit_test::destroy(other_cap);
    std::unit_test::destroy(other_shop);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun add_accepted_currency_records_currency_and_event() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let expected_feed_id = PRIMARY_FEED_ID;
    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let accepted_currency_id = add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        expected_feed_id,
        option::none(),
        option::none(),
        option::none(),
    );
    assert_emitted!(
        events::accepted_coin_added(
            shop_obj.shop_id(),
            accepted_currency_id,
        ),
    );

    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = take_shared_shop(&scn, shop_id);

    let accepted_currency = shared_shop.accepted_currency<TestCoin>();
    let feed_id = accepted_currency.accepted_currency_feed_id();
    let pyth_id = accepted_currency.accepted_currency_pyth_object_id();
    let decimals = accepted_currency.accepted_currency_decimals();
    let symbol = accepted_currency.accepted_currency_symbol();
    assert_eq!(feed_id, expected_feed_id);
    assert_eq!(pyth_id, accepted_currency_id);
    assert_eq!(decimals, 9);
    assert_eq!(symbol, b"TCO".to_string());
    assert!(shared_shop.accepted_currency_exists(test_coin_type()));

    test_scenario::return_shared(shared_shop);
    std::unit_test::destroy(currency);
    let _ = test_scenario::end(scn);
}

#[test]
fun add_accepted_currency_stores_custom_guardrail_caps() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let custom_age_cap = 30;
    let custom_conf_cap = 500;
    let custom_status_cap = 3;
    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let accepted_currency_id = add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        PRIMARY_FEED_ID,
        option::some(custom_age_cap),
        option::some(custom_conf_cap),
        option::some(custom_status_cap),
    );
    std::unit_test::destroy(owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);
    let shared_shop = take_shared_shop(&scn, shop_id);
    let accepted_currency = shared_shop.accepted_currency<TestCoin>();
    let max_age_cap = accepted_currency.accepted_currency_max_price_age_secs_cap();
    let conf_cap = accepted_currency.accepted_currency_max_confidence_ratio_bps_cap();
    let status_cap = accepted_currency.accepted_currency_max_price_status_lag_secs_cap();
    let pyth_object_id = accepted_currency.accepted_currency_pyth_object_id();
    assert_eq!(max_age_cap, custom_age_cap);
    assert_eq!(conf_cap, custom_conf_cap);
    assert_eq!(status_cap, custom_status_cap);
    assert_eq!(pyth_object_id, accepted_currency_id);

    test_scenario::return_shared(shared_shop);
    std::unit_test::destroy(currency);
    let _ = test_scenario::end(scn);
}

#[test]
fun add_accepted_currency_clamps_guardrail_caps_to_defaults() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let over_age_cap = TEST_DEFAULT_MAX_PRICE_AGE_SECS + 100;
    let over_conf_cap = TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS + 500;
    let over_status_cap = TEST_DEFAULT_MAX_PRICE_STATUS_LAG_SECS + 10;
    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let accepted_currency_id = add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        PRIMARY_FEED_ID,
        option::some(over_age_cap),
        option::some(over_conf_cap),
        option::some(over_status_cap),
    );
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);
    let shared_shop = take_shared_shop(&scn, shop_id);
    let accepted_currency = shared_shop.accepted_currency<TestCoin>();
    let max_age_cap = accepted_currency.accepted_currency_max_price_age_secs_cap();
    let conf_cap = accepted_currency.accepted_currency_max_confidence_ratio_bps_cap();
    let status_cap = accepted_currency.accepted_currency_max_price_status_lag_secs_cap();
    let pyth_object_id = accepted_currency.accepted_currency_pyth_object_id();
    assert_eq!(max_age_cap, TEST_DEFAULT_MAX_PRICE_AGE_SECS);
    assert_eq!(conf_cap, TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS);
    assert_eq!(status_cap, TEST_DEFAULT_MAX_PRICE_STATUS_LAG_SECS);
    assert_eq!(pyth_object_id, accepted_currency_id);

    test_scenario::return_shared(shared_shop);
    std::unit_test::destroy(currency);
    let _ = test_scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_accepted_currency_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::new_from_hint(@0x0, 8, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<TestCoin>(
        &other_cap,
        &currency,
        &price_info_object,
        b"BAD",
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyExists)]
fun add_accepted_currency_rejects_duplicate_coin_type() {
    let mut ctx = tx_context::new_from_hint(@0x0, 9, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);

    let _ = add_currency_with_feed<TestCoin>(
        &mut shop,
        &currency,
        PRIMARY_FEED_ID,
        &owner_cap,
        &mut ctx,
    );

    let _ = add_currency_with_feed<TestCoin>(
        &mut shop,
        &currency,
        SECONDARY_FEED_ID,
        &owner_cap,
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyFeedId)]
fun add_accepted_currency_rejects_empty_feed_id() {
    let mut ctx = tx_context::new_from_hint(@0x0, 10, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        b"",
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidFeedIdLength)]
fun add_accepted_currency_rejects_short_feed_id() {
    let mut ctx = tx_context::new_from_hint(@0x0, 14, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        SHORT_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );

    abort
}

#[test]
fun attestation_time_within_lag_is_allowed() {
    let mut ctx = tx_context::new_from_hint(@0x0, 16, 0, 0, 0);
    let publish_time = 100;
    let attestation_time = publish_time + TEST_DEFAULT_MAX_PRICE_STATUS_LAG_SECS;
    let price = price::new(
        i64::new(1_000, false),
        10,
        i64::new(2, true),
        publish_time,
    );
    let price_info_object = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        attestation_time,
        attestation_time,
        &mut ctx,
    );

    shop::assert_price_status_trading_for_max_lag(
        &price_info_object,
        TEST_DEFAULT_MAX_PRICE_STATUS_LAG_SECS,
    );
    std::unit_test::destroy(price_info_object);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceStatusNotTrading)]
fun attestation_time_lag_over_limit_is_rejected() {
    let mut ctx = tx_context::new_from_hint(@0x0, 18, 0, 0, 0);
    let publish_time = 200;
    let attestation_time = publish_time + TEST_DEFAULT_MAX_PRICE_STATUS_LAG_SECS + 1;
    let price = price::new(
        i64::new(1_000, false),
        10,
        i64::new(2, true),
        publish_time,
    );
    let price_info_object = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        attestation_time,
        attestation_time,
        &mut ctx,
    );

    shop::assert_price_status_trading_for_max_lag(
        &price_info_object,
        TEST_DEFAULT_MAX_PRICE_STATUS_LAG_SECS,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EUnsupportedCurrencyDecimals)]
fun add_accepted_currency_rejects_excessive_decimals() {
    let mut ctx = tx_context::new_from_hint(@0x0, 11, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_high_decimal_currency(&mut ctx);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<HighDecimalCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EFeedIdentifierMismatch)]
fun add_accepted_currency_rejects_identifier_mismatch() {
    let mut ctx = tx_context::new_from_hint(@0x0, 15, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        SECONDARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun add_accepted_currency_rejects_missing_price_object() {
    let mut ctx = tx_context::new_from_hint(@0x0, 17, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        @0xB.to_id(),
        option::none(),
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceStatusNotTrading)]
fun quote_rejects_attestation_lag_above_currency_cap() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let publish_time = 300;
    let attestation_time = publish_time + 3;
    let price = price::new(
        i64::new(1_000, false),
        10,
        i64::new(2, true),
        publish_time,
    );
    let price_info_object = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        attestation_time,
        attestation_time,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::some(2),
    );
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = take_shared_shop(&scn, shop_id);
    let clock_obj = create_test_clock_at(
        test_scenario::ctx(&mut scn),
        (attestation_time + 1) * 1000,
    );

    shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &test_scenario::take_shared_by_id<price_info::PriceInfoObject>(
            &scn,
            price_info_id,
        ),
        10_000,
        option::none(),
        option::none(),
        &clock_obj,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceTooStale)]
fun quote_rejects_price_timestamp_older_than_max_age() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    // Timestamp = 0 keeps the Price stale once we advance the on-chain clock.
    let publish_time = 0;
    let price = price::new(
        i64::new(1_000, false),
        10,
        i64::new(2, true),
        publish_time,
    );
    let price_info_object = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        publish_time,
        publish_time,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = take_shared_shop(&scn, shop_id);
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 200_000);

    shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &test_scenario::take_shared_by_id<price_info::PriceInfoObject>(
            &scn,
            price_info_id,
        ),
        10_000,
        option::some(10),
        option::none(),
        &clock_obj,
    );
    abort
}

#[test]
fun remove_accepted_currency_removes_state_and_emits_event() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);
    let _ = test_scenario::next_tx(&mut scn, @0x0);
    let primary_currency = create_test_currency(test_scenario::ctx(&mut scn));
    let secondary_currency = create_alt_test_currency(test_scenario::ctx(&mut scn));
    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let first_price_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let first_price_id = first_price_object.uid_to_inner();

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &primary_currency,
        &first_price_object,
        PRIMARY_FEED_ID,
        first_price_id,
        option::none(),
        option::none(),
        option::none(),
    );
    let _first_currency_id = tx_context::last_created_object_id(
        test_scenario::ctx(&mut scn),
    ).to_id();
    transfer::public_share_object(first_price_object);

    let second_price_object = create_price_info_object_for_feed(
        SECONDARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let second_price_id = second_price_object.uid_to_inner();

    shop_obj.add_accepted_currency<AltTestCoin>(
        &owner_cap_obj,
        &secondary_currency,
        &second_price_object,
        SECONDARY_FEED_ID,
        second_price_id,
        option::none(),
        option::none(),
        option::none(),
    );
    let _second_currency_id = tx_context::last_created_object_id(
        test_scenario::ctx(&mut scn),
    ).to_id();
    transfer::public_share_object(second_price_object);
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    std::unit_test::destroy(primary_currency);
    std::unit_test::destroy(secondary_currency);
    let _ = test_scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_accepted_currency_rejects_foreign_owner_cap() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);
    let (_, wrong_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let wrong_cap = test_scenario::take_from_sender_by_id(
        &scn,
        wrong_cap_id,
    );
    let mut shared_shop = take_shared_shop(&scn, shop_id);

    shared_shop.remove_accepted_currency<TestCoin>(
        &wrong_cap,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_rejects_missing_id() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);
    let (other_shop_id, other_owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = prepare_test_currency_for_owner(&mut scn, OTHER_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut other_shop_obj = test_scenario::take_shared_by_id<shop::Shop>(
        &scn,
        other_shop_id,
    );
    let other_owner_cap_obj = test_scenario::take_from_sender_by_id<shop::ShopOwnerCap>(
        &scn,
        other_owner_cap_id,
    );
    other_shop_obj.add_accepted_currency<TestCoin>(
        &other_owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    let _foreign_currency_id = tx_context::last_created_object_id(
        test_scenario::ctx(&mut scn),
    ).to_id();
    test_scenario::return_to_sender(&scn, other_owner_cap_obj);
    test_scenario::return_shared(other_shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let mut shared_shop = take_shared_shop(&scn, shop_id);
    shared_shop.remove_accepted_currency<TestCoin>(
        &owner_cap_obj,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_handles_missing_type_mapping() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);
    transfer::public_share_object(price_info_object);

    remove_currency_if_exists<TestCoin>(&mut shop_obj, &owner_cap);

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap = test_scenario::take_from_sender_by_id<shop::ShopOwnerCap>(
        &scn,
        owner_cap_id,
    );
    let mut shared_shop = take_shared_shop(&scn, shop_id);
    shared_shop.remove_accepted_currency<TestCoin>(
        &owner_cap,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_rejects_mismatched_type_mapping() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    let _first_currency_id = tx_context::last_created_object_id(
        test_scenario::ctx(&mut scn),
    ).to_id();
    std::unit_test::destroy(currency);

    remove_currency_if_exists<TestCoin>(&mut shop_obj, &owner_cap);

    let replacement_currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &replacement_currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(replacement_currency);
    std::unit_test::destroy(price_info_object);

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap = test_scenario::take_from_sender_by_id<shop::ShopOwnerCap>(
        &scn,
        owner_cap_id,
    );
    let mut shared_shop = take_shared_shop(&scn, shop_id);
    shared_shop.remove_accepted_currency<TestCoin>(
        &owner_cap,
    );
    shared_shop.remove_accepted_currency<TestCoin>(
        &owner_cap,
    );
    abort
}

#[test]
fun quote_view_matches_internal_math() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed_with_price(
        PRIMARY_FEED_ID,
        sample_price(),
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 1);
    let price_usd_cents = 10_000;
    let accepted_currency = shared_shop.accepted_currency<TestCoin>();
    let decimals = accepted_currency.accepted_currency_decimals();

    let view_quote = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        price_usd_cents,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let price = pyth::get_price_no_older_than(
        &price_info_obj,
        &clock_obj,
        TEST_DEFAULT_MAX_PRICE_AGE_SECS,
    );
    let derived_quote = shop::quote_amount_from_usd_cents(
        price_usd_cents,
        decimals,
        price,
        TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );

    assert_eq!(derived_quote, 10_101_010_102);
    assert_eq!(view_quote, derived_quote);

    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    std::unit_test::destroy(currency);
    let _ = test_scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceOverflow)]
fun quote_amount_rejects_overflow_before_runtime_abort() {
    let price = price::new(
        i64::new(1, false),
        0,
        i64::new(0, false),
        0,
    );
    let max_usd_cents = 18_446_744_073_709_551_615;

    shop::quote_amount_from_usd_cents(
        max_usd_cents,
        24, // MAX_DECIMAL_POWER; forces usd_cents * 10^24 to overflow u128.
        price,
        TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun quote_view_rejects_mismatched_price_info_object() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed_with_price(
        PRIMARY_FEED_ID,
        sample_price(),
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = take_shared_shop(&scn, shop_id);
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 1);
    let mismatched_price_info_object = create_price_info_object_for_feed_with_price(
        SECONDARY_FEED_ID,
        sample_price(),
        test_scenario::ctx(&mut scn),
    );

    shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &mismatched_price_info_object,
        10_000,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test]
fun add_item_listing_stores_metadata() {
    let mut ctx: tx_context::TxContext = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let ids_before = tx_context::get_ids_created(&ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Cool Bike".to_string(),
        125_00,
        25,
        option::none(),
        &mut ctx,
    );
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before + 1);
    assert_eq!(tx_context::last_created_object_id(&ctx).to_id(), listing_id);
    assert!(shop.listing_exists(listing_id));
    let listing = shop.listing(listing_id);
    let name = listing.listing_name();
    let base_price_usd_cents = listing.listing_base_price_usd_cents();
    let stock = listing.listing_stock();
    let spotlight_template_id = listing.listing_spotlight_discount_template_id();

    assert_eq!(name, b"Cool Bike".to_string());
    assert_eq!(base_price_usd_cents, 125_00);
    assert_eq!(stock, 25);
    assert!(option::is_none(&spotlight_template_id));
    assert_emitted!(
        events::item_listing_added(
            shop.shop_id(),
            listing_id,
        ),
    );

    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun add_item_listing_links_spotlight_template() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 44, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let template_id = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Limited Tire Set".to_string(),
        200_00,
        8,
        option::some(template_id),
        &mut ctx,
    );
    let listing = shop.listing(listing_id);
    let spotlight_template_id = listing.listing_spotlight_discount_template_id();

    assert!(option::is_some(&spotlight_template_id));
    spotlight_template_id.do_ref!(|value| {
        assert_eq!(*value, template_id);
    });
    assert_emitted!(
        events::item_listing_added(
            shop.shop_id(),
            listing_id,
        ),
    );

    shop.remove_discount_template(&owner_cap, template_id);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun add_item_listing_with_discount_template_creates_listing_and_pinned_template() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 404, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let ids_before = tx_context::get_ids_created(&ctx);

    let (listing_id, template_id) = shop.add_item_listing_with_discount_template<TestItem>(
        &owner_cap,
        b"Atomic Promo Bundle".to_string(),
        240_00,
        6,
        1,
        1_500,
        0,
        option::none(),
        option::some(20),
        &mut ctx,
    );
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before + 3);
    assert!(listing_id != template_id);
    assert_eq!(tx_context::last_created_object_id(&ctx).to_id(), template_id);

    assert!(shop.listing_exists(listing_id));
    assert!(shop.discount_template_exists(template_id));
    assert_listing_spotlight_template_id(&shop, listing_id, template_id);
    assert_listing_scoped_percent_template(
        &shop,
        template_id,
        listing_id,
        1_500,
        0,
        20,
    );
    let shop_id = shop.shop_id();
    assert_emitted!(events::item_listing_added(shop_id, listing_id));
    assert_emitted!(
        events::discount_template_created(
            shop_id,
            template_id,
        ),
    );

    shop.remove_discount_template(&owner_cap, template_id);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

fun assert_listing_scoped_percent_template(
    shop: &shop::Shop,
    template_id: ID,
    listing_id: ID,
    expected_rule_value: u64,
    expected_starts_at: u64,
    expected_max_redemptions: u64,
) {
    let template_values = shop.discount_template(template_id);
    let applies_to_listing = template_values.discount_template_applies_to_listing();
    let discount_rule = template_values.discount_template_rule();
    let starts_at = template_values.discount_template_starts_at();
    let expires_at = template_values.discount_template_expires_at();
    let max_redemptions = template_values.discount_template_max_redemptions();
    let claims_issued = template_values.discount_template_claims_issued();
    let redemptions = template_values.discount_template_redemptions();
    let active = template_values.discount_template_active();
    assert!(option::is_some(&applies_to_listing));
    applies_to_listing.do_ref!(|value| {
        assert_eq!(*value, listing_id);
    });
    let rule_kind = discount_rule.discount_rule_kind();
    let rule_value = discount_rule.discount_rule_value();
    assert_eq!(rule_kind, 1);
    assert_eq!(rule_value, expected_rule_value);
    assert_eq!(starts_at, expected_starts_at);
    assert!(option::is_none(&expires_at));
    assert!(option::is_some(&max_redemptions));
    max_redemptions.do_ref!(|value| {
        assert_eq!(*value, expected_max_redemptions);
    });
    assert_eq!(claims_issued, 0);
    assert_eq!(redemptions, 0);
    assert!(active);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_item_listing_with_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop.add_item_listing_with_discount_template<TestItem>(
        &other_cap,
        b"Wrong Owner Cap".to_string(),
        125_00,
        3,
        0,
        500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyItemName)]
fun add_item_listing_rejects_empty_name() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 45, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop.add_item_listing<TestItem>(
        &owner_cap,
        b"".to_string(),
        100_00,
        10,
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop.add_item_listing<TestItem>(
        &other_cap,
        b"Wrong Owner Cap".to_string(),
        15_00,
        3,
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidPrice)]
fun add_item_listing_rejects_zero_price() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Zero Price".to_string(),
        0,
        10,
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EZeroStock)]
fun add_item_listing_rejects_zero_stock() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop.add_item_listing<TestItem>(
        &owner_cap,
        b"No Stock".to_string(),
        10_00,
        0,
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun add_item_listing_rejects_foreign_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let foreign_template_id = create_discount_template(
        &mut other_shop,
        &other_cap,
        &mut ctx,
    );

    shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Bad Template".to_string(),
        15_00,
        5,
        option::some(foreign_template_id),
        &mut ctx,
    );

    abort
}

#[test]
fun update_item_listing_stock_updates_listing_and_emits_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Helmet".to_string(),
        48_00,
        4,
        option::none(),
        &mut ctx,
    );

    shop.update_item_listing_stock(
        &owner_cap,
        listing_id,
        11,
    );

    let listing = shop.listing(listing_id);
    let name = listing.listing_name();
    let base_price_usd_cents = listing.listing_base_price_usd_cents();
    let stock = listing.listing_stock();
    let spotlight_template = listing.listing_spotlight_discount_template_id();
    assert_eq!(name, b"Helmet".to_string());
    assert_eq!(base_price_usd_cents, 48_00);
    assert!(option::is_none(&spotlight_template));
    assert_eq!(stock, 11);

    assert_emitted!(events::item_listing_stock_updated(shop.shop_id(), listing_id));

    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_item_listing_stock_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_foreign_shop, foreign_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Borrowed Listing".to_string(),
        18_00,
        9,
        option::none(),
        &mut ctx,
    );

    shop.update_item_listing_stock(
        &foreign_cap,
        listing_id,
        7,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun update_item_listing_stock_rejects_unknown_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<TestItem>(
        &other_cap,
        b"Foreign Listing".to_string(),
        10_00,
        2,
        option::none(),
        &mut ctx,
    );

    shop.update_item_listing_stock(
        &owner_cap,
        foreign_listing_id,
        3,
    );

    abort
}

#[test]
fun update_item_listing_stock_handles_multiple_updates_and_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Pads".to_string(),
        22_00,
        5,
        option::none(),
        &mut ctx,
    );

    let expected_stock_updated_event = shop::new_item_listing_stock_updated(
        shop.shop_id(),
        listing_id,
    );
    shop.update_item_listing_stock(
        &owner_cap,
        listing_id,
        8,
    );
    assert_emitted!(expected_stock_updated_event);
    shop.update_item_listing_stock(
        &owner_cap,
        listing_id,
        3,
    );
    assert_emitted!(expected_stock_updated_event);

    let listing = shop.listing(listing_id);
    let stock = listing.listing_stock();
    assert_eq!(stock, 3);

    assert_emitted!(
        events::item_listing_stock_updated(
            shop.shop_id(),
            listing_id,
        ),
    );
    assert_eq!(event::events_by_type<shop::ItemListingStockUpdatedEvent>().length(), 2);

    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun remove_item_listing_removes_listing_and_emits_event() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let removed_listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Chain Grease".to_string(),
        12_00,
        3,
        option::none(),
        &mut ctx,
    );

    let remaining_listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Repair Kit".to_string(),
        42_00,
        2,
        option::none(),
        &mut ctx,
    );
    let shop_address = shop.shop_id();

    shop.remove_item_listing(
        &owner_cap,
        removed_listing_id,
    );

    assert_emitted!(events::item_listing_removed(shop_address, removed_listing_id));

    assert!(!shop.listing_exists(removed_listing_id));
    assert!(shop.listing_exists(remaining_listing_id));

    let listing = shop.listing(remaining_listing_id);
    let name = listing.listing_name();
    let price = listing.listing_base_price_usd_cents();
    let stock = listing.listing_stock();
    let spotlight = listing.listing_spotlight_discount_template_id();
    assert_eq!(name, b"Repair Kit".to_string());
    assert_eq!(price, 42_00);
    assert_eq!(stock, 2);
    assert_eq!(spotlight, option::none());

    remove_listing_if_exists(&mut shop, &owner_cap, remaining_listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_foreign_shop, foreign_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Borrowed Owner".to_string(),
        30_00,
        6,
        option::none(),
        &mut ctx,
    );

    shop.remove_item_listing(
        &foreign_cap,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun remove_item_listing_rejects_unknown_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<TestItem>(
        &other_cap,
        b"Foreign Stock".to_string(),
        55_00,
        4,
        option::none(),
        &mut ctx,
    );

    shop.remove_item_listing(
        &owner_cap,
        foreign_listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingHasActiveTemplates)]
fun remove_item_listing_rejects_listing_with_active_bound_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Template Locked Listing".to_string(),
        45_00,
        2,
        option::none(),
        &mut ctx,
    );
    let _template_id = shop.test_create_discount_template_local(
        option::some(listing_id),
        0,
        500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop.remove_item_listing(
        &owner_cap,
        listing_id,
    );

    abort
}

#[test]
fun remove_item_listing_allows_listing_with_inactive_bound_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Template Paused Listing".to_string(),
        45_00,
        2,
        option::none(),
        &mut ctx,
    );
    let template = shop.test_create_discount_template_local(
        option::some(listing_id),
        0,
        500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop.toggle_discount_template(
        &owner_cap,
        template,
        false,
    );
    shop.remove_item_listing(
        &owner_cap,
        listing_id,
    );

    assert!(!shop.listing_exists(listing_id));
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun update_item_listing_stock_accept_zero_stock() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Maintenance Kit".to_string(),
        32_00,
        5,
        option::none(),
        &mut ctx,
    );

    shop.update_item_listing_stock(
        &owner_cap,
        listing_id,
        0,
    );

    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun create_discount_template_persists_fields_and_emits_event() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template_id = shop.test_create_discount_template_local(
        option::none(),
        0,
        1_250,
        10,
        option::some(50),
        option::some(5),
        &mut ctx,
    );
    assert!(shop.discount_template_exists(template_id));

    let template_values = shop.discount_template(template_id);
    let applies_to_listing = template_values.discount_template_applies_to_listing();
    let rule = template_values.discount_template_rule();
    let starts_at = template_values.discount_template_starts_at();
    let expires_at = template_values.discount_template_expires_at();
    let max_redemptions = template_values.discount_template_max_redemptions();
    let claims_issued = template_values.discount_template_claims_issued();
    let redemptions = template_values.discount_template_redemptions();
    let active = template_values.discount_template_active();

    assert!(option::is_none(&applies_to_listing));
    let rule_kind = rule.discount_rule_kind();
    let rule_value = rule.discount_rule_value();
    assert_eq!(rule_kind, 0);
    assert_eq!(rule_value, 1_250);
    assert_eq!(starts_at, 10);
    assert!(option::is_some(&expires_at));
    expires_at.do_ref!(|value| {
        assert_eq!(*value, 50);
    });
    assert!(option::is_some(&max_redemptions));
    max_redemptions.do_ref!(|value| {
        assert_eq!(*value, 5);
    });
    assert_eq!(claims_issued, 0);
    assert_eq!(redemptions, 0);
    assert!(active);

    assert_emitted!(events::discount_template_created(shop.shop_id(), template_id));

    shop.remove_discount_template(&owner_cap, template_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun create_discount_template_links_listing_and_percent_rule() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Wheelset".to_string(),
        600_00,
        4,
        option::none(),
        &mut ctx,
    );

    let template_id = shop.test_create_discount_template_local(
        option::some(listing_id),
        1,
        2_500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    assert!(shop.discount_template_exists(template_id));
    let template_values = shop.discount_template(template_id);
    let applies_to_listing = template_values.discount_template_applies_to_listing();
    let rule = template_values.discount_template_rule();
    let starts_at = template_values.discount_template_starts_at();
    let expires_at = template_values.discount_template_expires_at();
    let max_redemptions = template_values.discount_template_max_redemptions();
    let claims_issued = template_values.discount_template_claims_issued();
    let redemptions = template_values.discount_template_redemptions();
    let active = template_values.discount_template_active();

    assert!(option::is_some(&applies_to_listing));
    applies_to_listing.do_ref!(|value| {
        assert_eq!(*value, listing_id);
    });
    let rule_kind = rule.discount_rule_kind();
    let rule_value = rule.discount_rule_value();
    assert_eq!(rule_kind, 1);
    assert_eq!(rule_value, 2_500);
    assert_eq!(starts_at, 0);
    assert!(option::is_none(&expires_at));
    assert!(option::is_none(&max_redemptions));
    assert_eq!(claims_issued, 0);
    assert_eq!(redemptions, 0);
    assert!(active);

    assert_emitted!(events::discount_template_created(shop.shop_id(), template_id));

    shop.remove_discount_template(&owner_cap, template_id);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun create_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop.create_discount_template(
        &other_cap,
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleKind)]
fun create_discount_template_rejects_invalid_rule_kind() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop.create_discount_template(
        &owner_cap,
        option::none(),
        2,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleValue)]
fun create_discount_template_rejects_percent_above_limit() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop.create_discount_template(
        &owner_cap,
        option::none(),
        1,
        10_001,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    abort
}

#[test]
fun percent_discount_rounds_up_instead_of_zeroing_low_prices() {
    let discounted = shop::apply_percent_discount(1, 100);
    assert_eq!(discounted, 1);
}

#[test]
fun percent_discount_allows_full_discount_to_reach_zero() {
    let discounted = shop::apply_percent_discount(1, 10_000);
    assert_eq!(discounted, 0);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleValue)]
fun percent_discount_rejects_basis_points_above_denominator() {
    let _ = shop::apply_percent_discount(1, 10_001);
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateWindow)]
fun create_discount_template_rejects_invalid_schedule() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop.create_discount_template(
        &owner_cap,
        option::none(),
        0,
        1_000,
        10,
        option::some(10),
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun create_discount_template_rejects_foreign_listing_reference() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<TestItem>(
        &other_cap,
        b"Foreign Listing".to_string(),
        7_500,
        2,
        option::none(),
        &mut ctx,
    );

    shop.create_discount_template(
        &owner_cap,
        option::some(foreign_listing_id),
        0,
        500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    abort
}

#[test]
fun update_discount_template_updates_fields_and_emits_event() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Wheelset".to_string(),
        600_00,
        4,
        option::none(),
        &mut ctx,
    );

    let template = shop.test_create_discount_template_local(
        option::some(listing_id),
        0,
        1_000,
        10,
        option::some(20),
        option::some(2),
        &mut ctx,
    );

    let clock_obj = create_test_clock_at(&mut ctx, 1);
    shop.update_discount_template(
        &owner_cap,
        template,
        1,
        750,
        50,
        option::some(200),
        option::some(10),
        &clock_obj,
    );
    std::unit_test::destroy(clock_obj);

    let template_values = shop.discount_template(template);
    let applies_to_listing = template_values.discount_template_applies_to_listing();
    let rule = template_values.discount_template_rule();
    let starts_at = template_values.discount_template_starts_at();
    let expires_at = template_values.discount_template_expires_at();
    let max_redemptions = template_values.discount_template_max_redemptions();
    let claims_issued = template_values.discount_template_claims_issued();
    let redemptions = template_values.discount_template_redemptions();
    let active = template_values.discount_template_active();
    assert!(option::is_some(&applies_to_listing));
    applies_to_listing.do_ref!(|value| {
        assert_eq!(*value, listing_id);
    });
    let rule_kind = rule.discount_rule_kind();
    let rule_value = rule.discount_rule_value();
    assert_eq!(rule_kind, 1);
    assert_eq!(rule_value, 750);
    assert_eq!(starts_at, 50);
    assert!(option::is_some(&expires_at));
    expires_at.do_ref!(|value| {
        assert_eq!(*value, 200);
    });
    assert!(option::is_some(&max_redemptions));
    max_redemptions.do_ref!(|value| {
        assert_eq!(*value, 10);
    });
    assert_eq!(claims_issued, 0);
    assert_eq!(redemptions, 0);
    assert!(active);

    assert_emitted!(events::discount_template_updated(shop.shop_id(), template));

    shop.remove_discount_template(&owner_cap, template);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, _shop_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount_template(
        &other_cap,
        template,
        0,
        250,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun update_discount_template_rejects_foreign_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, _other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );
    let foreign_template = other_shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount_template(
        &owner_cap,
        foreign_template,
        0,
        250,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateWindow)]
fun update_discount_template_rejects_invalid_schedule() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount_template(
        &owner_cap,
        template,
        0,
        1_000,
        100,
        option::some(50),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleKind)]
fun update_discount_template_rejects_invalid_rule_kind() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount_template(
        &owner_cap,
        template,
        2,
        1_000,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleValue)]
fun update_discount_template_rejects_percent_above_limit() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount_template(
        &owner_cap,
        template,
        1,
        10_001,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateFinalized)]
fun update_discount_template_rejects_after_claims_issued() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::some(5_000),
        option::some(2),
        &mut ctx,
    );

    let mut clock_obj = create_test_clock_at(&mut ctx, 1);
    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    shop.update_discount_template(
        &owner_cap,
        template,
        0,
        250,
        0,
        option::some(10_000),
        option::some(1),
        &clock_obj,
    );

    clock::set_for_testing(&mut clock_obj, 10_000);
    shop.prune_discount_claims(
        &owner_cap,
        template,
        vector[TEST_OWNER],
        &clock_obj,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateFinalized)]
fun update_discount_template_rejects_after_expiry() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::some(100),
        option::some(5),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 200_000);

    shop.update_discount_template(
        &owner_cap,
        template,
        1,
        250,
        0,
        option::some(500),
        option::some(10),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateFinalized)]
fun update_discount_template_rejects_after_maxed_out() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        450,
        0,
        option::some(10_000),
        option::some(1),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 1_000);
    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    shop.update_discount_template(
        &owner_cap,
        template,
        0,
        250,
        0,
        option::some(10_500),
        option::some(2),
        &clock_obj,
    );

    shop.prune_discount_claims(
        &owner_cap,
        template,
        vector[TEST_OWNER],
        &clock_obj,
    );
    abort
}

#[test]
fun toggle_discount_template_updates_active_and_emits_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        2_000,
        25,
        option::some(50),
        option::some(3),
        &mut ctx,
    );

    let template_values = shop.discount_template(template);
    let applies_to_listing = template_values.discount_template_applies_to_listing();
    let rule = template_values.discount_template_rule();
    let starts_at = template_values.discount_template_starts_at();
    let expires_at = template_values.discount_template_expires_at();
    let max_redemptions = template_values.discount_template_max_redemptions();
    let claims_issued = template_values.discount_template_claims_issued();
    let redemptions = template_values.discount_template_redemptions();
    let active = template_values.discount_template_active();

    assert!(active);
    shop.toggle_discount_template(
        &owner_cap,
        template,
        false,
    );

    let template_values_after_first = shop.discount_template(template);
    let applies_to_listing_after_first = template_values_after_first.discount_template_applies_to_listing();
    let rule_after_first = template_values_after_first.discount_template_rule();
    let starts_at_after_first = template_values_after_first.discount_template_starts_at();
    let expires_at_after_first = template_values_after_first.discount_template_expires_at();
    let max_redemptions_after_first = template_values_after_first.discount_template_max_redemptions();
    let claims_issued_after_first = template_values_after_first.discount_template_claims_issued();
    let redemptions_after_first = template_values_after_first.discount_template_redemptions();
    let active_after_first = template_values_after_first.discount_template_active();

    assert_eq!(applies_to_listing_after_first, applies_to_listing);
    let rule_kind = rule.discount_rule_kind();
    let rule_value = rule.discount_rule_value();
    let rule_after_first_kind = rule_after_first.discount_rule_kind();
    let rule_after_first_value = rule_after_first.discount_rule_value();
    assert_eq!(rule_after_first_kind, rule_kind);
    assert_eq!(rule_after_first_value, rule_value);
    assert_eq!(starts_at_after_first, starts_at);
    assert_eq!(expires_at_after_first, expires_at);
    assert_eq!(max_redemptions_after_first, max_redemptions);
    assert_eq!(claims_issued_after_first, claims_issued);
    assert_eq!(redemptions_after_first, redemptions);
    assert!(!active_after_first);

    shop.toggle_discount_template(
        &owner_cap,
        template,
        true,
    );

    let template_values_after_second = shop.discount_template(template);
    let applies_to_listing_after_second = template_values_after_second.discount_template_applies_to_listing();
    let rule_after_second = template_values_after_second.discount_template_rule();
    let starts_at_after_second = template_values_after_second.discount_template_starts_at();
    let expires_at_after_second = template_values_after_second.discount_template_expires_at();
    let max_redemptions_after_second = template_values_after_second.discount_template_max_redemptions();
    let claims_issued_after_second = template_values_after_second.discount_template_claims_issued();
    let redemptions_after_second = template_values_after_second.discount_template_redemptions();
    let active_after_second = template_values_after_second.discount_template_active();
    assert_eq!(applies_to_listing_after_second, applies_to_listing);
    let rule_after_second_kind = rule_after_second.discount_rule_kind();
    let rule_after_second_value = rule_after_second.discount_rule_value();
    assert_eq!(rule_after_second_kind, rule_kind);
    assert_eq!(rule_after_second_value, rule_value);
    assert_eq!(starts_at_after_second, starts_at);
    assert_eq!(expires_at_after_second, expires_at);
    assert_eq!(max_redemptions_after_second, max_redemptions);
    assert_eq!(claims_issued_after_second, claims_issued);
    assert_eq!(redemptions_after_second, redemptions);
    assert!(active_after_second);

    assert_emitted!(events::discount_template_toggled(shop.shop_id(), template));
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 2);

    shop.remove_discount_template(&owner_cap, template);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.toggle_discount_template(
        &other_cap,
        template,
        false,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun toggle_discount_template_rejects_foreign_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, _other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );
    let foreign_template = other_shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.toggle_discount_template(
        &owner_cap,
        foreign_template,
        false,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun toggle_discount_template_rejects_unknown_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let stray_template = shop.test_create_discount_template_local(
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.remove_discount_template(&owner_cap, stray_template);

    shop.toggle_discount_template(
        &owner_cap,
        stray_template,
        false,
    );

    abort
}

#[test]
fun toggle_template_on_listing_sets_and_clears_spotlight() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Promo Jacket".to_string(),
        180_00,
        6,
        option::none(),
        &mut ctx,
    );
    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );
    let ids_before_toggle = tx_context::get_ids_created(&ctx);

    let listing_before = shop.listing(listing_id);
    let spotlight_before = listing_before.listing_spotlight_discount_template_id();
    assert!(option::is_none(&spotlight_before));
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop.attach_template_to_listing(
        &owner_cap,
        template,
        listing_id,
    );

    let listing_after_set = shop.listing(listing_id);
    let spotlight_after_set = listing_after_set.listing_spotlight_discount_template_id();
    assert!(option::is_some(&spotlight_after_set));
    spotlight_after_set.do_ref!(|value| {
        assert_eq!(*value, template);
    });
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before_toggle);
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop.clear_template_from_listing(
        &owner_cap,
        listing_id,
    );

    let listing_after_clear = shop.listing(listing_id);
    let spotlight_after_clear = listing_after_clear.listing_spotlight_discount_template_id();
    assert!(option::is_none(&spotlight_after_clear));
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before_toggle);
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop.remove_discount_template(&owner_cap, template);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_template_on_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Chain Lube".to_string(),
        12_00,
        30,
        option::none(),
        &mut ctx,
    );
    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.attach_template_to_listing(
        &other_cap,
        template,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun toggle_template_on_listing_rejects_foreign_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<TestItem>(
        &other_cap,
        b"Spare Tube".to_string(),
        8_00,
        15,
        option::none(),
        &mut ctx,
    );
    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.attach_template_to_listing(
        &owner_cap,
        template,
        foreign_listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun toggle_template_on_listing_rejects_foreign_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, _other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Bike Pump".to_string(),
        35_00,
        10,
        option::none(),
        &mut ctx,
    );
    let foreign_template = other_shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.attach_template_to_listing(
        &owner_cap,
        foreign_template,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun toggle_template_on_listing_rejects_unknown_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Frame Protector".to_string(),
        22_00,
        40,
        option::none(),
        &mut ctx,
    );
    let stray_template = shop.test_create_discount_template_local(
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.remove_discount_template(&owner_cap, stray_template);

    shop.attach_template_to_listing(
        &owner_cap,
        stray_template,
        listing_id,
    );

    abort
}

#[test]
fun attach_template_to_listing_sets_spotlight_without_emitting_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Promo Bag".to_string(),
        95_00,
        12,
        option::none(),
        &mut ctx,
    );
    let template = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let ids_before = tx_context::get_ids_created(&ctx);

    shop.attach_template_to_listing(
        &owner_cap,
        template,
        listing_id,
    );

    let listing = shop.listing(listing_id);
    let spotlight = listing.listing_spotlight_discount_template_id();
    assert!(option::is_some(&spotlight));
    spotlight.do_ref!(|value| {
        assert_eq!(*value, template);
    });
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before);
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);
    assert!(shop.discount_template_exists(template));

    shop.remove_discount_template(&owner_cap, template);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun attach_template_to_listing_overwrites_existing_spotlight() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let first_template = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Bundle".to_string(),
        140_00,
        3,
        option::some(first_template),
        &mut ctx,
    );
    let second_template = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let ids_before = tx_context::get_ids_created(&ctx);

    let listing_before = shop.listing(listing_id);
    let spotlight_before = listing_before.listing_spotlight_discount_template_id();
    assert!(option::is_some(&spotlight_before));
    spotlight_before.do_ref!(|value| {
        assert_eq!(*value, first_template);
    });

    shop.attach_template_to_listing(
        &owner_cap,
        second_template,
        listing_id,
    );

    let listing_after = shop.listing(listing_id);
    let spotlight_after = listing_after.listing_spotlight_discount_template_id();
    assert!(option::is_some(&spotlight_after));
    spotlight_after.do_ref!(|value| {
        assert_eq!(*value, second_template);
    });
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before);
    assert!(shop.discount_template_exists(first_template));
    assert!(shop.discount_template_exists(second_template));
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop.remove_discount_template(&owner_cap, second_template);
    shop.remove_discount_template(&owner_cap, first_template);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun attach_template_to_listing_accepts_matching_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Bundle".to_string(),
        140_00,
        3,
        option::none(),
        &mut ctx,
    );
    let template = shop.test_create_discount_template_local(
        option::some(listing_id),
        0,
        50,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop.attach_template_to_listing(
        &owner_cap,
        template,
        listing_id,
    );

    let listing = shop.listing(listing_id);
    let spotlight = listing.listing_spotlight_discount_template_id();
    assert!(option::is_some(&spotlight));
    spotlight.do_ref!(|value| {
        assert_eq!(*value, template);
    });
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun attach_template_to_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Helmet Stickers".to_string(),
        9_00,
        10,
        option::none(),
        &mut ctx,
    );
    let template = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    shop.attach_template_to_listing(
        &other_cap,
        template,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun attach_template_to_listing_rejects_foreign_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<TestItem>(
        &other_cap,
        b"Brake Pads".to_string(),
        18_00,
        4,
        option::none(),
        &mut ctx,
    );
    let template = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    shop.attach_template_to_listing(
        &owner_cap,
        template,
        foreign_listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun attach_template_to_listing_rejects_foreign_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Chain Whip".to_string(),
        27_00,
        5,
        option::none(),
        &mut ctx,
    );
    let foreign_template = create_discount_template(
        &mut other_shop,
        &other_cap,
        &mut ctx,
    );

    shop.attach_template_to_listing(
        &owner_cap,
        foreign_template,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun attach_template_to_listing_rejects_unknown_template() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Pedals".to_string(),
        51_00,
        6,
        option::none(),
        &mut ctx,
    );
    let stray_template = shop.test_create_discount_template_local(
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.remove_discount_template(&owner_cap, stray_template);

    shop.attach_template_to_listing(
        &owner_cap,
        stray_template,
        listing_id,
    );

    abort
}

#[test]
fun clear_template_from_listing_removes_spotlight_without_side_effects() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Rain Jacket".to_string(),
        120_00,
        7,
        option::none(),
        &mut ctx,
    );
    let template = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    shop.attach_template_to_listing(
        &owner_cap,
        template,
        listing_id,
    );

    let listing_before = shop.listing(listing_id);
    let spotlight_before = listing_before.listing_spotlight_discount_template_id();
    let created_before = tx_context::get_ids_created(&ctx);
    assert!(option::is_some(&spotlight_before));
    spotlight_before.do_ref!(|value| {
        assert_eq!(*value, template);
    });

    shop.clear_template_from_listing(
        &owner_cap,
        listing_id,
    );

    let listing_after = shop.listing(listing_id);
    let spotlight_after = listing_after.listing_spotlight_discount_template_id();
    assert!(option::is_none(&spotlight_after));
    assert_eq!(tx_context::get_ids_created(&ctx), created_before);
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);
    assert!(shop.discount_template_exists(template));

    shop.remove_discount_template(&owner_cap, template);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun clear_template_from_listing_is_noop_when_no_spotlight_set() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Bar Tape".to_string(),
        19_00,
        25,
        option::none(),
        &mut ctx,
    );
    let created_before = tx_context::get_ids_created(&ctx);

    shop.clear_template_from_listing(
        &owner_cap,
        listing_id,
    );

    let listing_after = shop.listing(listing_id);
    let spotlight_after = listing_after.listing_spotlight_discount_template_id();
    assert!(option::is_none(&spotlight_after));
    assert_eq!(tx_context::get_ids_created(&ctx), created_before);
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun clear_template_from_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Valve Stem".to_string(),
        11_00,
        14,
        option::none(),
        &mut ctx,
    );

    shop.clear_template_from_listing(
        &other_cap,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun clear_template_from_listing_rejects_foreign_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<TestItem>(
        &other_cap,
        b"Cassette".to_string(),
        85_00,
        9,
        option::none(),
        &mut ctx,
    );

    shop.clear_template_from_listing(
        &owner_cap,
        foreign_listing_id,
    );

    abort
}

#[test]
fun claim_discount_ticket_mints_transfers_and_records_claim() {
    let mut scn = test_scenario::begin(TEST_OWNER);

    let (shop_id, owner_cap_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Limited Helmet".to_string(),
        120_00,
        3,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap,
        option::some(listing_id),
        0,
        1_500,
        5,
        option::some(50),
        option::some(10),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10_000);
    let template_values_before = shared_shop.discount_template(template_id);
    let claims_issued_before = template_values_before.discount_template_claims_issued();

    shared_shop.claim_discount_ticket(
        template_id,
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );
    let ticket_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    let template_values_after = shared_shop.discount_template(template_id);
    let claims_issued_after = template_values_after.discount_template_claims_issued();
    assert_eq!(claims_issued_after, claims_issued_before + 1);
    assert!(
        shared_shop.discount_claim_exists(
            template_id,
            OTHER_OWNER,
        ),
    );

    assert_emitted!(events::discount_claimed(shop_id, ticket_id));

    test_scenario::return_shared(shared_shop);
    std::unit_test::destroy(clock_obj);

    let effects = test_scenario::next_tx(&mut scn, OTHER_OWNER);
    assert_eq!(test_scenario::num_user_events(&effects), 1);
    let ticket = test_scenario::take_from_sender_by_id<shop::DiscountTicket>(
        &scn,
        ticket_id,
    );
    let ticket_template = ticket.discount_ticket_discount_template_id();
    let ticket_shop = ticket.discount_ticket_shop_id();
    let ticket_listing = ticket.discount_ticket_listing_id();
    let ticket_owner = ticket.discount_ticket_claimer();
    assert_eq!(ticket_template, template_id);
    assert_eq!(ticket_shop, shop_id);
    assert!(option::is_some(&ticket_listing));
    ticket_listing.do_ref!(|value| {
        assert_eq!(*value, listing_id);
    });
    assert_eq!(ticket_owner, OTHER_OWNER);
    test_scenario::return_to_sender(&scn, ticket);

    let _ = test_scenario::end(scn);
}

#[test]
fun prune_discount_claims_removes_marker_when_expired() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        1_000,
        0,
        option::some(1_000),
        option::none(),
        &mut ctx,
    );
    let mut clock_obj = create_test_clock_at(&mut ctx, 1_000);

    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);
    let claimer = tx_context::sender(&ctx);
    assert!(shop.discount_claim_exists(template, claimer));

    clock::set_for_testing(&mut clock_obj, 1_001_000);
    let mut claimers = vector[];
    claimers.push_back(claimer);
    shop.prune_discount_claims(
        &owner_cap,
        template,
        claimers,
        &clock_obj,
    );

    assert!(!shop.discount_claim_exists(template, claimer));

    std::unit_test::destroy(clock_obj);
    shop.remove_discount_template(&owner_cap, template);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountClaimsNotPrunable)]
fun prune_discount_claims_rejects_unexpired_template_even_if_paused() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        1_000,
        0,
        option::some(1_000),
        option::none(),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 1_000);

    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);
    let claimer = tx_context::sender(&ctx);
    let mut claimers = vector[];
    claimers.push_back(claimer);

    shop.toggle_discount_template(
        &owner_cap,
        template,
        false,
    );
    shop.prune_discount_claims(
        &owner_cap,
        template,
        claimers,
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateTooEarly)]
fun claim_discount_ticket_rejects_before_start_time() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 20, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        10,
        option::none(),
        option::none(),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 5_000);

    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateExpired)]
fun claim_discount_ticket_rejects_after_expiry() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 21, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        700,
        0,
        option::some(3),
        option::some(5),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 4_000);

    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateInactive)]
fun claim_discount_ticket_rejects_inactive_template() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 22, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        1_000,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.toggle_discount_template(
        &owner_cap,
        template,
        false,
    );
    let clock_obj = clock::create_for_testing(&mut ctx);

    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateMaxedOut)]
fun claim_discount_ticket_rejects_when_maxed() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 23, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        450,
        0,
        option::none(),
        option::some(0),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 2_000);
    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountAlreadyClaimed)]
fun claim_discount_ticket_rejects_duplicate_claim() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 24, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let template = shop.test_create_discount_template_local(
        option::none(),
        0,
        1_250,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 1_000);
    let ticket = shop.claim_discount_ticket_inline(
        template,
        1,
        &mut ctx,
    );
    std::unit_test::destroy(ticket);

    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun claim_discount_ticket_rejects_missing_listing_for_listing_scoped_template_after_listing_removal() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 240, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let listing_id = shop.add_item_listing<TestItem>(
        &owner_cap,
        b"Scoped Listing".to_string(),
        1_250,
        2,
        option::none(),
        &mut ctx,
    );

    let template = shop.test_create_discount_template_local(
        option::some(listing_id),
        0,
        250,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.toggle_discount_template(&owner_cap, template, false);
    remove_listing_if_exists(&mut shop, &owner_cap, listing_id);

    let clock_obj = create_test_clock_at(&mut ctx, 1_000);
    shop.claim_discount_ticket(template, &clock_obj, &mut ctx);

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountAlreadyClaimed)]
fun claim_and_buy_rejects_second_claim_after_redeem() {
    let mut scn = test_scenario::begin(TEST_OWNER);

    let (shop_id, owner_cap_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap: shop::ShopOwnerCap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    transfer::public_transfer(owner_cap, @0x0);

    let _ = test_scenario::next_tx(&mut scn, @0x0);

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let currency = create_test_currency(test_scenario::ctx(&mut scn));
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Promo Sock".to_string(),
        100,
        2,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap,
        option::some(listing_id),
        1,
        10_000,
        0,
        option::some(1_000),
        option::some(5),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj: price_info::PriceInfoObject = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);

    let payment = coin::mint_for_testing<TestCoin>(1, test_scenario::ctx(&mut scn));
    shared_shop.claim_and_buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    assert!(
        shared_shop.discount_claim_exists(
            template_id,
            OTHER_OWNER,
        ),
    );

    shared_shop.claim_discount_ticket(
        template_id,
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test]
fun claim_and_buy_item_with_discount_emits_events_and_covers_helpers() {
    let mut scn = test_scenario::begin(TEST_OWNER);

    let (shop_id, owner_cap_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    let accepted_currency_id = price_info_id;
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Promo Item".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap,
        option::some(listing_id),
        1,
        10_000,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let (mut shared_shop, price_info_obj, clock_obj) = begin_buyer_checkout_context(
        &mut scn,
        OTHER_OWNER,
        shop_id,
        price_info_id,
        10,
    );
    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );
    let template_values_before = shared_shop.discount_template(template_id);
    let claims_issued_before = template_values_before.discount_template_claims_issued();
    let redemptions_before = template_values_before.discount_template_redemptions();

    shared_shop.claim_and_buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );
    let minted_item_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();
    assert_emitted!(
        events::purchase_completed(
            shop_id,
            listing_id,
            accepted_currency_id,
            option::some(template_id),
            minted_item_id,
            0,
            0,
        ),
    );
    let template_values_after = shared_shop.discount_template(template_id);
    let claims_issued_after = template_values_after.discount_template_claims_issued();
    let redemptions_after = template_values_after.discount_template_redemptions();
    assert_eq!(claims_issued_after, claims_issued_before + 1);
    assert_eq!(redemptions_after, redemptions_before + 1);
    assert!(shared_shop.discount_claim_exists(template_id, OTHER_OWNER));

    assert!(shared_shop.listing_exists(listing_id));
    let template_address = template_id.to_address();
    let template_id_opt = shared_shop.discount_template_id_for_address(template_address);
    assert!(option::is_some(&template_id_opt));

    assert!(
        shared_shop.accepted_currency_exists(
            test_coin_type(),
        ),
    );

    close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let effects = test_scenario::next_tx(&mut scn, OTHER_OWNER);
    let user_event_count = test_scenario::num_user_events(&effects);
    assert!(user_event_count >= 3);
    let discount_ticket_ids = test_scenario::ids_for_sender<shop::DiscountTicket>(&scn);
    assert_eq!(discount_ticket_ids.length(), 0);

    let _ = test_scenario::end(scn);
}

#[test]
fun test_init_claims_publisher() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 9991, 0, 0, 0);
    shop::test_init(&mut ctx);
}

#[test]
fun listing_and_template_id_for_address_return_none_when_missing() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 9993, 0, 0, 0);
    let (shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let missing_listing_identifier = missing_listing_id();

    assert!(!shop_obj.listing_exists(missing_listing_identifier));
    let missing_address = @0x1234;
    let template_id_opt = shop_obj.discount_template_id_for_address(missing_address);
    assert!(option::is_none(&template_id_opt));

    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyShopName)]
fun create_shop_rejects_empty_name() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10001, 0, 0, 0);
    shop::create_shop(b"".to_string(), &mut ctx);
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun listing_rejects_foreign_shop() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10002, 0, 0, 0);
    let (mut shop_a, owner_cap_a) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (shop_b, _owner_cap_b) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let listing_id = shop_a.add_item_listing<TestItem>(
        &owner_cap_a,
        b"Item".to_string(),
        100,
        1,
        option::none(),
        &mut ctx,
    );

    shop_b.listing(listing_id);
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateNotFound)]
fun discount_template_rejects_foreign_shop() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10003, 0, 0, 0);
    let (mut shop_a, _owner_cap_a) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (shop_b, _owner_cap_b) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let template = shop_a.test_create_discount_template_local(
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop_b.discount_template(template);
    abort
}

#[test]
fun remove_listing_and_template_noop_when_missing() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10004, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let dummy_uid = object::new(&mut ctx);
    let dummy_id = dummy_uid.to_inner();
    dummy_uid.delete();
    let missing_listing_identifier = missing_listing_id();

    remove_listing_if_exists(&mut shop_obj, &owner_cap, missing_listing_identifier);
    shop_obj.remove_discount_template(&owner_cap, dummy_id);

    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test]
fun remove_discount_template_drops_template_and_clears_spotlight() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 100041, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Template Listing".to_string(),
        100,
        1,
        option::none(),
        &mut ctx,
    );
    let template_id = shop_obj.test_create_discount_template_local(
        option::some(listing_id),
        0,
        10,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop_obj.attach_template_to_listing(
        &owner_cap,
        template_id,
        listing_id,
    );
    shop_obj.remove_discount_template(&owner_cap, template_id);

    assert!(!shop_obj.discount_template_exists(template_id));
    let listing = shop_obj.listing(listing_id);
    let spotlight_after = listing.listing_spotlight_discount_template_id();
    assert!(option::is_none(&spotlight_after));

    remove_listing_if_exists(&mut shop_obj, &owner_cap, listing_id);
    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 100042, 0, 0, 0);
    let (mut shop_obj, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let template_id = shop_obj.test_create_discount_template_local(
        option::none(),
        0,
        10,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop_obj.remove_discount_template(&other_cap, template_id);
    abort
}

#[test]
fun quote_amount_with_positive_exponent() {
    let price_value = i64::new(1_000, false);
    let expo = i64::new(2, false);
    let price = price::new(price_value, 10, expo, 0);
    let amount = shop::quote_amount_from_usd_cents(
        100,
        9,
        price,
        TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );
    assert!(amount > 0);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EUnsupportedCurrencyDecimals)]
fun quote_amount_rejects_large_exponent() {
    let price = sample_price();
    let _ = shop::quote_amount_from_usd_cents(
        100,
        39,
        price,
        TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EShopDisabled)]
fun claim_discount_ticket_rejects_when_shop_disabled() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10005, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let template = shop_obj.test_create_discount_template_local(
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop_obj.disable_shop(&owner_cap);
    let clock_obj = clock::create_for_testing(&mut ctx);

    shop_obj.claim_discount_ticket(template, &clock_obj, &mut ctx);
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EShopDisabled)]
fun claim_discount_ticket_inline_rejects_when_shop_disabled() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10006, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let template = shop_obj.test_create_discount_template_local(
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop_obj.disable_shop(&owner_cap);

    let _ticket = shop_obj.claim_discount_ticket_inline(template, 1, &mut ctx);
    abort
}

#[test]
fun discount_redemption_without_listing_restriction_allows_zero_price() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Freebie".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap,
        option::none(),
        0,
        1_000,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);

    let payment = coin::mint_for_testing<TestCoin>(1, test_scenario::ctx(&mut scn));
    shared_shop.claim_and_buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );
    let minted_item_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();
    assert_emitted!(
        events::purchase_completed(
            shop_id,
            listing_id,
            price_info_id,
            option::some(template_id),
            minted_item_id,
            0,
            0,
        ),
    );

    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = test_scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketListingMismatch)]
fun discount_redemption_rejects_listing_mismatch() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_a_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Listing A".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let listing_b_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Listing B".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap,
        option::some(listing_a_id),
        1,
        100,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.claim_and_buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        &price_info_obj,
        payment,
        listing_b_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateMaxedOut)]
fun discount_template_maxed_out_by_redemption() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Promo".to_string(),
        100,
        2,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap,
        option::some(listing_id),
        1,
        100,
        0,
        option::none(),
        option::some(1),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);

    test_scenario::return_to_sender(&scn, owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.claim_and_buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.claim_discount_ticket(
        template_id,
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun checkout_rejects_price_info_object_from_other_shop() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (
        _shop_a_id,
        _currency_a_id,
        _listing_a_id,
        price_info_a_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);
    let (
        shop_b_id,
        _currency_b_id,
        listing_b_id,
        _price_info_b_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop_b = take_shared_shop(&scn, shop_b_id);
    let price_info_a: price_info::PriceInfoObject = test_scenario::take_shared_by_id(
        &scn,
        price_info_a_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let payment = coin::mint_for_testing<TestCoin>(1, test_scenario::ctx(&mut scn));

    shared_shop_b.buy_item<TestItem, TestCoin>(
        &price_info_a,
        payment,
        listing_b_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun checkout_rejects_listing_not_registered_in_shop() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (
        shop_id,
        _currency_id,
        _listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info: price_info::PriceInfoObject = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let payment = coin::mint_for_testing<TestCoin>(1, test_scenario::ctx(&mut scn));

    shared_shop.buy_item<TestItem, TestCoin>(
        &price_info,
        payment,
        missing_listing_id(),
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun checkout_rejects_currency_from_other_shop() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (
        shop_a_id,
        _currency_a_id,
        listing_a_id,
        _price_info_a_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);
    let (
        _shop_b_id,
        _currency_b_id,
        _listing_b_id,
        price_info_b_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop_a = take_shared_shop(&scn, shop_a_id);
    let price_info_b: price_info::PriceInfoObject = test_scenario::take_shared_by_id(
        &scn,
        price_info_b_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let payment = coin::mint_for_testing<TestCoin>(1, test_scenario::ctx(&mut scn));

    shared_shop_a.buy_item<TestItem, TestCoin>(
        &price_info_b,
        payment,
        listing_a_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceStatusNotTrading)]
fun price_status_rejects_attestation_before_publish() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let price_value = i64::new(1_000, false);
    let expo = i64::new(0, false);
    let price = price::new(price_value, 10, expo, 100);
    let price_info_object = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        50,
        0,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    transfer::public_share_object(price_info_object);
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 1000);

    shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ESpotlightTemplateListingMismatch)]
fun add_item_listing_rejects_spotlight_template_listing_mismatch() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10006, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Listing A".to_string(),
        100,
        1,
        option::none(),
        &mut ctx,
    );

    let template_id = shop_obj.test_create_discount_template_local(
        option::some(listing_id),
        0,
        50,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Listing B".to_string(),
        100,
        1,
        option::some(template_id),
        &mut ctx,
    );

    abort
}

#[test]
fun prune_discount_claims_noop_for_unclaimed_claimer() {
    let mut ctx = tx_context::new_from_hint(TEST_OWNER, 10007, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let template = shop_obj.test_create_discount_template_local(
        option::none(),
        0,
        50,
        0,
        option::some(1),
        option::none(),
        &mut ctx,
    );
    let clock_obj = create_test_clock_at(&mut ctx, 2_000);

    shop_obj.prune_discount_claims(
        &owner_cap,
        template,
        vector[OTHER_OWNER],
        &clock_obj,
    );

    std::unit_test::destroy(clock_obj);
    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun accepted_currency_rejects_foreign_shop() {
    let mut scn = test_scenario::begin(TEST_OWNER);

    let (shop_a_id, owner_cap_a_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let (shop_b_id, _) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let mut shop_obj = take_shared_shop(&scn, shop_a_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_a_id,
    );
    add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        PRIMARY_FEED_ID,
        option::none(),
        option::none(),
        option::none(),
    );

    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    std::unit_test::destroy(currency);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop_b = take_shared_shop(&scn, shop_b_id);

    shared_shop_b.accepted_currency<TestCoin>();
    abort
}

#[test]
fun remove_currency_field_clears_mapping() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        PRIMARY_FEED_ID,
        option::none(),
        option::none(),
        option::none(),
    );

    remove_currency_if_exists<TestCoin>(&mut shop_obj, &owner_cap_obj);
    assert!(!shop_obj.accepted_currency_exists(test_coin_type()));

    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    std::unit_test::destroy(currency);
    let _ = test_scenario::end(scn);
}

#[test]
fun remove_accepted_currency_emits_removed_event_fields() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let accepted_currency_id = add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        PRIMARY_FEED_ID,
        option::none(),
        option::none(),
        option::none(),
    );

    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let owner_cap = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shared_shop.remove_accepted_currency<TestCoin>(
        &owner_cap,
    );

    assert_emitted!(
        events::accepted_coin_removed(
            shared_shop.shop_id(),
            accepted_currency_id,
        ),
    );

    test_scenario::return_shared(shared_shop);
    test_scenario::return_to_sender(&scn, owner_cap);
    std::unit_test::destroy(currency);
    let _ = test_scenario::end(scn);
}

fun setup_shop_with_currency_listing_and_price_info(
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

fun setup_shop_with_listing_and_price_info(
    scn: &mut test_scenario::Scenario,
    base_price_usd_cents: u64,
    stock: u64,
): (ID, ID, ID) {
    let (
        shop_id,
        _accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(
        scn,
        base_price_usd_cents,
        stock,
    );
    (shop_id, listing_id, price_info_id)
}

fun setup_shop_with_currency_listing_and_price_info_for_item<TItem: store>(
    scn: &mut test_scenario::Scenario,
    item_name: vector<u8>,
    base_price_usd_cents: u64,
    stock: u64,
): (ID, ID, ID, ID) {
    let currency = prepare_test_currency_for_owner(scn, TEST_OWNER);

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        TEST_OWNER,
        test_scenario::ctx(scn),
    );
    let shop_id = object::id(&shop_obj);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    let accepted_currency_id = price_info_id;
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TItem>(
        &owner_cap,
        item_name.to_string(),
        base_price_usd_cents,
        stock,
        option::none(),
        test_scenario::ctx(scn),
    );

    transfer::public_share_object(price_info_object);
    transfer::public_share_object(shop_obj);
    transfer::public_transfer(owner_cap, @0x0);

    (shop_id, accepted_currency_id, listing_id, price_info_id)
}

#[test]
fun buy_item_emits_events_decrements_stock_and_refunds_change() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 2);

    let (mut shared_shop, price_info_obj, clock_obj) = begin_buyer_checkout_context(
        &mut scn,
        OTHER_OWNER,
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let extra = 7;
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount + extra,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.buy_item<TestItem, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    let minted_item_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.shop_id(),
            listing_id,
            accepted_currency_id,
            option::none(),
            minted_item_id,
            quote_amount,
            100,
        ),
    );

    assert_emitted!(
        events::item_listing_stock_updated(
            shared_shop.shop_id(),
            listing_id,
        ),
    );

    close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = test_scenario::end(scn);
}

#[test]
fun buy_item_supports_example_car_receipts() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info_for_item<Car>(
        &mut scn,
        b"Car Listing",
        175_00,
        2,
    );

    let (mut shared_shop, price_info_obj, clock_obj) = begin_buyer_checkout_context(
        &mut scn,
        OTHER_OWNER,
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        175_00,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.buy_item<Car, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    let minted_item_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.shop_id(),
            listing_id,
            accepted_currency_id,
            option::none(),
            minted_item_id,
            quote_amount,
            175_00,
        ),
    );

    close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = test_scenario::end(scn);
}

#[test]
fun buy_item_supports_example_bike_receipts() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info_for_item<Bike>(
        &mut scn,
        b"Bike Listing",
        95_00,
        1,
    );

    let (mut shared_shop, price_info_obj, clock_obj) = begin_buyer_checkout_context(
        &mut scn,
        OTHER_OWNER,
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        95_00,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.buy_item<Bike, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    let minted_item_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.shop_id(),
            listing_id,
            accepted_currency_id,
            option::none(),
            minted_item_id,
            quote_amount,
            95_00,
        ),
    );

    close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = test_scenario::end(scn);
}

#[test]
fun buy_item_emits_events_with_exact_payment_and_zero_change() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 2);

    let (mut shared_shop, price_info_obj, clock_obj) = begin_buyer_checkout_context(
        &mut scn,
        OTHER_OWNER,
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.buy_item<TestItem, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        THIRD_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    let minted_item_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.shop_id(),
            listing_id,
            accepted_currency_id,
            option::none(),
            minted_item_id,
            quote_amount,
            100,
        ),
    );

    close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = test_scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EOutOfStock)]
fun buy_item_rejects_out_of_stock_after_depletion() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        100,
        1,
    );

    let (mut shared_shop, price_info_obj, clock_obj) = begin_buyer_checkout_context(
        &mut scn,
        OTHER_OWNER,
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );
    shared_shop.buy_item<TestItem, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 11);
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.buy_item<TestItem, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun buy_item_rejects_price_info_object_id_mismatch() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        TEST_OWNER,
        test_scenario::ctx(&mut scn),
    );
    let shop_id = object::id(&shop_obj);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();
    let other_price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let other_price_info_id = other_price_info_object.uid_to_inner();

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap,
        b"Mismatch Item".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    transfer::public_share_object(price_info_object);
    transfer::public_share_object(other_price_info_object);
    transfer::public_share_object(shop_obj);
    transfer::public_transfer(owner_cap, @0x0);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let other_price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        other_price_info_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let payment = coin::mint_for_testing<TestCoin>(1, test_scenario::ctx(&mut scn));

    shared_shop.buy_item<TestItem, TestCoin>(
        &other_price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test]
fun buy_item_with_discount_emits_discount_redeemed_and_records_template_id() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap_obj,
        b"Discounted Item".to_string(),
        1_000,
        2,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap_obj,
        option::some(listing_id),
        0,
        250,
        0,
        option::none(),
        option::some(10),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);

    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shared_shop.claim_discount_ticket_inline(
        template_id,
        now_secs,
        test_scenario::ctx(&mut scn),
    );
    let ticket_id = object::id(&ticket);

    let discounted_price_usd_cents = 1_000 - 250;
    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        discounted_price_usd_cents,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );
    shared_shop.buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        ticket,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    let minted_item_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.shop_id(),
            listing_id,
            price_info_id,
            option::some(template_id),
            minted_item_id,
            quote_amount,
            discounted_price_usd_cents,
        ),
    );

    assert_emitted!(
        events::discount_redeemed(
            shared_shop.shop_id(),
            template_id,
            ticket_id,
        ),
    );

    let template_values = shared_shop.discount_template(template_id);
    let claims_issued = template_values.discount_template_claims_issued();
    let redemptions = template_values.discount_template_redemptions();
    assert_eq!(claims_issued, 1);
    assert_eq!(redemptions, 1);

    close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = test_scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketOwnerMismatch)]
fun buy_item_with_discount_rejects_ticket_owner_mismatch() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap_obj,
        b"Owner Mismatch Item".to_string(),
        1_000,
        2,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap_obj,
        option::some(listing_id),
        0,
        250,
        0,
        option::none(),
        option::some(10),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj: price_info::PriceInfoObject = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);

    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shared_shop.claim_discount_ticket_inline(
        template_id,
        now_secs,
        test_scenario::ctx(&mut scn),
    );
    let ticket_id = object::id(&ticket);
    transfer::public_transfer(ticket, TEST_OWNER);

    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let ticket = test_scenario::take_from_sender_by_id(
        &scn,
        ticket_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 11);

    let payment = coin::mint_for_testing<TestCoin>(
        1_000_000,
        test_scenario::ctx(&mut scn),
    );
    shared_shop.buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        ticket,
        &price_info_obj,
        payment,
        listing_id,
        TEST_OWNER,
        TEST_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInsufficientPayment)]
fun buy_item_rejects_insufficient_payment() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        10_000,
        2,
    );

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);

    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        10_000,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount - 1,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.buy_item<TestItem, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun buy_item_rejects_wrong_coin_type() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        100,
        1,
    );

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);

    let payment = coin::mint_for_testing<AltTestCoin>(
        1,
        test_scenario::ctx(&mut scn),
    );
    shared_shop.buy_item<TestItem, AltTestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EItemTypeMismatch)]
fun buy_item_rejects_item_type_mismatch() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        100,
        1,
    );

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);

    let payment = coin::mint_for_testing<TestCoin>(1, test_scenario::ctx(&mut scn));
    shared_shop.buy_item<OtherItem, TestCoin>(
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidGuardrailCap)]
fun buy_item_rejects_guardrail_override_above_cap() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let pyth_object_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    // Seller caps must be non-zero; zero should abort with EInvalidGuardrailCap.
    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        pyth_object_id,
        option::some(0),
        option::some(0),
        option::some(0),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceNonPositive)]
fun quote_amount_from_usd_cents_rejects_negative_price() {
    let price_value = i64::new(1, true);
    let expo = i64::new(0, false);
    let price = price::new(price_value, 0, expo, 0);
    let _ = shop::quote_amount_from_usd_cents(
        100,
        9,
        price,
        TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateInactive)]
fun buy_item_with_discount_rejects_inactive_template() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap_obj,
        b"Inactive Template Item".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap_obj,
        option::some(listing_id),
        0,
        25,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shared_shop.claim_discount_ticket_inline(
        template_id,
        now_secs,
        test_scenario::ctx(&mut scn),
    );
    let ticket_id = object::id(&ticket);
    transfer::public_transfer(ticket, OTHER_OWNER);

    test_scenario::return_shared(shared_shop);
    std::unit_test::destroy(clock_obj);

    let _ = test_scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap_obj = test_scenario::take_from_sender_by_id<shop::ShopOwnerCap>(
        &scn,
        owner_cap_id,
    );
    let mut shared_shop = take_shared_shop(&scn, shop_id);
    shared_shop.toggle_discount_template(
        &owner_cap_obj,
        template_id,
        false,
    );
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shared_shop);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );
    let ticket = test_scenario::take_from_sender_by_id<shop::DiscountTicket>(
        &scn,
        ticket_id,
    );

    shared_shop.buy_item_with_discount<TestItem, TestCoin>(
        template_id,
        ticket,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketMismatch)]
fun buy_item_with_discount_rejects_ticket_template_mismatch() {
    let mut scn = test_scenario::begin(TEST_OWNER);
    let (shop_id, owner_cap_id) = create_default_shop_and_owner_cap_ids_for_sender(&mut scn);

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = take_shared_shop(&scn, shop_id);
    let owner_cap_obj = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop_obj.add_accepted_currency<TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<TestItem>(
        &owner_cap_obj,
        b"Template Mismatch Item".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_obj.create_discount_template(
        &owner_cap_obj,
        option::some(listing_id),
        0,
        25,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_a_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    shop_obj.create_discount_template(
        &owner_cap_obj,
        option::some(listing_id),
        0,
        25,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_b_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);
    test_scenario::return_to_sender(&scn, owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = take_shared_shop(&scn, shop_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shared_shop.claim_discount_ticket_inline(
        template_a_id,
        now_secs,
        test_scenario::ctx(&mut scn),
    );
    let extra_ticket = shared_shop.claim_discount_ticket_inline(
        template_b_id,
        now_secs,
        test_scenario::ctx(&mut scn),
    );
    transfer::public_transfer(extra_ticket, OTHER_OWNER);
    let quote_amount = shared_shop.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop.buy_item_with_discount<TestItem, TestCoin>(
        template_b_id,
        ticket,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketShopMismatch)]
fun buy_item_with_discount_rejects_ticket_shop_mismatch() {
    let mut scn = test_scenario::begin(TEST_OWNER);

    let (shop_a_id, owner_cap_a_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        DEFAULT_SHOP_NAME,
    );

    let (shop_b_id, owner_cap_b_id) = create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        b"Other Shop",
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let price_info_object = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        test_scenario::ctx(&mut scn),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_a = take_shared_shop(&scn, shop_a_id);
    let owner_cap_a = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_a_id,
    );
    shop_a.add_accepted_currency<TestCoin>(
        &owner_cap_a,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        option::none(),
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);

    let listing_id = shop_a.add_item_listing<TestItem>(
        &owner_cap_a,
        b"Shop A Item".to_string(),
        100,
        1,
        option::none(),
        test_scenario::ctx(&mut scn),
    );

    shop_a.create_discount_template(
        &owner_cap_a,
        option::some(listing_id),
        0,
        25,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_a_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    let mut shop_b = take_shared_shop(&scn, shop_b_id);
    let owner_cap_b = test_scenario::take_from_sender_by_id(
        &scn,
        owner_cap_b_id,
    );
    shop_b.create_discount_template(
        &owner_cap_b,
        option::none(),
        0,
        25,
        0,
        option::none(),
        option::none(),
        test_scenario::ctx(&mut scn),
    );
    let template_b_id = tx_context::last_created_object_id(test_scenario::ctx(&mut scn)).to_id();

    transfer::public_share_object(price_info_object);
    test_scenario::return_to_sender(&scn, owner_cap_a);
    test_scenario::return_to_sender(&scn, owner_cap_b);
    test_scenario::return_shared(shop_a);
    test_scenario::return_shared(shop_b);

    let _ = test_scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop_a = take_shared_shop(&scn, shop_a_id);
    let mut shared_shop_b = take_shared_shop(&scn, shop_b_id);
    let price_info_obj = test_scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let clock_obj = create_test_clock_at(test_scenario::ctx(&mut scn), 10);
    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket_a = shared_shop_a.claim_discount_ticket_inline(
        template_a_id,
        now_secs,
        test_scenario::ctx(&mut scn),
    );
    transfer::public_transfer(ticket_a, OTHER_OWNER);
    let ticket_b = shared_shop_b.claim_discount_ticket_inline(
        template_b_id,
        now_secs,
        test_scenario::ctx(&mut scn),
    );
    let quote_amount = shared_shop_a.quote_amount_for_price_info_object<TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        test_scenario::ctx(&mut scn),
    );

    shared_shop_a.buy_item_with_discount<TestItem, TestCoin>(
        template_a_id,
        ticket_b,
        &price_info_obj,
        payment,
        listing_id,
        OTHER_OWNER,
        OTHER_OWNER,
        option::none(),
        option::none(),
        &clock_obj,
        test_scenario::ctx(&mut scn),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EConfidenceExceedsPrice)]
fun quote_amount_from_usd_cents_rejects_confidence_exceeds_price() {
    let price_value = i64::new(10, false);
    let expo = i64::new(0, false);
    let price = price::new(price_value, 10, expo, 0);
    let _ = shop::quote_amount_from_usd_cents(
        100,
        9,
        price,
        TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EConfidenceIntervalTooWide)]
fun quote_amount_from_usd_cents_rejects_confidence_interval_too_wide() {
    let price_value = i64::new(100, false);
    let expo = i64::new(0, false);
    let price = price::new(price_value, 50, expo, 0);
    let _ = shop::quote_amount_from_usd_cents(
        100,
        9,
        price,
        TEST_DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );
    abort
}

fun create_test_currency(ctx: &mut tx_context::TxContext): coin_registry::Currency<TestCoin> {
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
    let currency = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    transfer::public_share_object(treasury_cap);
    currency
}

fun create_alt_test_currency(
    ctx: &mut tx_context::TxContext,
): coin_registry::Currency<AltTestCoin> {
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
    let currency = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    transfer::public_share_object(treasury_cap);
    currency
}

fun create_high_decimal_currency(
    ctx: &mut tx_context::TxContext,
): coin_registry::Currency<HighDecimalCoin> {
    let mut registry_obj = coin_registry::create_coin_data_registry_for_testing(ctx);
    let over_max_decimals = (TEST_MAX_DECIMAL_POWER + 1) as u8;
    let (init, treasury_cap) = coin_registry::new_currency<HighDecimalCoin>(
        &mut registry_obj,
        over_max_decimals,
        b"HDC".to_string(),
        b"High Decimal Coin".to_string(),
        b"Test coin with >MAX_DECIMAL_POWER decimals".to_string(),
        b"".to_string(),
        ctx,
    );
    let currency = coin_registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    transfer::public_share_object(treasury_cap);
    currency
}

fun prepare_test_currency_for_owner(
    scn: &mut test_scenario::Scenario,
    owner: address,
): coin_registry::Currency<TestCoin> {
    let _ = test_scenario::next_tx(scn, @0x0);
    let currency = create_test_currency(test_scenario::ctx(scn));
    let _ = test_scenario::next_tx(scn, owner);
    currency
}

fun test_coin_type(): type_name::TypeName {
    type_name::with_defining_ids<TestCoin>()
}

fun create_discount_template(
    shop: &mut shop::Shop,
    _owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx_context::TxContext,
): ID {
    shop.test_create_discount_template_local(
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        ctx,
    )
}
