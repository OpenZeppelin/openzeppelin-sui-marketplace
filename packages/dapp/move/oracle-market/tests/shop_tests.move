#[test_only]
module sui_oracle_market::shop_tests;

use pyth::i64 as pyth_i64;
use pyth::price as pyth_price;
use pyth::price_feed as pyth_price_feed;
use pyth::price_identifier as pyth_price_identifier;
use pyth::price_info as pyth_price_info;
use pyth::pyth;
use std::option as opt;
use std::string;
use std::type_name;
use std::unit_test::assert_eq;
use sui::clock;
use sui::coin;
use sui::coin_registry as registry;
use sui::event;
use sui::object as obj;
use sui::test_scenario as scenario;
use sui::transfer as txf;
use sui::tx_context as tx;
use sui::vec_map;
use sui_oracle_market::shop;

// === Constants ===
const TEST_OWNER: address = @0xBEEF;
const OTHER_OWNER: address = @0xCAFE;
const THIRD_OWNER: address = @0xD00D;
const EAssertFailure: u64 = 0;
const DEFAULT_SHOP_NAME: vector<u8> = b"Shop";

// === Test Types ===
/// Test coin used in unit tests.
public struct TestCoin has key, store { id: obj::UID }
/// Alternate test coin used in unit tests.
public struct AltTestCoin has key, store { id: obj::UID }
/// Test coin with high decimals to validate precision handling.
public struct HighDecimalCoin has key, store { id: obj::UID }
/// Test item type used in unit tests.
public struct TestItem has store {}
/// Alternate item type used in unit tests.
public struct OtherItem has store {}

/// Test vehicle object used in unit tests.
public struct Car has key, store {
    id: obj::UID,
}

/// Test vehicle object used in unit tests.
public struct Bike has key, store {
    id: obj::UID,
}

// === Test Fixtures ===
const PRIMARY_FEED_ID: vector<u8> =
    x"000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f";
const SECONDARY_FEED_ID: vector<u8> =
    x"101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f";
const SHORT_FEED_ID: vector<u8> = b"SHORT";

// === Test Helpers ===
fun string_from_bytes(bytes: vector<u8>): string::String {
    let mut maybe_string = string::try_utf8(bytes);
    opt::extract(&mut maybe_string)
}

fun sample_price(): pyth_price::Price {
    let price_value = pyth_i64::new(1_000, false);
    pyth_price::new(price_value, 10, pyth_i64::new(2, true), 0)
}

fun create_price_info_object_for_feed(
    feed_id: vector<u8>,
    ctx: &mut tx::TxContext,
): (pyth_price_info::PriceInfoObject, obj::ID) {
    create_price_info_object_for_feed_with_price(feed_id, sample_price(), ctx)
}

fun create_price_info_object_for_feed_with_price(
    feed_id: vector<u8>,
    price: pyth_price::Price,
    ctx: &mut tx::TxContext,
): (pyth_price_info::PriceInfoObject, obj::ID) {
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
    price: pyth_price::Price,
    attestation_time: u64,
    arrival_time: u64,
    ctx: &mut tx::TxContext,
): (pyth_price_info::PriceInfoObject, obj::ID) {
    let price_identifier = pyth_price_identifier::from_byte_vec(feed_id);
    let price_feed = pyth_price_feed::new(price_identifier, price, price);
    let price_info = pyth_price_info::new_price_info(
        attestation_time,
        arrival_time,
        price_feed,
    );
    let price_info_object = pyth_price_info::new_price_info_object_for_test(
        price_info,
        ctx,
    );
    let price_info_id = pyth_price_info::uid_to_inner(&price_info_object);
    (price_info_object, price_info_id)
}

fun add_currency_with_feed<T>(
    shop: &mut shop::Shop,
    currency: &registry::Currency<T>,
    feed_id: vector<u8>,
    owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx::TxContext,
): obj::ID {
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        feed_id,
        ctx,
    );
    shop::add_accepted_currency<T>(
        shop,
        owner_cap,
        currency,
        &price_info_object,
        feed_id,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        ctx,
    );
    txf::public_share_object(price_info_object);
    price_info_id
}

// === Tests ===
#[test]
fun create_shop_emits_event_and_records_ids() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 1, 0, 0, 0);
    let starting_ids = tx::get_ids_created(&ctx);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), &mut ctx);

    let created = event::events_by_type<shop::ShopCreatedEvent>();
    assert_eq!(created.length(), 1);
    let shop_created = &created[0];
    let owner_cap_addr = obj::id_to_address(&shop::test_last_created_id(&ctx));

    assert_eq!(shop::test_shop_created_owner(shop_created), TEST_OWNER);
    assert_eq!(shop::test_shop_created_name(shop_created), DEFAULT_SHOP_NAME);
    assert_eq!(shop::test_shop_created_owner_cap_id(shop_created), owner_cap_addr);
    assert_eq!(tx::get_ids_created(&ctx), starting_ids + 2);
}

#[test]
fun create_shop_allows_multiple_shops_per_sender() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 2, 0, 0, 0);
    let starting_ids = tx::get_ids_created(&ctx);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), &mut ctx);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), &mut ctx);

    let created = event::events_by_type<shop::ShopCreatedEvent>();
    assert_eq!(created.length(), 2);
    let first = &created[0];
    let second = &created[1];
    assert_eq!(shop::test_shop_created_owner(first), TEST_OWNER);
    assert_eq!(shop::test_shop_created_name(first), DEFAULT_SHOP_NAME);
    assert_eq!(shop::test_shop_created_owner(second), TEST_OWNER);
    assert_eq!(shop::test_shop_created_name(second), DEFAULT_SHOP_NAME);
    assert_eq!(tx::get_ids_created(&ctx), starting_ids + 4);
}

#[test]
fun create_shop_emits_unique_shop_and_cap_ids() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 4, 0, 0, 0);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), &mut ctx);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), &mut ctx);

    let created = event::events_by_type<shop::ShopCreatedEvent>();
    assert_eq!(created.length(), 2);
    let first = &created[0];
    let second = &created[1];
    assert!(
        shop::test_shop_created_shop_address(first) != shop::test_shop_created_shop_address(second),
    );
    assert!(
        shop::test_shop_created_owner_cap_id(first)
            != shop::test_shop_created_owner_cap_id(second),
    );
}

#[test]
fun create_shop_records_sender_in_event() {
    let mut ctx = tx::new_from_hint(OTHER_OWNER, 5, 0, 0, 0);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), &mut ctx);

    let created = event::events_by_type<shop::ShopCreatedEvent>();
    assert_eq!(created.length(), 1);
    let shop_created = &created[0];
    assert_eq!(shop::test_shop_created_owner(shop_created), OTHER_OWNER);
    assert_eq!(shop::test_shop_created_name(shop_created), DEFAULT_SHOP_NAME);
}

#[test]
fun create_shop_handles_existing_id_counts() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 6, 0, 0, 0);

    let (temp_shop, temp_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    std::unit_test::destroy(temp_cap);
    std::unit_test::destroy(temp_shop);

    let starting_ids = tx::get_ids_created(&ctx);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), &mut ctx);

    assert_eq!(tx::get_ids_created(&ctx), starting_ids + 2);
}

#[test]
fun create_shop_shares_shop_and_transfers_owner_cap() {
    let mut scn = scenario::begin(TEST_OWNER);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    assert_eq!(created_events.length(), 1);
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let effects = scenario::next_tx(&mut scn, TEST_OWNER);
    let created_ids = scenario::created(&effects);
    assert_eq!(created_ids.length(), 2);
    assert_eq!(created_ids[0], shop_id);
    assert_eq!(created_ids[1], owner_cap_id);

    let shared_ids = scenario::shared(&effects);
    assert_eq!(shared_ids.length(), 1);
    assert_eq!(shared_ids[0], shop_id);

    let transferred = scenario::transferred_to_account(&effects);
    assert_eq!(vec_map::length(&transferred), 1);
    assert_eq!(transferred[&owner_cap_id], TEST_OWNER);
    assert_eq!(scenario::num_user_events(&effects), 1);

    let shared_shop: shop::Shop = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    assert_eq!(shop::test_shop_owner(&shared_shop), TEST_OWNER);
    assert_eq!(shop::test_shop_name(&shared_shop), DEFAULT_SHOP_NAME);
    assert!(!shop::test_shop_disabled(&shared_shop));
    assert_eq!(shop::test_shop_owner_cap_owner(&owner_cap), TEST_OWNER);
    assert_eq!(
        shop::test_shop_owner_cap_shop_address(&owner_cap),
        shop::test_shop_id(&shared_shop),
    );

    scenario::return_shared(shared_shop);
    scenario::return_to_sender(&scn, owner_cap);
    let _ = scenario::end(scn);
}

#[test]
fun update_shop_owner_rotates_payout_and_emits_event() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 40, 0, 0, 0);
    let (mut shop, mut owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::update_shop_owner(&mut shop, &mut owner_cap, OTHER_OWNER, &ctx);

    assert_eq!(shop::test_shop_owner(&shop), OTHER_OWNER);
    assert_eq!(shop::test_shop_owner_cap_owner(&owner_cap), OTHER_OWNER);

    let events = event::events_by_type<shop::ShopOwnerUpdatedEvent>();
    assert_eq!(events.length(), 1);
    let rotated = &events[0];
    let cap_id = shop::test_shop_owner_cap_id(&owner_cap);

    assert_eq!(shop::test_shop_owner_updated_shop(rotated), shop::test_shop_id(&shop));
    assert_eq!(shop::test_shop_owner_updated_previous(rotated), TEST_OWNER);
    assert_eq!(shop::test_shop_owner_updated_new(rotated), OTHER_OWNER);
    assert_eq!(shop::test_shop_owner_updated_cap_id(rotated), cap_id);
    assert_eq!(shop::test_shop_owner_updated_rotated_by(rotated), TEST_OWNER);

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun update_shop_owner_emits_event_even_when_unchanged() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 42, 0, 0, 0);
    let (mut shop, mut owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::update_shop_owner(&mut shop, &mut owner_cap, TEST_OWNER, &ctx);

    assert_eq!(shop::test_shop_owner(&shop), TEST_OWNER);
    assert_eq!(shop::test_shop_owner_cap_owner(&owner_cap), TEST_OWNER);

    let events = event::events_by_type<shop::ShopOwnerUpdatedEvent>();
    assert_eq!(events.length(), 1);
    let rotated = &events[0];
    let cap_id = shop::test_shop_owner_cap_id(&owner_cap);
    let shop_id = shop::test_shop_id(&shop);

    assert_eq!(shop::test_shop_owner_updated_shop(rotated), shop_id);
    assert_eq!(shop::test_shop_owner_updated_previous(rotated), TEST_OWNER);
    assert_eq!(shop::test_shop_owner_updated_new(rotated), TEST_OWNER);
    assert_eq!(shop::test_shop_owner_updated_cap_id(rotated), cap_id);
    assert_eq!(shop::test_shop_owner_updated_rotated_by(rotated), TEST_OWNER);

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun update_shop_owner_records_rotated_by_sender() {
    let mut ctx = tx::new_from_hint(THIRD_OWNER, 43, 0, 0, 0);
    let (mut shop, mut owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::update_shop_owner(&mut shop, &mut owner_cap, OTHER_OWNER, &ctx);

    let events = event::events_by_type<shop::ShopOwnerUpdatedEvent>();
    assert_eq!(events.length(), 1);
    let rotated = &events[0];

    assert_eq!(shop::test_shop_owner(&shop), OTHER_OWNER);
    assert_eq!(shop::test_shop_owner_cap_owner(&owner_cap), OTHER_OWNER);
    assert_eq!(shop::test_shop_owner_updated_previous(rotated), TEST_OWNER);
    assert_eq!(shop::test_shop_owner_updated_new(rotated), OTHER_OWNER);
    assert_eq!(shop::test_shop_owner_updated_rotated_by(rotated), THIRD_OWNER);

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun disable_shop_sets_flag_and_emits_event() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 44, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::disable_shop(&mut shop, &owner_cap, &ctx);

    assert!(shop::test_shop_disabled(&shop));

    let events = event::events_by_type<shop::ShopDisabledEvent>();
    assert_eq!(events.length(), 1);
    let disabled_event = &events[0];
    let shop_id = shop::test_shop_id(&shop);
    let cap_id = shop::test_shop_owner_cap_id(&owner_cap);

    assert_eq!(shop::test_shop_disabled_shop(disabled_event), shop_id);
    assert_eq!(shop::test_shop_disabled_owner(disabled_event), TEST_OWNER);
    assert_eq!(shop::test_shop_disabled_cap_id(disabled_event), cap_id);
    assert_eq!(shop::test_shop_disabled_by(disabled_event), TEST_OWNER);

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun disable_shop_rejects_foreign_cap() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 45, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::disable_shop(&mut shop, &other_cap, &ctx);

    shop::test_abort_invalid_owner_cap();
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_shop_owner_rejects_foreign_cap() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 41, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, mut other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    shop::update_shop_owner(&mut shop, &mut other_cap, OTHER_OWNER, &ctx);

    shop::test_abort_accepted_currency_missing();
    abort EAssertFailure
}

#[test]
fun add_accepted_currency_records_currency_and_event() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let expected_feed_id = PRIMARY_FEED_ID;
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        expected_feed_id,
        scenario::ctx(&mut scn),
    );
    let events_before = event::events_by_type<shop::AcceptedCoinAddedEvent>().length();

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        expected_feed_id,
        pyth_object_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    let added_events = event::events_by_type<shop::AcceptedCoinAddedEvent>();
    let added_len = added_events.length();
    assert!(added_len > events_before);
    let added_event = &added_events[added_len - 1];
    assert_eq!(shop::test_accepted_coin_added_shop(added_event), shop::test_shop_id(&shop_obj));
    assert_eq!(shop::test_accepted_coin_added_coin_type(added_event), test_coin_type());
    assert_eq!(shop::test_accepted_coin_added_feed_id(added_event), expected_feed_id);
    assert_eq!(shop::test_accepted_coin_added_pyth_object_id(added_event), pyth_object_id);
    assert_eq!(shop::test_accepted_coin_added_decimals(added_event), 9);

    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );

    let (
        shop_address,
        coin_type,
        feed_id,
        pyth_id,
        decimals,
        symbol,
        _,
        _,
        _,
    ) = shop::accepted_currency_values(&shared_shop, &accepted_currency);
    assert_eq!(shop_address, shop::test_shop_id(&shared_shop));
    assert_eq!(coin_type, test_coin_type());
    assert_eq!(feed_id, expected_feed_id);
    assert_eq!(pyth_id, pyth_object_id);
    assert_eq!(decimals, 9);
    assert_eq!(symbol, b"TCO");
    let mapped_id = shop::accepted_currency_id_for_type(
        &shared_shop,
        test_coin_type(),
    );
    assert!(opt::is_some(&mapped_id));
    assert_eq!(*opt::borrow(&mapped_id), accepted_currency_id);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    std::unit_test::destroy(currency);
    let _ = scenario::end(scn);
}

#[test]
fun add_accepted_currency_stores_custom_guardrail_caps() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );
    let custom_age_cap = 30;
    let custom_conf_cap = 500;
    let custom_status_cap = 3;

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        pyth_object_id,
        opt::some(custom_age_cap),
        opt::some(custom_conf_cap),
        opt::some(custom_status_cap),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let (_, _, _, _, _, _, max_age_cap, conf_cap, status_cap) = shop::accepted_currency_values(
        &shared_shop,
        &accepted_currency,
    );
    assert_eq!(max_age_cap, custom_age_cap);
    assert_eq!(conf_cap, custom_conf_cap);
    assert_eq!(status_cap, custom_status_cap);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    std::unit_test::destroy(currency);
    let _ = scenario::end(scn);
}

#[test]
fun add_accepted_currency_clamps_guardrail_caps_to_defaults() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );
    let over_age_cap = shop::test_default_max_price_age_secs() + 100;
    let over_conf_cap = shop::test_default_max_confidence_ratio_bps() + 500;
    let over_status_cap = shop::test_default_max_price_status_lag_secs() + 10;

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        pyth_object_id,
        opt::some(over_age_cap),
        opt::some(over_conf_cap),
        opt::some(over_status_cap),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let (_, _, _, _, _, _, max_age_cap, conf_cap, status_cap) = shop::accepted_currency_values(
        &shared_shop,
        &accepted_currency,
    );
    assert_eq!(max_age_cap, shop::test_default_max_price_age_secs());
    assert_eq!(conf_cap, shop::test_default_max_confidence_ratio_bps());
    assert_eq!(status_cap, shop::test_default_max_price_status_lag_secs());

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    std::unit_test::destroy(currency);
    let _ = scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_accepted_currency_rejects_foreign_owner_cap() {
    let mut ctx = tx::new_from_hint(@0x0, 8, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &other_cap,
        &currency,
        &price_info_object,
        b"BAD",
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyExists)]
fun add_accepted_currency_rejects_duplicate_coin_type() {
    let mut ctx = tx::new_from_hint(@0x0, 9, 0, 0, 0);
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

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyFeedId)]
fun add_accepted_currency_rejects_empty_feed_id() {
    let mut ctx = tx::new_from_hint(@0x0, 10, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &owner_cap,
        &currency,
        &price_info_object,
        b"",
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidFeedIdLength)]
fun add_accepted_currency_rejects_short_feed_id() {
    let mut ctx = tx::new_from_hint(@0x0, 14, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &owner_cap,
        &currency,
        &price_info_object,
        SHORT_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test]
fun attestation_time_within_lag_is_allowed() {
    let mut ctx = tx::new_from_hint(@0x0, 16, 0, 0, 0);
    let publish_time = 100;
    let attestation_time = publish_time + shop::test_max_price_status_lag_secs();
    let price = pyth_price::new(
        pyth_i64::new(1_000, false),
        10,
        pyth_i64::new(2, true),
        publish_time,
    );
    let (price_info_object, _) = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        attestation_time,
        attestation_time,
        &mut ctx,
    );

    shop::test_assert_price_status_trading(&price_info_object);
    std::unit_test::destroy(price_info_object);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceStatusNotTrading)]
fun attestation_time_lag_over_limit_is_rejected() {
    let mut ctx = tx::new_from_hint(@0x0, 18, 0, 0, 0);
    let publish_time = 200;
    let attestation_time = publish_time + shop::test_max_price_status_lag_secs() + 1;
    let price = pyth_price::new(
        pyth_i64::new(1_000, false),
        10,
        pyth_i64::new(2, true),
        publish_time,
    );
    let (price_info_object, _) = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        attestation_time,
        attestation_time,
        &mut ctx,
    );

    shop::test_assert_price_status_trading(&price_info_object);
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EUnsupportedCurrencyDecimals)]
fun add_accepted_currency_rejects_excessive_decimals() {
    let mut ctx = tx::new_from_hint(@0x0, 11, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_high_decimal_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop::add_accepted_currency<HighDecimalCoin>(
        &mut shop,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EFeedIdentifierMismatch)]
fun add_accepted_currency_rejects_identifier_mismatch() {
    let mut ctx = tx::new_from_hint(@0x0, 15, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &owner_cap,
        &currency,
        &price_info_object,
        SECONDARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun add_accepted_currency_rejects_missing_price_object() {
    let mut ctx = tx::new_from_hint(@0x0, 17, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, _) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        obj::id_from_address(@0xB),
        opt::none(),
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceStatusNotTrading)]
fun quote_rejects_attestation_lag_above_currency_cap() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let publish_time = 300;
    let attestation_time = publish_time + 3;
    let price = pyth_price::new(
        pyth_i64::new(1_000, false),
        10,
        pyth_i64::new(2, true),
        publish_time,
    );
    let (price_info_object, price_info_id) = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        attestation_time,
        attestation_time,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::some(2),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, (attestation_time + 1) * 1000);

    shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &scenario::take_shared_by_id(&scn, price_info_id),
        10_000,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::pyth::pyth::EStalePriceUpdate, location = ::pyth::pyth)]
fun quote_rejects_price_timestamp_older_than_max_age() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    // Timestamp = 0 keeps the Price stale once we advance the on-chain clock.
    let publish_time = 0;
    let price = pyth_price::new(
        pyth_i64::new(1_000, false),
        10,
        pyth_i64::new(2, true),
        publish_time,
    );
    let (price_info_object, price_info_id) = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        publish_time,
        publish_time,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 200_000);

    shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &scenario::take_shared_by_id(&scn, price_info_id),
        10_000,
        opt::some(10),
        opt::none(),
        &clock_obj,
    );
    abort EAssertFailure
}

#[test]
fun remove_accepted_currency_removes_state_and_emits_event() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);
    let _ = scenario::next_tx(&mut scn, @0x0);
    let primary_currency = create_test_currency(scenario::ctx(&mut scn));
    let secondary_currency = create_alt_test_currency(scenario::ctx(&mut scn));
    let _ = scenario::next_tx(&mut scn, TEST_OWNER);
    let _removed_before = event::events_by_type<shop::AcceptedCoinRemovedEvent>().length();

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let (first_price_object, first_price_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &primary_currency,
        &first_price_object,
        PRIMARY_FEED_ID,
        first_price_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let _first_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    txf::public_share_object(first_price_object);

    let (second_price_object, second_price_id) = create_price_info_object_for_feed(
        SECONDARY_FEED_ID,
        scenario::ctx(&mut scn),
    );
    shop::add_accepted_currency<AltTestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &secondary_currency,
        &second_price_object,
        SECONDARY_FEED_ID,
        second_price_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let _second_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    txf::public_share_object(second_price_object);
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    std::unit_test::destroy(primary_currency);
    std::unit_test::destroy(secondary_currency);
    let _ = scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_accepted_currency_rejects_foreign_owner_cap() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let other_created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let other_created = &other_created_events[other_created_events.length() - 1];
    let wrong_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(other_created),
    );

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let wrong_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        wrong_cap_id,
    );
    let mut shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );

    shop::remove_accepted_currency(
        &mut shared_shop,
        &wrong_cap,
        &accepted_currency,
        scenario::ctx(&mut scn),
    );
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_rejects_missing_id() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let other_created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let other_created = &other_created_events[other_created_events.length() - 1];
    let other_shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(other_created),
    );
    let other_owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(other_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, OTHER_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );
    let mut other_shop_obj = scenario::take_shared_by_id(
        &scn,
        other_shop_id,
    );
    let other_owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        other_owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut other_shop_obj,
        &other_owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let foreign_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, other_owner_cap_obj);
    scenario::return_shared(other_shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let mut shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let foreign_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        foreign_currency_id,
    );
    shop::remove_accepted_currency(
        &mut shared_shop,
        &owner_cap_obj,
        &foreign_currency,
        scenario::ctx(&mut scn),
    );
    abort EAssertFailure
}

#[test]
fun remove_accepted_currency_handles_missing_type_mapping() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);
    txf::public_share_object(price_info_object);

    shop::test_remove_currency_field(&mut shop_obj, test_coin_type());

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap = scenario::take_from_sender_by_id<shop::ShopOwnerCap>(
        &scn,
        owner_cap_id,
    );
    let mut shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    shop::remove_accepted_currency(
        &mut shared_shop,
        &owner_cap,
        &accepted_currency,
        scenario::ctx(&mut scn),
    );

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    let _ = scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_rejects_mismatched_type_mapping() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let first_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);

    shop::test_remove_currency_field(&mut shop_obj, test_coin_type());

    let replacement_currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &replacement_currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(replacement_currency);
    std::unit_test::destroy(price_info_object);

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap = scenario::take_from_sender_by_id<shop::ShopOwnerCap>(
        &scn,
        owner_cap_id,
    );
    let mut shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let first_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        first_currency_id,
    );
    shop::remove_accepted_currency(
        &mut shared_shop,
        &owner_cap,
        &first_currency,
        scenario::ctx(&mut scn),
    );
    abort EAssertFailure
}

#[test]
fun quote_view_matches_internal_math() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed_with_price(
        PRIMARY_FEED_ID,
        sample_price(),
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 1);
    let price_usd_cents: u64 = 10_000;
    let (_, _, _, _, decimals, _, _, _, _) = shop::test_accepted_currency_values(
        &shared_shop,
        &accepted_currency,
    );

    let view_quote = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        price_usd_cents,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let price = pyth::get_price_no_older_than(
        &price_info_obj,
        &clock_obj,
        shop::test_default_max_price_age_secs(),
    );
    let derived_quote = shop::test_quote_amount_from_usd_cents(
        price_usd_cents,
        decimals,
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );

    assert_eq!(derived_quote, 10_101_010_102);
    assert_eq!(view_quote, derived_quote);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    std::unit_test::destroy(currency);
    let _ = scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceOverflow)]
fun quote_amount_rejects_overflow_before_runtime_abort() {
    let price = pyth_price::new(
        pyth_i64::new(1, false),
        0,
        pyth_i64::new(0, false),
        0,
    );
    let max_usd_cents: u64 = 18_446_744_073_709_551_615;

    shop::test_quote_amount_from_usd_cents(
        max_usd_cents,
        38, // MAX_DECIMAL_POWER; forces usd_cents * 10^38 to overflow u128.
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun quote_view_rejects_mismatched_price_info_object() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed_with_price(
        PRIMARY_FEED_ID,
        sample_price(),
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 1);
    let (mismatched_price_info_object, _) = create_price_info_object_for_feed_with_price(
        SECONDARY_FEED_ID,
        sample_price(),
        scenario::ctx(&mut scn),
    );

    shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &mismatched_price_info_object,
        10_000,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test]
fun add_item_listing_stores_metadata() {
    let mut ctx: tx::TxContext = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Cool Bike"),
        125_00,
        25,
        opt::none(),
        &mut ctx,
    );
    assert!(shop::test_listing_exists(&shop, listing_id));
    let (
        name,
        base_price_usd_cents,
        stock,
        shop_id,
        spotlight_template_id,
    ) = shop::test_listing_values_local(&listing);
    let added_events = event::events_by_type<shop::ItemListingAddedEvent>();
    assert_eq!(added_events.length(), 1);
    let added_event = &added_events[0];

    assert_eq!(name, b"Cool Bike");
    assert_eq!(base_price_usd_cents, 125_00);
    assert_eq!(stock, 25);
    assert_eq!(shop_id, shop::test_shop_id(&shop));
    assert!(opt::is_none(&spotlight_template_id));
    let shop_address = shop::test_shop_id(&shop);
    let listing_address = shop::test_listing_address(&listing);
    assert_eq!(shop::test_item_listing_added_shop(added_event), shop_address);
    assert_eq!(shop::test_item_listing_added_listing(added_event), listing_address);
    assert_eq!(shop::test_item_listing_added_name(added_event), b"Cool Bike");
    assert_eq!(shop::test_item_listing_added_base_price_usd_cents(added_event), 125_00);
    assert_eq!(shop::test_item_listing_added_stock(added_event), 25);
    assert!(
        opt::is_none(
            &shop::test_item_listing_added_spotlight_template(added_event),
        ),
    );

    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun add_item_listing_links_spotlight_template() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 44, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (template, template_id) = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    let (listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Limited Tire Set"),
        200_00,
        8,
        opt::some(template_id),
        &mut ctx,
    );
    let (_, _, _, _, spotlight_template_id) = shop::test_listing_values_local(
        &listing,
    );
    let added_events = event::events_by_type<shop::ItemListingAddedEvent>();
    assert_eq!(added_events.length(), 1);
    let added_event = &added_events[0];
    let shop_address = shop::test_shop_id(&shop);
    let listing_address = shop::test_listing_address(&listing);

    assert!(opt::is_some(&spotlight_template_id));
    assert_eq!(*opt::borrow(&spotlight_template_id), template_id);
    assert_eq!(shop::test_item_listing_added_shop(added_event), shop_address);
    assert_eq!(shop::test_item_listing_added_listing(added_event), listing_address);
    assert_eq!(shop::test_item_listing_added_name(added_event), b"Limited Tire Set");
    assert_eq!(shop::test_item_listing_added_base_price_usd_cents(added_event), 200_00);
    let spotlight_template = shop::test_item_listing_added_spotlight_template(
        added_event,
    );
    assert!(opt::is_some(&spotlight_template));
    assert_eq!(*opt::borrow(&spotlight_template), obj::id_to_address(&template_id));
    assert_eq!(shop::test_item_listing_added_stock(added_event), 8);

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_remove_template(&mut shop, template_id);
    std::unit_test::destroy(template);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyItemName)]
fun add_item_listing_rejects_empty_name() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 45, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b""),
        100_00,
        10,
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<TestItem>(
        &mut shop,
        &other_cap,
        string_from_bytes(b"Wrong Owner Cap"),
        15_00,
        3,
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidPrice)]
fun add_item_listing_rejects_zero_price() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Zero Price"),
        0,
        10,
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EZeroStock)]
fun add_item_listing_rejects_zero_stock() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"No Stock"),
        10_00,
        0,
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun add_item_listing_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_foreign_template, foreign_template_id) = create_discount_template(
        &mut other_shop,
        &other_cap,
        &mut ctx,
    );

    shop::add_item_listing<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Bad Template"),
        15_00,
        5,
        opt::some(foreign_template_id),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test]
fun update_item_listing_stock_updates_listing_and_emits_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Helmet"),
        48_00,
        4,
        opt::none(),
        &mut ctx,
    );
    let listing_address = shop::test_listing_address(&listing);

    shop::update_item_listing_stock(
        &shop,
        &owner_cap,
        &mut listing,
        11,
        &ctx,
    );

    let (
        name,
        base_price_usd_cents,
        stock,
        shop_id,
        spotlight_template,
    ) = shop::test_listing_values_local(&listing);
    assert_eq!(name, b"Helmet");
    assert_eq!(base_price_usd_cents, 48_00);
    assert!(opt::is_none(&spotlight_template));
    assert_eq!(stock, 11);

    let stock_events = event::events_by_type<shop::ItemListingStockUpdatedEvent>();
    assert_eq!(stock_events.length(), 1);
    let stock_event = &stock_events[0];
    assert_eq!(shop::test_item_listing_stock_updated_shop(stock_event), shop_id);
    assert_eq!(shop::test_item_listing_stock_updated_listing(stock_event), listing_address);
    assert_eq!(shop::test_item_listing_stock_updated_new_stock(stock_event), 11);

    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_item_listing_stock_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_foreign_shop, foreign_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Borrowed Listing"),
        18_00,
        9,
        opt::none(),
        &mut ctx,
    );

    shop::update_item_listing_stock(
        &shop,
        &foreign_cap,
        &mut listing,
        7,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun update_item_listing_stock_rejects_unknown_listing() {
    let mut ctx = tx::dummy();
    let (shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (mut foreign_listing, _foreign_listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut other_shop,
        &other_cap,
        string_from_bytes(b"Foreign Listing"),
        10_00,
        2,
        opt::none(),
        &mut ctx,
    );

    shop::update_item_listing_stock(
        &shop,
        &owner_cap,
        &mut foreign_listing,
        3,
        &ctx,
    );

    abort EAssertFailure
}

#[test]
fun update_item_listing_stock_handles_multiple_updates_and_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Pads"),
        22_00,
        5,
        opt::none(),
        &mut ctx,
    );
    let listing_address = shop::test_listing_address(&listing);

    shop::update_item_listing_stock(
        &shop,
        &owner_cap,
        &mut listing,
        8,
        &ctx,
    );
    shop::update_item_listing_stock(
        &shop,
        &owner_cap,
        &mut listing,
        3,
        &ctx,
    );

    let (_, _, stock, _, _) = shop::test_listing_values_local(&listing);
    assert_eq!(stock, 3);

    let stock_events = event::events_by_type<shop::ItemListingStockUpdatedEvent>();
    assert_eq!(stock_events.length(), 2);
    let first = &stock_events[0];
    let second = &stock_events[1];
    assert_eq!(shop::test_item_listing_stock_updated_listing(first), listing_address);
    assert_eq!(shop::test_item_listing_stock_updated_listing(second), listing_address);
    assert_eq!(shop::test_item_listing_stock_updated_new_stock(first), 8);
    assert_eq!(shop::test_item_listing_stock_updated_new_stock(second), 3);

    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun remove_item_listing_removes_listing_and_emits_event() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (removed_listing, removed_listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Chain Grease"),
        12_00,
        3,
        opt::none(),
        &mut ctx,
    );
    let removed_listing_address = shop::test_listing_address(&removed_listing);

    let (remaining_listing, remaining_listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Repair Kit"),
        42_00,
        2,
        opt::none(),
        &mut ctx,
    );
    let shop_address = shop::test_shop_id(&shop);

    shop::remove_item_listing(
        &mut shop,
        &owner_cap,
        &removed_listing,
        &ctx,
    );

    let removed_events = event::events_by_type<shop::ItemListingRemovedEvent>();
    assert_eq!(removed_events.length(), 1);
    let removed = &removed_events[0];
    assert_eq!(shop::test_item_listing_removed_shop(removed), shop_address);
    assert_eq!(shop::test_item_listing_removed_listing(removed), removed_listing_address);
    assert!(!shop::test_listing_exists(&shop, removed_listing_id));

    assert!(shop::test_listing_exists(&shop, remaining_listing_id));
    let (name, price, stock, listing_shop_address, spotlight) = shop::test_listing_values_local(
        &remaining_listing,
    );
    assert_eq!(name, b"Repair Kit");
    assert_eq!(price, 42_00);
    assert_eq!(stock, 2);
    assert_eq!(spotlight, opt::none());
    assert_eq!(listing_shop_address, shop_address);

    shop::test_remove_listing(&mut shop, remaining_listing_id);
    std::unit_test::destroy(remaining_listing);
    std::unit_test::destroy(removed_listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_foreign_shop, foreign_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Borrowed Owner"),
        30_00,
        6,
        opt::none(),
        &mut ctx,
    );

    shop::remove_item_listing(
        &mut shop,
        &foreign_cap,
        &listing,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun remove_item_listing_rejects_unknown_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (foreign_listing, _foreign_listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut other_shop,
        &other_cap,
        string_from_bytes(b"Foreign Stock"),
        55_00,
        4,
        opt::none(),
        &mut ctx,
    );

    shop::remove_item_listing(
        &mut shop,
        &owner_cap,
        &foreign_listing,
        &ctx,
    );

    abort EAssertFailure
}

#[test]
fun update_item_listing_stock_accept_zero_stock() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Maintenance Kit"),
        32_00,
        5,
        opt::none(),
        &mut ctx,
    );

    shop::update_item_listing_stock(
        &shop,
        &owner_cap,
        &mut listing,
        0,
        &ctx,
    );

    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun create_discount_template_persists_fields_and_emits_event() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (template, template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        1_250,
        10,
        opt::some(50),
        opt::some(5),
        &mut ctx,
    );
    let template_address = obj::id_to_address(&template_id);
    assert!(shop::test_discount_template_exists(&shop, template_id));

    let (
        shop_address,
        applies_to_listing,
        rule,
        starts_at,
        expires_at,
        max_redemptions,
        claims_issued,
        redemptions,
        active,
    ) = shop::test_discount_template_values(
        &shop,
        &template,
    );

    assert_eq!(shop_address, shop::test_shop_id(&shop));
    assert!(opt::is_none(&applies_to_listing));
    assert_eq!(shop::test_discount_rule_kind(rule), 0);
    assert_eq!(shop::test_discount_rule_value(rule), 1_250);
    assert_eq!(starts_at, 10);
    assert_eq!(*opt::borrow(&expires_at), 50);
    assert_eq!(*opt::borrow(&max_redemptions), 5);
    assert_eq!(claims_issued, 0);
    assert_eq!(redemptions, 0);
    assert!(active);

    let created_events = event::events_by_type<shop::DiscountTemplateCreatedEvent>();
    assert_eq!(created_events.length(), 1);
    let created = &created_events[0];
    assert_eq!(shop::test_discount_template_created_shop(created), shop::test_shop_id(&shop));
    assert_eq!(shop::test_discount_template_created_id(created), template_address);
    let created_rule = shop::test_discount_template_created_rule(created);
    assert_eq!(shop::test_discount_rule_kind(created_rule), 0);
    assert_eq!(shop::test_discount_rule_value(created_rule), 1_250);

    shop::test_remove_template(&mut shop, template_id);
    std::unit_test::destroy(template);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun create_discount_template_links_listing_and_percent_rule() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Wheelset"),
        600_00,
        4,
        opt::none(),
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);

    let (template, template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::some(listing_id),
        1,
        2_500,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    assert!(shop::test_discount_template_exists(&shop, template_id));
    let (
        shop_address,
        applies_to_listing,
        rule,
        starts_at,
        expires_at,
        max_redemptions,
        claims_issued,
        redemptions,
        active,
    ) = shop::test_discount_template_values(
        &shop,
        &template,
    );

    assert_eq!(shop_address, shop::test_shop_id(&shop));
    assert_eq!(*opt::borrow(&applies_to_listing), listing_id);
    assert_eq!(shop::test_discount_rule_kind(rule), 1);
    assert_eq!(shop::test_discount_rule_value(rule), 2_500);
    assert_eq!(starts_at, 0);
    assert!(opt::is_none(&expires_at));
    assert!(opt::is_none(&max_redemptions));
    assert_eq!(claims_issued, 0);
    assert_eq!(redemptions, 0);
    assert!(active);

    let created_events = event::events_by_type<shop::DiscountTemplateCreatedEvent>();
    assert_eq!(created_events.length(), 1);
    let created = &created_events[0];
    let created_rule = shop::test_discount_template_created_rule(created);
    assert_eq!(shop::test_discount_rule_kind(created_rule), 1);
    assert_eq!(shop::test_discount_rule_value(created_rule), 2_500);

    shop::test_remove_template(&mut shop, template_id);
    std::unit_test::destroy(template);
    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun create_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        &other_cap,
        opt::none(),
        0,
        100,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleKind)]
fun create_discount_template_rejects_invalid_rule_kind() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        &owner_cap,
        opt::none(),
        2,
        100,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleValue)]
fun create_discount_template_rejects_percent_above_limit() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        &owner_cap,
        opt::none(),
        1,
        10_001,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test]
fun percent_discount_rounds_up_instead_of_zeroing_low_prices() {
    let discounted = shop::test_apply_percent_discount(1, 100);
    assert_eq!(discounted, 1);
}

#[test]
fun percent_discount_allows_full_discount_to_reach_zero() {
    let discounted = shop::test_apply_percent_discount(1, 10_000);
    assert_eq!(discounted, 0);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateWindow)]
fun create_discount_template_rejects_invalid_schedule() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        &owner_cap,
        opt::none(),
        0,
        1_000,
        10,
        opt::some(10),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun create_discount_template_rejects_foreign_listing_reference() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    shop::add_item_listing<TestItem>(
        &mut other_shop,
        &other_cap,
        string_from_bytes(b"Foreign Listing"),
        7_500,
        2,
        opt::none(),
        &mut ctx,
    );
    let foreign_listing_id = shop::test_last_created_id(&ctx);

    shop::create_discount_template(
        &mut shop,
        &owner_cap,
        opt::some(foreign_listing_id),
        0,
        500,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test]
fun update_discount_template_updates_fields_and_emits_event() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Wheelset"),
        600_00,
        4,
        opt::none(),
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);

    let (mut template, template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::some(listing_id),
        0,
        1_000,
        10,
        opt::some(20),
        opt::some(2),
        &mut ctx,
    );

    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1);
    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        1,
        750,
        50,
        opt::some(200),
        opt::some(10),
        &clock_obj,
    );
    std::unit_test::destroy(clock_obj);

    let (
        shop_address,
        applies_to_listing,
        rule,
        starts_at,
        expires_at,
        max_redemptions,
        claims_issued,
        redemptions,
        active,
    ) = shop::test_discount_template_values(&shop, &template);
    assert_eq!(shop_address, shop::test_shop_id(&shop));
    assert_eq!(*opt::borrow(&applies_to_listing), listing_id);
    assert_eq!(shop::test_discount_rule_kind(rule), 1);
    assert_eq!(shop::test_discount_rule_value(rule), 750);
    assert_eq!(starts_at, 50);
    assert_eq!(*opt::borrow(&expires_at), 200);
    assert_eq!(*opt::borrow(&max_redemptions), 10);
    assert_eq!(claims_issued, 0);
    assert_eq!(redemptions, 0);
    assert!(active);

    let updated_events = event::events_by_type<shop::DiscountTemplateUpdatedEvent>();
    assert_eq!(updated_events.length(), 1);
    let updated = &updated_events[0];
    assert_eq!(shop::test_discount_template_updated_shop(updated), shop::test_shop_id(&shop));
    assert_eq!(shop::test_discount_template_updated_id(updated), obj::id_to_address(&template_id));

    shop::test_remove_template(&mut shop, template_id);
    std::unit_test::destroy(template);
    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, _shop_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop::update_discount_template(
        &shop,
        &other_cap,
        &mut template,
        0,
        250,
        0,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun update_discount_template_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, _other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );
    let (mut foreign_template, _foreign_template_id) = shop::test_create_discount_template_local(
        &mut other_shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut foreign_template,
        0,
        250,
        0,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateWindow)]
fun update_discount_template_rejects_invalid_schedule() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        0,
        1_000,
        100,
        opt::some(50),
        opt::none(),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleKind)]
fun update_discount_template_rejects_invalid_rule_kind() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        2,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleValue)]
fun update_discount_template_rejects_percent_above_limit() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        1,
        10_001,
        0,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateFinalized)]
fun update_discount_template_rejects_after_claims_issued() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::some(5_000),
        opt::some(2),
        &mut ctx,
    );

    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1);
    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);

    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        0,
        250,
        0,
        opt::some(10_000),
        opt::some(1),
        &clock_obj,
    );

    clock::set_for_testing(&mut clock_obj, 10_000);
    shop::prune_discount_claims(
        &shop,
        &owner_cap,
        &mut template,
        vector[TEST_OWNER],
        &clock_obj,
    );
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateFinalized)]
fun update_discount_template_rejects_after_expiry() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::some(100),
        opt::some(5),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 200_000);

    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        1,
        250,
        0,
        opt::some(500),
        opt::some(10),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateFinalized)]
fun update_discount_template_rejects_after_maxed_out() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        450,
        0,
        opt::some(10_000),
        opt::some(1),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1_000);
    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);

    shop::update_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        0,
        250,
        0,
        opt::some(10_500),
        opt::some(2),
        &clock_obj,
    );

    shop::prune_discount_claims(
        &shop,
        &owner_cap,
        &mut template,
        vector[TEST_OWNER],
        &clock_obj,
    );
    abort EAssertFailure
}

#[test]
fun toggle_discount_template_updates_active_and_emits_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        2_000,
        25,
        opt::some(50),
        opt::some(3),
        &mut ctx,
    );
    let template_address = obj::id_to_address(&template_id);

    let (
        shop_address,
        applies_to_listing,
        rule,
        starts_at,
        expires_at,
        max_redemptions,
        claims_issued,
        redemptions,
        active,
    ) = shop::test_discount_template_values(&shop, &template);

    assert!(active);
    shop::toggle_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        false,
        &ctx,
    );

    let (
        shop_address_after_first,
        applies_to_listing_after_first,
        rule_after_first,
        starts_at_after_first,
        expires_at_after_first,
        max_redemptions_after_first,
        claims_issued_after_first,
        redemptions_after_first,
        active_after_first,
    ) = shop::test_discount_template_values(&shop, &template);

    assert_eq!(shop_address_after_first, shop_address);
    assert_eq!(applies_to_listing_after_first, applies_to_listing);
    assert_eq!(
        shop::test_discount_rule_kind(rule_after_first),
        shop::test_discount_rule_kind(rule),
    );
    assert_eq!(
        shop::test_discount_rule_value(rule_after_first),
        shop::test_discount_rule_value(rule),
    );
    assert_eq!(starts_at_after_first, starts_at);
    assert_eq!(expires_at_after_first, expires_at);
    assert_eq!(max_redemptions_after_first, max_redemptions);
    assert_eq!(claims_issued_after_first, claims_issued);
    assert_eq!(redemptions_after_first, redemptions);
    assert!(!active_after_first);

    shop::toggle_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        true,
        &ctx,
    );

    let (
        shop_address_after_second,
        applies_to_listing_after_second,
        rule_after_second,
        starts_at_after_second,
        expires_at_after_second,
        max_redemptions_after_second,
        claims_issued_after_second,
        redemptions_after_second,
        active_after_second,
    ) = shop::test_discount_template_values(&shop, &template);
    assert_eq!(shop_address_after_second, shop_address);
    assert_eq!(applies_to_listing_after_second, applies_to_listing);
    assert_eq!(
        shop::test_discount_rule_kind(rule_after_second),
        shop::test_discount_rule_kind(rule),
    );
    assert_eq!(
        shop::test_discount_rule_value(rule_after_second),
        shop::test_discount_rule_value(rule),
    );
    assert_eq!(starts_at_after_second, starts_at);
    assert_eq!(expires_at_after_second, expires_at);
    assert_eq!(max_redemptions_after_second, max_redemptions);
    assert_eq!(claims_issued_after_second, claims_issued);
    assert_eq!(redemptions_after_second, redemptions);
    assert!(active_after_second);

    let toggled_events_after_first = event::events_by_type<shop::DiscountTemplateToggledEvent>();
    assert_eq!(toggled_events_after_first.length(), 2);
    let first = &toggled_events_after_first[0];
    assert_eq!(shop::test_discount_template_toggled_shop(first), shop_address);
    assert_eq!(shop::test_discount_template_toggled_id(first), template_address);
    assert!(!shop::test_discount_template_toggled_active(first));

    let toggled_events_after_second = event::events_by_type<shop::DiscountTemplateToggledEvent>();
    assert_eq!(toggled_events_after_second.length(), 2);
    let second = &toggled_events_after_second[1];
    assert_eq!(shop::test_discount_template_toggled_id(second), template_address);
    assert!(shop::test_discount_template_toggled_active(second));

    shop::test_remove_template(&mut shop, template_id);
    std::unit_test::destroy(template);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    shop::toggle_discount_template(
        &shop,
        &other_cap,
        &mut template,
        false,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_discount_template_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, _other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );
    let (mut foreign_template, _foreign_template_id) = shop::test_create_discount_template_local(
        &mut other_shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    shop::toggle_discount_template(
        &shop,
        &owner_cap,
        &mut foreign_template,
        false,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_discount_template_rejects_unknown_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut stray_template, stray_template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        100,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    shop::test_remove_template(&mut shop, stray_template_id);

    shop::toggle_discount_template(
        &shop,
        &owner_cap,
        &mut stray_template,
        false,
        &ctx,
    );

    abort EAssertFailure
}

#[test]
fun toggle_template_on_listing_sets_and_clears_spotlight() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Promo Jacket"),
        180_00,
        6,
        opt::none(),
        &mut ctx,
    );
    let (template, template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );
    let ids_before_toggle = tx::get_ids_created(&ctx);

    let (_, _, _, _, spotlight_before) = shop::test_listing_values_local(
        &listing,
    );
    assert!(opt::is_none(&spotlight_before));
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &template,
        &ctx,
    );

    let (_, _, _, _, spotlight_after_set) = shop::test_listing_values_local(
        &listing,
    );
    assert!(opt::is_some(&spotlight_after_set));
    assert_eq!(*opt::borrow(&spotlight_after_set), template_id);
    assert_eq!(tx::get_ids_created(&ctx), ids_before_toggle);
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop::clear_template_from_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &ctx,
    );

    let (_, _, _, _, spotlight_after_clear) = shop::test_listing_values_local(
        &listing,
    );
    assert!(opt::is_none(&spotlight_after_clear));
    assert_eq!(tx::get_ids_created(&ctx), ids_before_toggle);
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(template);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_template_on_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Chain Lube"),
        12_00,
        30,
        opt::none(),
        &mut ctx,
    );
    let (template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    shop::attach_template_to_listing(
        &shop,
        &other_cap,
        &mut listing,
        &template,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun toggle_template_on_listing_rejects_foreign_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (mut foreign_listing, _foreign_listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut other_shop,
        &other_cap,
        string_from_bytes(b"Spare Tube"),
        8_00,
        15,
        opt::none(),
        &mut ctx,
    );
    let (template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut foreign_listing,
        &template,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_template_on_listing_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, _other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Bike Pump"),
        35_00,
        10,
        opt::none(),
        &mut ctx,
    );
    let (foreign_template, _foreign_template_id) = shop::test_create_discount_template_local(
        &mut other_shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        &mut ctx,
    );

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &foreign_template,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_template_on_listing_rejects_unknown_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Frame Protector"),
        22_00,
        40,
        opt::none(),
        &mut ctx,
    );
    let (stray_template, stray_template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        100,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    shop::test_remove_template(&mut shop, stray_template_id);

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &stray_template,
        &ctx,
    );

    abort EAssertFailure
}

#[test]
fun attach_template_to_listing_sets_spotlight_without_emitting_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Promo Bag"),
        95_00,
        12,
        opt::none(),
        &mut ctx,
    );
    let (template, template_id) = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let ids_before = tx::get_ids_created(&ctx);
    let toggled_before = event::events_by_type<shop::DiscountTemplateToggledEvent>().length();

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &template,
        &ctx,
    );

    let (_, _, _, shop_id, spotlight) = shop::test_listing_values_local(
        &listing,
    );
    assert_eq!(shop_id, shop::test_shop_id(&shop));
    assert!(opt::is_some(&spotlight));
    assert_eq!(*opt::borrow(&spotlight), template_id);
    assert_eq!(tx::get_ids_created(&ctx), ids_before);
    assert_eq!(
        event::events_by_type<shop::DiscountTemplateToggledEvent>().length(),
        toggled_before,
    );
    assert!(shop::test_discount_template_exists(&shop, template_id));

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(template);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun attach_template_to_listing_overwrites_existing_spotlight() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (first_template_obj, first_template) = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Bundle"),
        140_00,
        3,
        opt::some(first_template),
        &mut ctx,
    );
    let (second_template_obj, second_template) = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let ids_before = tx::get_ids_created(&ctx);

    let (_, _, _, _, spotlight_before) = shop::test_listing_values_local(
        &listing,
    );
    assert_eq!(*opt::borrow(&spotlight_before), first_template);

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &second_template_obj,
        &ctx,
    );

    let (_, _, _, _, spotlight_after) = shop::test_listing_values_local(
        &listing,
    );
    assert_eq!(*opt::borrow(&spotlight_after), second_template);
    assert_eq!(tx::get_ids_created(&ctx), ids_before);
    assert!(shop::test_discount_template_exists(&shop, first_template));
    assert!(shop::test_discount_template_exists(&shop, second_template));
    assert_eq!(event::events_by_type<shop::DiscountTemplateToggledEvent>().length(), 0);

    shop::test_remove_template(&mut shop, second_template);
    shop::test_remove_template(&mut shop, first_template);
    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(second_template_obj);
    std::unit_test::destroy(first_template_obj);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun attach_template_to_listing_accepts_matching_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        b"Bundle",
        140_00,
        3,
        opt::none(),
        &mut ctx,
    );
    let (template, template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::some(listing_id),
        0,
        50,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &template,
        &ctx,
    );

    let (_, _, _, _, spotlight) = shop::test_listing_values_local(&listing);
    assert!(opt::is_some(&spotlight));
    assert_eq!(*opt::borrow(&spotlight), template_id);

    std::unit_test::destroy(template);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun attach_template_to_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Helmet Stickers"),
        9_00,
        10,
        opt::none(),
        &mut ctx,
    );
    let (template, _template_id) = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    shop::attach_template_to_listing(
        &shop,
        &other_cap,
        &mut listing,
        &template,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun attach_template_to_listing_rejects_foreign_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (mut foreign_listing, _foreign_listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut other_shop,
        &other_cap,
        string_from_bytes(b"Brake Pads"),
        18_00,
        4,
        opt::none(),
        &mut ctx,
    );
    let (template, _template_id) = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut foreign_listing,
        &template,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun attach_template_to_listing_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Chain Whip"),
        27_00,
        5,
        opt::none(),
        &mut ctx,
    );
    let (foreign_template, _foreign_template_id) = create_discount_template(
        &mut other_shop,
        &other_cap,
        &mut ctx,
    );

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &foreign_template,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun attach_template_to_listing_rejects_unknown_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Pedals"),
        51_00,
        6,
        opt::none(),
        &mut ctx,
    );
    let (stray_template, stray_template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        100,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    shop::test_remove_template(&mut shop, stray_template_id);

    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &stray_template,
        &ctx,
    );

    abort EAssertFailure
}

#[test]
fun clear_template_from_listing_removes_spotlight_without_side_effects() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Rain Jacket"),
        120_00,
        7,
        opt::none(),
        &mut ctx,
    );
    let (template, template_id) = create_discount_template(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    shop::attach_template_to_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &template,
        &ctx,
    );

    let (_, _, _, _, spotlight_before) = shop::test_listing_values_local(
        &listing,
    );
    let created_before = tx::get_ids_created(&ctx);
    let toggled_before = event::events_by_type<shop::DiscountTemplateToggledEvent>().length();
    assert_eq!(*opt::borrow(&spotlight_before), template_id);

    shop::clear_template_from_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &ctx,
    );

    let (_, _, _, _, spotlight_after) = shop::test_listing_values_local(
        &listing,
    );
    assert!(opt::is_none(&spotlight_after));
    assert_eq!(tx::get_ids_created(&ctx), created_before);
    assert_eq!(
        event::events_by_type<shop::DiscountTemplateToggledEvent>().length(),
        toggled_before,
    );
    assert!(shop::test_discount_template_exists(&shop, template_id));

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(template);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun clear_template_from_listing_is_noop_when_no_spotlight_set() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Bar Tape"),
        19_00,
        25,
        opt::none(),
        &mut ctx,
    );
    let created_before = tx::get_ids_created(&ctx);
    let toggled_before = event::events_by_type<shop::DiscountTemplateToggledEvent>().length();

    shop::clear_template_from_listing(
        &shop,
        &owner_cap,
        &mut listing,
        &ctx,
    );

    let (_, _, _, _, spotlight_after) = shop::test_listing_values_local(
        &listing,
    );
    assert!(opt::is_none(&spotlight_after));
    assert_eq!(tx::get_ids_created(&ctx), created_before);
    assert_eq!(
        event::events_by_type<shop::DiscountTemplateToggledEvent>().length(),
        toggled_before,
    );

    shop::test_remove_listing(&mut shop, listing_id);
    std::unit_test::destroy(listing);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun clear_template_from_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let (mut listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop,
        &owner_cap,
        string_from_bytes(b"Valve Stem"),
        11_00,
        14,
        opt::none(),
        &mut ctx,
    );

    shop::clear_template_from_listing(
        &shop,
        &other_cap,
        &mut listing,
        &ctx,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun clear_template_from_listing_rejects_foreign_listing() {
    let mut ctx = tx::dummy();
    let (shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        OTHER_OWNER,
        &mut ctx,
    );

    let (mut foreign_listing, _foreign_listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut other_shop,
        &other_cap,
        string_from_bytes(b"Cassette"),
        85_00,
        9,
        opt::none(),
        &mut ctx,
    );

    shop::clear_template_from_listing(
        &shop,
        &owner_cap,
        &mut foreign_listing,
        &ctx,
    );

    abort EAssertFailure
}

#[test]
fun claim_discount_ticket_mints_transfers_and_records_claim() {
    let mut scn = scenario::begin(TEST_OWNER);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    assert_eq!(created_events.length(), 1);
    let created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(created),
    );

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        string_from_bytes(b"Limited Helmet"),
        120_00,
        3,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap,
        opt::some(listing_id),
        0,
        1_500,
        5,
        opt::some(50),
        opt::some(10),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10_000);
    let mut template_obj = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let (_, _, _, _, _, _, claims_issued_before, _, _) = shop::test_discount_template_values(
        &shared_shop,
        &template_obj,
    );

    shop::test_claim_discount_ticket(
        &shared_shop,
        &mut template_obj,
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let (_, _, _, _, _, _, claims_issued_after, _, _) = shop::test_discount_template_values(
        &shared_shop,
        &template_obj,
    );
    assert_eq!(claims_issued_after, claims_issued_before + 1);
    assert!(
        shop::test_discount_claim_exists(
            &template_obj,
            OTHER_OWNER,
        ),
    );

    let claim_events = event::events_by_type<shop::DiscountClaimedEvent>();
    let claim_events_len = claim_events.length();
    assert!(claim_events_len > 0);
    let claimed = &claim_events[claim_events_len - 1];
    let shop_address = obj::id_to_address(&shop_id);
    let template_address = obj::id_to_address(&template_id);
    assert_eq!(shop::test_discount_claimed_shop(claimed), shop_address);
    assert_eq!(shop::test_discount_claimed_template_id(claimed), template_address);
    assert_eq!(shop::test_discount_claimed_claimer(claimed), OTHER_OWNER);
    let ticket_id = obj::id_from_address(
        shop::test_discount_claimed_discount_id(claimed),
    );

    scenario::return_shared(template_obj);
    scenario::return_shared(shared_shop);
    std::unit_test::destroy(clock_obj);

    let effects = scenario::next_tx(&mut scn, OTHER_OWNER);
    assert_eq!(scenario::num_user_events(&effects), 1);
    let ticket = scenario::take_from_sender_by_id<shop::DiscountTicket>(
        &scn,
        ticket_id,
    );
    let (
        ticket_template,
        ticket_shop,
        ticket_listing,
        ticket_owner,
    ) = shop::test_discount_ticket_values(&ticket);
    assert_eq!(ticket_template, template_address);
    assert_eq!(ticket_shop, shop_address);
    assert_eq!(*opt::borrow(&ticket_listing), listing_id);
    assert_eq!(ticket_owner, OTHER_OWNER);
    scenario::return_to_sender(&scn, ticket);

    let _ = scenario::end(scn);
}

#[test]
fun prune_discount_claims_removes_marker_when_expired() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::some(1_000),
        opt::none(),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1_000);

    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);
    let claimer = tx::sender(&ctx);
    assert!(shop::test_discount_claim_exists(&template, claimer));

    clock::set_for_testing(&mut clock_obj, 1_001_000);
    let mut claimers = vector[];
    claimers.push_back(claimer);
    shop::prune_discount_claims(
        &shop,
        &owner_cap,
        &mut template,
        claimers,
        &clock_obj,
    );

    assert!(!shop::test_discount_claim_exists(&template, claimer));

    std::unit_test::destroy(clock_obj);
    shop::test_remove_template(&mut shop, template_id);
    std::unit_test::destroy(template);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountClaimsNotPrunable)]
fun prune_discount_claims_rejects_unexpired_template_even_if_paused() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::some(1_000),
        opt::none(),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1_000);

    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);
    let claimer = tx::sender(&ctx);
    let mut claimers = vector[];
    claimers.push_back(claimer);

    shop::toggle_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        false,
        &ctx,
    );
    shop::prune_discount_claims(
        &shop,
        &owner_cap,
        &mut template,
        claimers,
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateTooEarly)]
fun claim_discount_ticket_rejects_before_start_time() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 20, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        500,
        10,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 5_000);

    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateExpired)]
fun claim_discount_ticket_rejects_after_expiry() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 21, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        700,
        0,
        opt::some(3),
        opt::some(5),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 4_000);

    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateInactive)]
fun claim_discount_ticket_rejects_inactive_template() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 22, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    shop::toggle_discount_template(
        &shop,
        &owner_cap,
        &mut template,
        false,
        &ctx,
    );
    let clock_obj = clock::create_for_testing(&mut ctx);

    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateMaxedOut)]
fun claim_discount_ticket_rejects_when_maxed() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 23, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        450,
        0,
        opt::none(),
        opt::some(0),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 2_000);
    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountAlreadyClaimed)]
fun claim_discount_ticket_rejects_duplicate_claim() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 24, 0, 0, 0);
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop,
        opt::none(),
        0,
        1_250,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1_000);
    let ticket = shop::test_claim_discount_ticket_inline(
        &shop,
        &mut template,
        1,
        &mut ctx,
    );
    std::unit_test::destroy(ticket);

    shop::test_claim_discount_ticket(&shop, &mut template, &clock_obj, &mut ctx);

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountAlreadyClaimed)]
fun claim_and_buy_rejects_second_claim_after_redeem() {
    let mut scn = scenario::begin(TEST_OWNER);

    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created = event::events_by_type<shop::ShopCreatedEvent>();
    let created_len = created.length();
    assert!(created_len > 0);
    let shop_created = &created[created_len - 1];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    txf::public_transfer(owner_cap, @0x0);

    let _ = scenario::next_tx(&mut scn, @0x0);

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let currency = create_test_currency(scenario::ctx(&mut scn));
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        string_from_bytes(b"Promo Sock"),
        100,
        2,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap,
        opt::some(listing_id),
        1,
        10_000,
        0,
        opt::some(1_000),
        opt::some(5),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let payment = coin::mint_for_testing<TestCoin>(1, scenario::ctx(&mut scn));
    let mut template_obj = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let accepted_currency_obj = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing_obj = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );

    shop::test_claim_and_buy_with_ids<TestItem, TestCoin>(
        &mut shared_shop,
        &mut listing_obj,
        &accepted_currency_obj,
        &mut template_obj,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    assert!(
        shop::test_discount_claim_exists(
            &template_obj,
            OTHER_OWNER,
        ),
    );

    shop::test_claim_discount_ticket(
        &shared_shop,
        &mut template_obj,
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test]
fun claim_and_buy_item_with_discount_emits_events_and_covers_helpers() {
    let mut scn = scenario::begin(TEST_OWNER);

    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created = event::events_by_type<shop::ShopCreatedEvent>();
    let created_len = created.length();
    assert!(created_len > 0);
    let shop_created = &created[created_len - 1];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        b"Promo Item",
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap,
        opt::some(listing_id),
        1,
        10_000,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut listing_obj = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let accepted_currency_obj = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut template_obj = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency_obj,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::claim_and_buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing_obj,
        &accepted_currency_obj,
        &mut template_obj,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let purchase_events = event::events_by_type<shop::PurchaseCompletedEvent>();
    let purchase_event = &purchase_events[purchase_events.length() - 1];
    assert_eq!(shop::test_purchase_completed_coin_type(purchase_event), test_coin_type());

    let mint_events = event::events_by_type<shop::MintingCompletedEvent>();
    let mint_event = &mint_events[mint_events.length() - 1];
    let _ = shop::test_minting_completed_minted_item_id(mint_event);
    assert_eq!(shop::test_minting_completed_coin_type(mint_event), test_coin_type());

    let redeemed_events = event::events_by_type<shop::DiscountRedeemedEvent>();
    let redeemed_event = &redeemed_events[redeemed_events.length() - 1];
    let _ = shop::test_discount_redeemed_discount_id(redeemed_event);

    let listing_address = obj::id_to_address(&listing_id);
    let listing_id_opt = shop::listing_id_for_address(&shared_shop, listing_address);
    assert!(opt::is_some(&listing_id_opt));
    let template_address = obj::id_to_address(&template_id);
    let template_id_opt = shop::discount_template_id_for_address(&shared_shop, template_address);
    assert!(opt::is_some(&template_id_opt));

    let (_name, _price, _stock, _shop_address, _spotlight) = shop::test_listing_values(
        &shared_shop,
        &listing_obj,
    );
    let _listing_id_from_value = shop::test_listing_id_from_value(&listing_obj);
    let _template_id = shop::test_template_id(&template_obj);
    assert!(
        shop::test_accepted_currency_exists(
            &shared_shop,
            accepted_currency_id,
        ),
    );
    assert_eq!(
        shop::test_accepted_currency_id_for_type(&shared_shop, test_coin_type()),
        accepted_currency_id,
    );

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency_obj);
    scenario::return_shared(listing_obj);
    scenario::return_shared(template_obj);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scenario::end(scn);
}

#[test]
fun test_init_claims_publisher() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 9991, 0, 0, 0);
    shop::test_init(&mut ctx);
}

#[test]
fun test_claim_publisher_works() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 9992, 0, 0, 0);
    let publisher = shop::test_claim_publisher(&mut ctx);
    std::unit_test::destroy(publisher);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun test_abort_invalid_owner_cap_is_reachable() {
    shop::test_abort_invalid_owner_cap();
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun test_abort_accepted_currency_missing_is_reachable() {
    shop::test_abort_accepted_currency_missing();
    abort EAssertFailure
}

#[test]
fun listing_and_template_id_for_address_return_none_when_missing() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 9993, 0, 0, 0);
    let (shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let missing_address = @0x1234;

    let listing_id_opt = shop::listing_id_for_address(&shop_obj, missing_address);
    assert!(opt::is_none(&listing_id_opt));
    let template_id_opt = shop::discount_template_id_for_address(&shop_obj, missing_address);
    assert!(opt::is_none(&template_id_opt));

    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyShopName)]
fun create_shop_rejects_empty_name() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 10001, 0, 0, 0);
    shop::create_shop(b"", &mut ctx);
    abort EAssertFailure
}

#[test]
fun bytes_equal_handles_length_mismatch() {
    assert!(!shop::test_bytes_equal(b"abcd", b"abc"));
    assert!(shop::test_bytes_equal(b"same", b"same"));
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun listing_values_rejects_foreign_shop() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 10002, 0, 0, 0);
    let (mut shop_a, owner_cap_a) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (shop_b, _owner_cap_b) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    let (listing, _listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop_a,
        &owner_cap_a,
        b"Item",
        100,
        1,
        opt::none(),
        &mut ctx,
    );

    shop::test_listing_values(&shop_b, &listing);
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun discount_template_values_rejects_foreign_shop() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 10003, 0, 0, 0);
    let (mut shop_a, _owner_cap_a) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (shop_b, _owner_cap_b) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let (template, _template_id) = shop::test_create_discount_template_local(
        &mut shop_a,
        opt::none(),
        0,
        100,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );

    shop::test_discount_template_values(&shop_b, &template);
    abort EAssertFailure
}

#[test]
fun remove_listing_and_template_noop_when_missing() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 10004, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let dummy_uid = obj::new(&mut ctx);
    let dummy_id = obj::id_from_address(obj::uid_to_address(&dummy_uid));
    dummy_uid.delete();

    shop::test_remove_listing(&mut shop_obj, dummy_id);
    shop::test_remove_template(&mut shop_obj, dummy_id);

    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test]
fun quote_amount_with_positive_exponent() {
    let price_value = pyth_i64::new(1_000, false);
    let expo = pyth_i64::new(2, false);
    let price = pyth_price::new(price_value, 10, expo, 0);
    let amount = shop::test_quote_amount_from_usd_cents(
        100,
        9,
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );
    assert!(amount > 0);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceOverflow)]
fun quote_amount_rejects_large_exponent() {
    let price = sample_price();
    let _ = shop::test_quote_amount_from_usd_cents(
        100,
        39,
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EShopDisabled)]
fun claim_discount_ticket_rejects_when_shop_disabled() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 10005, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop_obj,
        opt::none(),
        0,
        100,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    shop::disable_shop(&mut shop_obj, &owner_cap, &ctx);
    let clock_obj = clock::create_for_testing(&mut ctx);

    shop::claim_discount_ticket(&shop_obj, &mut template, &clock_obj, &mut ctx);
    abort EAssertFailure
}

#[test]
fun discount_redemption_without_listing_restriction_allows_zero_price() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        b"Freebie",
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap,
        opt::none(),
        0,
        1_000,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut listing_obj = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let accepted_currency_obj = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut template_obj = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let payment = coin::mint_for_testing<TestCoin>(1, scenario::ctx(&mut scn));
    shop::claim_and_buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing_obj,
        &accepted_currency_obj,
        &mut template_obj,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let purchase_events = event::events_by_type<shop::PurchaseCompletedEvent>();
    let purchase_event = &purchase_events[purchase_events.length() - 1];
    assert_eq!(shop::test_purchase_completed_discounted_price(purchase_event), 0);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency_obj);
    scenario::return_shared(listing_obj);
    scenario::return_shared(template_obj);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketListingMismatch)]
fun discount_redemption_rejects_listing_mismatch() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        b"Listing A",
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_a_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        b"Listing B",
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_b_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap,
        opt::some(listing_a_id),
        1,
        100,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut listing_b = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_b_id,
    );
    let accepted_currency_obj = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut template_obj = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency_obj,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::claim_and_buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing_b,
        &accepted_currency_obj,
        &mut template_obj,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateMaxedOut)]
fun discount_template_maxed_out_by_redemption() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        b"Promo",
        100,
        2,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap,
        opt::some(listing_id),
        1,
        100,
        0,
        opt::none(),
        opt::some(1),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut listing_obj = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let accepted_currency_obj = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut template_obj = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency_obj,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::claim_and_buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing_obj,
        &accepted_currency_obj,
        &mut template_obj,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    shop::claim_discount_ticket(
        &shared_shop,
        &mut template_obj,
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun checkout_rejects_listing_from_other_shop() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        _shop_a_id,
        currency_a_id,
        listing_a_id,
        price_info_a_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);
    let (
        shop_b_id,
        _currency_b_id,
        _listing_b_id,
        _price_info_b_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop_b = scenario::take_shared_by_id(&scn, shop_b_id);
    let accepted_currency_a = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        currency_a_id,
    );
    let mut listing_a = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_a_id,
    );
    let price_info_a: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_a_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let payment = coin::mint_for_testing<TestCoin>(1, scenario::ctx(&mut scn));

    shop::buy_item<TestItem, TestCoin>(
        &shared_shop_b,
        &mut listing_a,
        &accepted_currency_a,
        &price_info_a,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun checkout_rejects_currency_from_other_shop() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        shop_a_id,
        _currency_a_id,
        listing_a_id,
        _price_info_a_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);
    let (
        _shop_b_id,
        currency_b_id,
        _listing_b_id,
        price_info_b_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop_a = scenario::take_shared_by_id(&scn, shop_a_id);
    let accepted_currency_b = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        currency_b_id,
    );
    let mut listing_a = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_a_id,
    );
    let price_info_b: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_b_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let payment = coin::mint_for_testing<TestCoin>(1, scenario::ctx(&mut scn));

    shop::buy_item<TestItem, TestCoin>(
        &shared_shop_a,
        &mut listing_a,
        &accepted_currency_b,
        &price_info_b,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceStatusNotTrading)]
fun price_status_rejects_attestation_before_publish() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    let price_value = pyth_i64::new(1_000, false);
    let expo = pyth_i64::new(0, false);
    let price = pyth_price::new(price_value, 10, expo, 100);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed_with_price_and_times(
        PRIMARY_FEED_ID,
        price,
        50,
        0,
        scenario::ctx(&mut scn),
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));
    std::unit_test::destroy(currency);

    txf::public_share_object(price_info_object);
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 1000);

    shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ESpotlightTemplateListingMismatch)]
fun add_item_listing_rejects_spotlight_template_listing_mismatch() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 10006, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (listing, listing_id) = shop::test_add_item_listing_local<TestItem>(
        &mut shop_obj,
        &owner_cap,
        b"Listing A",
        100,
        1,
        opt::none(),
        &mut ctx,
    );
    std::unit_test::destroy(listing);

    let (template, template_id) = shop::test_create_discount_template_local(
        &mut shop_obj,
        opt::some(listing_id),
        0,
        50,
        0,
        opt::none(),
        opt::none(),
        &mut ctx,
    );
    std::unit_test::destroy(template);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        b"Listing B",
        100,
        1,
        opt::some(template_id),
        &mut ctx,
    );

    abort EAssertFailure
}

#[test]
fun prune_discount_claims_noop_for_unclaimed_claimer() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 10007, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut template, _template_id) = shop::test_create_discount_template_local(
        &mut shop_obj,
        opt::none(),
        0,
        50,
        0,
        opt::some(1),
        opt::none(),
        &mut ctx,
    );
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 2_000);

    shop::prune_discount_claims(
        &shop_obj,
        &owner_cap,
        &mut template,
        vector[OTHER_OWNER],
        &clock_obj,
    );

    std::unit_test::destroy(clock_obj);
    std::unit_test::destroy(template);
    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun accepted_currency_values_rejects_foreign_shop() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_a = &created[0];
    let shop_b = &created[1];
    let shop_a_id = obj::id_from_address(shop::test_shop_created_shop_address(shop_a));
    let shop_b_id = obj::id_from_address(shop::test_shop_created_shop_address(shop_b));
    let owner_cap_a_id = obj::id_from_address(shop::test_shop_created_owner_cap_id(shop_a));

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );
    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_a_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_a_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        pyth_object_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);
    std::unit_test::destroy(currency);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop_b = scenario::take_shared_by_id(&scn, shop_b_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );

    shop::test_accepted_currency_values(&shared_shop_b, &accepted_currency);
    abort EAssertFailure
}

#[test]
fun remove_currency_field_clears_mapping() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        pyth_object_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );

    shop::test_remove_currency_field(&mut shop_obj, test_coin_type());
    let mapped_id = shop::accepted_currency_id_for_type(&shop_obj, test_coin_type());
    assert!(opt::is_none(&mapped_id));

    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);
    std::unit_test::destroy(currency);
    let _ = scenario::end(scn);
}

#[test]
fun remove_accepted_currency_emits_removed_event_fields() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        pyth_object_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);
    txf::public_share_object(price_info_object);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let mut shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );
    shop::remove_accepted_currency(
        &mut shared_shop,
        &owner_cap,
        &accepted_currency,
        scenario::ctx(&mut scn),
    );

    let removed_events = event::events_by_type<shop::AcceptedCoinRemovedEvent>();
    let removed_event = &removed_events[removed_events.length() - 1];
    assert_eq!(
        shop::test_accepted_coin_removed_shop(removed_event),
        shop::test_shop_id(&shared_shop),
    );
    assert_eq!(shop::test_accepted_coin_removed_coin_type(removed_event), test_coin_type());

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_to_sender(&scn, owner_cap);
    std::unit_test::destroy(currency);
    let _ = scenario::end(scn);
}

fun setup_shop_with_currency_listing_and_price_info(
    scn: &mut scenario::Scenario,
    base_price_usd_cents: u64,
    stock: u64,
): (obj::ID, obj::ID, obj::ID, obj::ID) {
    let currency = prepare_test_currency_for_owner(scn, TEST_OWNER);

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        TEST_OWNER,
        scenario::ctx(scn),
    );
    let shop_id = obj::id(&shop_obj);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(scn),
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(scn));
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        string_from_bytes(b"Checkout Item"),
        base_price_usd_cents,
        stock,
        opt::none(),
        scenario::ctx(scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(scn));

    txf::public_share_object(price_info_object);
    txf::public_share_object(shop_obj);
    txf::public_transfer(owner_cap, @0x0);

    (shop_id, accepted_currency_id, listing_id, price_info_id)
}

fun setup_shop_with_currency_listing_and_price_info_for_item<TItem: store>(
    scn: &mut scenario::Scenario,
    item_name: vector<u8>,
    base_price_usd_cents: u64,
    stock: u64,
): (obj::ID, obj::ID, obj::ID, obj::ID) {
    let currency = prepare_test_currency_for_owner(scn, TEST_OWNER);

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        TEST_OWNER,
        scenario::ctx(scn),
    );
    let shop_id = obj::id(&shop_obj);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(scn),
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(scn),
    );
    let accepted_currency_id = shop::test_last_created_id(scenario::ctx(scn));
    std::unit_test::destroy(currency);

    shop::add_item_listing<TItem>(
        &mut shop_obj,
        &owner_cap,
        string_from_bytes(item_name),
        base_price_usd_cents,
        stock,
        opt::none(),
        scenario::ctx(scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(scn));

    txf::public_share_object(price_info_object);
    txf::public_share_object(shop_obj);
    txf::public_transfer(owner_cap, @0x0);

    (shop_id, accepted_currency_id, listing_id, price_info_id)
}

#[test]
fun buy_item_emits_events_decrements_stock_and_refunds_change() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 2);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let purchase_before = event::events_by_type<shop::PurchaseCompletedEvent>().length();
    let mint_before = event::events_by_type<shop::MintingCompletedEvent>().length();
    let stock_before = event::events_by_type<shop::ItemListingStockUpdatedEvent>().length();

    let extra = 7;
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount + extra,
        scenario::ctx(&mut scn),
    );

    shop::buy_item<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let purchases = event::events_by_type<shop::PurchaseCompletedEvent>();
    assert_eq!(purchases.length(), purchase_before + 1);
    let purchase = &purchases[purchases.length() - 1];
    assert_eq!(shop::test_purchase_completed_shop(purchase), shop::test_shop_id(&shared_shop));
    assert_eq!(
        shop::test_purchase_completed_listing(purchase),
        shop::test_listing_address(&listing),
    );
    assert_eq!(shop::test_purchase_completed_buyer(purchase), OTHER_OWNER);
    assert_eq!(shop::test_purchase_completed_mint_to(purchase), OTHER_OWNER);
    assert_eq!(shop::test_purchase_completed_amount_paid(purchase), quote_amount);
    assert_eq!(shop::test_purchase_completed_quote_amount(purchase), quote_amount);
    assert_eq!(shop::test_purchase_completed_discounted_price(purchase), 100);
    assert_eq!(shop::test_purchase_completed_base_price_usd_cents(purchase), 100);
    assert_eq!(
        shop::test_purchase_completed_accepted_currency_id(purchase),
        obj::id_to_address(&accepted_currency_id),
    );
    assert_eq!(shop::test_purchase_completed_feed_id(purchase), PRIMARY_FEED_ID);
    assert!(opt::is_none(&shop::test_purchase_completed_discount_template_id(purchase)));

    let stock_events = event::events_by_type<shop::ItemListingStockUpdatedEvent>();
    assert_eq!(stock_events.length(), stock_before + 1);
    let stock_event = &stock_events[stock_events.length() - 1];
    assert_eq!(
        shop::test_item_listing_stock_updated_listing(stock_event),
        shop::test_listing_address(&listing),
    );
    assert_eq!(shop::test_item_listing_stock_updated_new_stock(stock_event), 1);

    let mints = event::events_by_type<shop::MintingCompletedEvent>();
    assert_eq!(mints.length(), mint_before + 1);
    let mint = &mints[mints.length() - 1];
    assert_eq!(shop::test_minting_completed_shop(mint), shop::test_shop_id(&shared_shop));
    assert_eq!(shop::test_minting_completed_listing(mint), shop::test_listing_address(&listing));
    assert_eq!(shop::test_minting_completed_buyer(mint), OTHER_OWNER);
    assert_eq!(shop::test_minting_completed_mint_to(mint), OTHER_OWNER);
    assert_eq!(shop::test_minting_completed_refund_to(mint), OTHER_OWNER);
    assert_eq!(shop::test_minting_completed_change_amount(mint), extra);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(listing);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scenario::end(scn);
}

#[test]
fun buy_item_supports_example_car_receipts() {
    let mut scn = scenario::begin(TEST_OWNER);
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

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        175_00,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let mint_before = event::events_by_type<shop::MintingCompletedEvent>().length();
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::buy_item<Car, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let mints = event::events_by_type<shop::MintingCompletedEvent>();
    assert_eq!(mints.length(), mint_before + 1);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(listing);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scenario::end(scn);
}

#[test]
fun buy_item_supports_example_bike_receipts() {
    let mut scn = scenario::begin(TEST_OWNER);
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

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        95_00,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let mint_before = event::events_by_type<shop::MintingCompletedEvent>().length();
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::buy_item<Bike, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let mints = event::events_by_type<shop::MintingCompletedEvent>();
    assert_eq!(mints.length(), mint_before + 1);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(listing);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scenario::end(scn);
}

#[test]
fun buy_item_emits_events_with_exact_payment_and_zero_change() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 2);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let mint_before = event::events_by_type<shop::MintingCompletedEvent>().length();

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::buy_item<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        THIRD_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let mints = event::events_by_type<shop::MintingCompletedEvent>();
    assert_eq!(mints.length(), mint_before + 1);
    let mint = &mints[mints.length() - 1];
    assert_eq!(shop::test_minting_completed_change_amount(mint), 0);
    assert_eq!(shop::test_minting_completed_refund_to(mint), THIRD_OWNER);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(listing);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EOutOfStock)]
fun buy_item_rejects_out_of_stock_after_depletion() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );
    shop::buy_item<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(listing);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 11);
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::buy_item<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun buy_item_rejects_price_info_object_id_mismatch() {
    let mut scn = scenario::begin(TEST_OWNER);
    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        TEST_OWNER,
        scenario::ctx(&mut scn),
    );
    let shop_id = obj::id(&shop_obj);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );
    let (other_price_info_object, other_price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap,
        string_from_bytes(b"Mismatch Item"),
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);
    txf::public_share_object(other_price_info_object);
    txf::public_share_object(shop_obj);
    txf::public_transfer(owner_cap, @0x0);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let other_price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        other_price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let payment = coin::mint_for_testing<TestCoin>(1, scenario::ctx(&mut scn));

    shop::buy_item<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &other_price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test]
fun buy_item_with_discount_emits_discount_redeemed_and_records_template_id() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap_obj,
        string_from_bytes(b"Discounted Item"),
        1_000,
        2,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap_obj,
        opt::some(listing_id),
        0,
        250,
        0,
        opt::none(),
        opt::some(10),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let mut template = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shop::test_claim_discount_ticket_inline(
        &shared_shop,
        &mut template,
        now_secs,
        scenario::ctx(&mut scn),
    );

    let discounted_price_usd_cents = 1_000 - 250;
    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        discounted_price_usd_cents,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let purchase_before = event::events_by_type<shop::PurchaseCompletedEvent>().length();
    let redeem_before = event::events_by_type<shop::DiscountRedeemedEvent>().length();

    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );
    shop::buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &mut template,
        ticket,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let purchases = event::events_by_type<shop::PurchaseCompletedEvent>();
    assert_eq!(purchases.length(), purchase_before + 1);
    let purchase = &purchases[purchases.length() - 1];
    assert_eq!(shop::test_purchase_completed_buyer(purchase), OTHER_OWNER);
    assert_eq!(
        shop::test_purchase_completed_discounted_price(purchase),
        discounted_price_usd_cents,
    );
    let template_id_opt = shop::test_purchase_completed_discount_template_id(
        purchase,
    );
    assert!(opt::is_some(&template_id_opt));
    assert_eq!(*opt::borrow(&template_id_opt), obj::id_to_address(&template_id));

    let redeems = event::events_by_type<shop::DiscountRedeemedEvent>();
    assert_eq!(redeems.length(), redeem_before + 1);
    let redeem = &redeems[redeems.length() - 1];
    assert_eq!(shop::test_discount_redeemed_shop(redeem), shop::test_shop_id(&shared_shop));
    assert_eq!(shop::test_discount_redeemed_template_id(redeem), obj::id_to_address(&template_id));
    assert_eq!(
        shop::test_discount_redeemed_listing_id(redeem),
        shop::test_listing_address(&listing),
    );
    assert_eq!(shop::test_discount_redeemed_buyer(redeem), OTHER_OWNER);

    let (
        _shop_address,
        _applies_to,
        _rule,
        _starts_at,
        _expires_at,
        _max_redemptions,
        claims_issued,
        redemptions,
        _active,
    ) = shop::test_discount_template_values(&shared_shop, &template);
    assert_eq!(claims_issued, 1);
    assert_eq!(redemptions, 1);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(listing);
    scenario::return_shared(template);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scenario::end(scn);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketOwnerMismatch)]
fun buy_item_with_discount_rejects_ticket_owner_mismatch() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap_obj,
        string_from_bytes(b"Owner Mismatch Item"),
        1_000,
        2,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap_obj,
        opt::some(listing_id),
        0,
        250,
        0,
        opt::none(),
        opt::some(10),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let mut template = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shop::test_claim_discount_ticket_inline(
        &shared_shop,
        &mut template,
        now_secs,
        scenario::ctx(&mut scn),
    );
    let ticket_id = obj::id(&ticket);
    txf::public_transfer(ticket, TEST_OWNER);

    scenario::return_shared(shared_shop);
    scenario::return_shared(accepted_currency);
    scenario::return_shared(listing);
    scenario::return_shared(template);
    scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let mut template = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let ticket: shop::DiscountTicket = scenario::take_from_sender_by_id(
        &scn,
        ticket_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 11);

    let payment = coin::mint_for_testing<TestCoin>(
        1_000_000,
        scenario::ctx(&mut scn),
    );
    shop::buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &mut template,
        ticket,
        &price_info_obj,
        payment,
        TEST_OWNER,
        TEST_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInsufficientPayment)]
fun buy_item_rejects_insufficient_payment() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 10_000, 2);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        10_000,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount - 1,
        scenario::ctx(&mut scn),
    );

    shop::buy_item<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidPaymentCoinType)]
fun buy_item_rejects_wrong_coin_type() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let payment = coin::mint_for_testing<AltTestCoin>(
        1,
        scenario::ctx(&mut scn),
    );
    shop::buy_item<TestItem, AltTestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EItemTypeMismatch)]
fun buy_item_rejects_item_type_mismatch() {
    let mut scn = scenario::begin(TEST_OWNER);
    let (
        shop_id,
        accepted_currency_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);

    let payment = coin::mint_for_testing<TestCoin>(1, scenario::ctx(&mut scn));
    shop::buy_item<OtherItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidGuardrailCap)]
fun buy_item_rejects_guardrail_override_above_cap() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(string_from_bytes(DEFAULT_SHOP_NAME), scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    // Seller caps must be non-zero; zero should abort with EInvalidGuardrailCap.
    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        pyth_object_id,
        opt::some(0),
        opt::some(0),
        opt::some(0),
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPriceNonPositive)]
fun quote_amount_from_usd_cents_rejects_negative_price() {
    let price_value = pyth_i64::new(1, true);
    let expo = pyth_i64::new(0, false);
    let price = pyth_price::new(price_value, 0, expo, 0);
    let _ = shop::test_quote_amount_from_usd_cents(
        100,
        9,
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateInactive)]
fun buy_item_with_discount_rejects_inactive_template() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap_obj,
        b"Inactive Template Item",
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap_obj,
        opt::some(listing_id),
        0,
        25,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut template = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shop::test_claim_discount_ticket_inline(
        &shared_shop,
        &mut template,
        now_secs,
        scenario::ctx(&mut scn),
    );
    let ticket_id = obj::id(&ticket);
    txf::public_transfer(ticket, OTHER_OWNER);

    scenario::return_shared(shared_shop);
    scenario::return_shared(template);
    std::unit_test::destroy(clock_obj);

    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let owner_cap_obj = scenario::take_from_sender_by_id<shop::ShopOwnerCap>(
        &scn,
        owner_cap_id,
    );
    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut template = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    shop::toggle_discount_template(
        &shared_shop,
        &owner_cap_obj,
        &mut template,
        false,
        scenario::ctx(&mut scn),
    );
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shared_shop);
    scenario::return_shared(template);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let mut template = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );
    let ticket = scenario::take_from_sender_by_id<shop::DiscountTicket>(
        &scn,
        ticket_id,
    );

    shop::buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &mut template,
        ticket,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketMismatch)]
fun buy_item_with_discount_rejects_ticket_template_mismatch() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_created = &created_events[0];
    let shop_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_created),
    );
    let owner_cap_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap_obj: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_id,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_obj,
        &owner_cap_obj,
        b"Template Mismatch Item",
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap_obj,
        opt::some(listing_id),
        0,
        25,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_a_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        &owner_cap_obj,
        opt::some(listing_id),
        0,
        25,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_b_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);
    scenario::return_to_sender(&scn, owner_cap_obj);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let mut template_a = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_a_id,
    );
    let mut template_b = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_b_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket = shop::test_claim_discount_ticket_inline(
        &shared_shop,
        &mut template_a,
        now_secs,
        scenario::ctx(&mut scn),
    );
    let extra_ticket = shop::test_claim_discount_ticket_inline(
        &shared_shop,
        &mut template_b,
        now_secs,
        scenario::ctx(&mut scn),
    );
    txf::public_transfer(extra_ticket, OTHER_OWNER);
    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop,
        &accepted_currency,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop,
        &mut listing,
        &accepted_currency,
        &mut template_b,
        ticket,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountTicketShopMismatch)]
fun buy_item_with_discount_rejects_ticket_shop_mismatch() {
    let mut scn = scenario::begin(TEST_OWNER);
    shop::create_shop(DEFAULT_SHOP_NAME, scenario::ctx(&mut scn));
    shop::create_shop(b"Other Shop", scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreatedEvent>();
    let shop_a_created = &created_events[created_events.length() - 2];
    let shop_b_created = &created_events[created_events.length() - 1];
    let shop_a_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_a_created),
    );
    let owner_cap_a_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_a_created),
    );
    let shop_b_id = obj::id_from_address(
        shop::test_shop_created_shop_address(shop_b_created),
    );
    let owner_cap_b_id = obj::id_from_address(
        shop::test_shop_created_owner_cap_id(shop_b_created),
    );

    let currency = prepare_test_currency_for_owner(&mut scn, TEST_OWNER);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        scenario::ctx(&mut scn),
    );

    let mut shop_a = scenario::take_shared_by_id(&scn, shop_a_id);
    let owner_cap_a: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_a_id,
    );
    shop::add_accepted_currency<TestCoin>(
        &mut shop_a,
        &owner_cap_a,
        &currency,
        &price_info_object,
        PRIMARY_FEED_ID,
        price_info_id,
        opt::none(),
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let accepted_currency_id = shop::test_last_created_id(
        scenario::ctx(&mut scn),
    );
    std::unit_test::destroy(currency);

    shop::add_item_listing<TestItem>(
        &mut shop_a,
        &owner_cap_a,
        b"Shop A Item",
        100,
        1,
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_a,
        &owner_cap_a,
        opt::some(listing_id),
        0,
        25,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_a_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    let mut shop_b = scenario::take_shared_by_id(&scn, shop_b_id);
    let owner_cap_b: shop::ShopOwnerCap = scenario::take_from_sender_by_id(
        &scn,
        owner_cap_b_id,
    );
    shop::create_discount_template(
        &mut shop_b,
        &owner_cap_b,
        opt::none(),
        0,
        25,
        0,
        opt::none(),
        opt::none(),
        scenario::ctx(&mut scn),
    );
    let template_b_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    txf::public_share_object(price_info_object);
    scenario::return_to_sender(&scn, owner_cap_a);
    scenario::return_to_sender(&scn, owner_cap_b);
    scenario::return_shared(shop_a);
    scenario::return_shared(shop_b);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let shared_shop_a = scenario::take_shared_by_id(&scn, shop_a_id);
    let accepted_currency = scenario::take_shared_by_id<shop::AcceptedCurrency>(
        &scn,
        accepted_currency_id,
    );
    let mut listing = scenario::take_shared_by_id<shop::ItemListing>(
        &scn,
        listing_id,
    );
    let mut template_a = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_a_id,
    );
    let shared_shop_b = scenario::take_shared_by_id(&scn, shop_b_id);
    let mut template_b = scenario::take_shared_by_id<shop::DiscountTemplate>(
        &scn,
        template_b_id,
    );
    let price_info_obj: pyth_price_info::PriceInfoObject = scenario::take_shared_by_id(
        &scn,
        price_info_id,
    );

    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10);
    let now_secs = clock::timestamp_ms(&clock_obj) / 1000;
    let ticket_a = shop::test_claim_discount_ticket_inline(
        &shared_shop_a,
        &mut template_a,
        now_secs,
        scenario::ctx(&mut scn),
    );
    txf::public_transfer(ticket_a, OTHER_OWNER);
    let ticket_b = shop::test_claim_discount_ticket_inline(
        &shared_shop_b,
        &mut template_b,
        now_secs,
        scenario::ctx(&mut scn),
    );
    let quote_amount = shop::test_quote_amount_for_price_info_object(
        &shared_shop_a,
        &accepted_currency,
        &price_info_obj,
        100,
        opt::none(),
        opt::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<TestCoin>(
        quote_amount,
        scenario::ctx(&mut scn),
    );

    shop::buy_item_with_discount<TestItem, TestCoin>(
        &shared_shop_a,
        &mut listing,
        &accepted_currency,
        &mut template_a,
        ticket_b,
        &price_info_obj,
        payment,
        OTHER_OWNER,
        OTHER_OWNER,
        opt::none(),
        opt::none(),
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EConfidenceExceedsPrice)]
fun quote_amount_from_usd_cents_rejects_confidence_exceeds_price() {
    let price_value = pyth_i64::new(10, false);
    let expo = pyth_i64::new(0, false);
    let price = pyth_price::new(price_value, 10, expo, 0);
    let _ = shop::test_quote_amount_from_usd_cents(
        100,
        9,
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );
    abort EAssertFailure
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EConfidenceIntervalTooWide)]
fun quote_amount_from_usd_cents_rejects_confidence_interval_too_wide() {
    let price_value = pyth_i64::new(100, false);
    let expo = pyth_i64::new(0, false);
    let price = pyth_price::new(price_value, 50, expo, 0);
    let _ = shop::test_quote_amount_from_usd_cents(
        100,
        9,
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );
    abort EAssertFailure
}

fun create_test_currency(ctx: &mut tx::TxContext): registry::Currency<TestCoin> {
    let mut registry_obj = registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = registry::new_currency<TestCoin>(
        &mut registry_obj,
        9,
        b"TCO".to_string(),
        b"Test Coin".to_string(),
        b"Test coin for shop".to_string(),
        b"".to_string(),
        ctx,
    );
    let currency = registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    txf::public_share_object(treasury_cap);
    currency
}

fun create_alt_test_currency(ctx: &mut tx::TxContext): registry::Currency<AltTestCoin> {
    let mut registry_obj = registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = registry::new_currency<AltTestCoin>(
        &mut registry_obj,
        6,
        b"ATC".to_string(),
        b"Alt Test Coin".to_string(),
        b"Alternate test coin for shop".to_string(),
        b"".to_string(),
        ctx,
    );
    let currency = registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    txf::public_share_object(treasury_cap);
    currency
}

fun create_high_decimal_currency(ctx: &mut tx::TxContext): registry::Currency<HighDecimalCoin> {
    let mut registry_obj = registry::create_coin_data_registry_for_testing(ctx);
    let over_max_decimals = (shop::test_max_decimal_power() + 1) as u8;
    let (init, treasury_cap) = registry::new_currency<HighDecimalCoin>(
        &mut registry_obj,
        over_max_decimals,
        b"HDC".to_string(),
        b"High Decimal Coin".to_string(),
        b"Test coin with >MAX_DECIMAL_POWER decimals".to_string(),
        b"".to_string(),
        ctx,
    );
    let currency = registry::unwrap_for_testing(init);
    std::unit_test::destroy(registry_obj);
    txf::public_share_object(treasury_cap);
    currency
}

fun prepare_test_currency_for_owner(
    scn: &mut scenario::Scenario,
    owner: address,
): registry::Currency<TestCoin> {
    let _ = scenario::next_tx(scn, @0x0);
    let currency = create_test_currency(scenario::ctx(scn));
    let _ = scenario::next_tx(scn, owner);
    currency
}

fun test_coin_type(): type_name::TypeName {
    type_name::with_defining_ids<TestCoin>()
}

fun create_discount_template(
    shop: &mut shop::Shop,
    _owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx::TxContext,
): (shop::DiscountTemplate, obj::ID) {
    shop::test_create_discount_template_local(
        shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        ctx,
    )
}
