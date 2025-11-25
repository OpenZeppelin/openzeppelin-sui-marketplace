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
use std::vector as vec;
use sui::clock;
use sui::coin_registry as registry;
use sui::event;
use sui::object as obj;
use sui::package as pkg;
use sui::test_scenario as scenario;
use sui::test_utils;
use sui::transfer as txf;
use sui::tx_context as tx;
use sui::vec_map;
use sui_oracle_market::shop;

const TEST_OWNER: address = @0xBEEF;
const OTHER_OWNER: address = @0xCAFE;
const THIRD_OWNER: address = @0xD00D;
const E_ASSERT_FAILURE: u64 = 0;

public struct ForeignPublisherOTW has drop {}
public struct TestCoin has key, store { id: obj::UID }
public struct AltTestCoin has key, store { id: obj::UID }

const PRIMARY_FEED_ID: vector<u8> =
    x"000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f";
const SECONDARY_FEED_ID: vector<u8> =
    x"101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f";
const TERTIARY_FEED_ID: vector<u8> =
    x"202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const SHORT_FEED_ID: vector<u8> = b"SHORT";

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
    let price_identifier = pyth_price_identifier::from_byte_vec(feed_id);
    let price_feed = pyth_price_feed::new(price_identifier, price, price);
    let price_info = pyth_price_info::new_price_info(0, 0, price_feed);
    let price_info_object = pyth_price_info::new_price_info_object_for_test(price_info, ctx);
    let price_info_id = pyth_price_info::uid_to_inner(&price_info_object);
    (price_info_object, price_info_id)
}

fun add_currency_with_feed<T: store>(
    shop: &mut shop::Shop,
    currency: &registry::Currency<T>,
    feed_id: vector<u8>,
    owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx::TxContext,
): obj::ID {
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(feed_id, ctx);
    shop::add_accepted_currency<T>(
        shop,
        currency,
        feed_id,
        price_info_id,
        &price_info_object,
        owner_cap,
        ctx,
    );
    txf::public_share_object(price_info_object);
    price_info_id
}

#[test]
fun create_shop_emits_event_and_records_ids() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 1, 0, 0, 0);
    let publisher = shop::test_claim_publisher(&mut ctx);
    let starting_ids = tx::get_ids_created(&ctx);

    shop::create_shop(&publisher, &mut ctx);

    let created = event::events_by_type<shop::ShopCreated>();
    assert!(vec::length(&created) == 1, E_ASSERT_FAILURE);
    let shop_created = vec::borrow(&created, 0);
    let owner_cap_addr = obj::id_to_address(&shop::test_last_created_id(&ctx));

    assert!(shop::test_shop_created_owner(shop_created) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_created_owner_cap_id(shop_created) == owner_cap_addr, E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == starting_ids + 2, E_ASSERT_FAILURE);

    shop::test_destroy_publisher(publisher);
}

#[test]
fun create_shop_allows_reuse_of_publisher() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 2, 0, 0, 0);
    let publisher = shop::test_claim_publisher(&mut ctx);
    let starting_ids = tx::get_ids_created(&ctx);

    shop::create_shop(&publisher, &mut ctx);
    shop::create_shop(&publisher, &mut ctx);

    let created = event::events_by_type<shop::ShopCreated>();
    assert!(vec::length(&created) == 2, E_ASSERT_FAILURE);
    let first = vec::borrow(&created, 0);
    let second = vec::borrow(&created, 1);
    assert!(shop::test_shop_created_owner(first) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_created_owner(second) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == starting_ids + 4, E_ASSERT_FAILURE);

    shop::test_destroy_publisher(publisher);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidPublisher)]
fun create_shop_rejects_foreign_publisher() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 3, 0, 0, 0);
    let foreign_publisher = claim_foreign_publisher(&mut ctx);

    shop::create_shop(&foreign_publisher, &mut ctx);

    shop::test_destroy_publisher(foreign_publisher);
    abort E_ASSERT_FAILURE
}

#[test]
fun create_shop_emits_unique_shop_and_cap_ids() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 4, 0, 0, 0);
    let publisher = shop::test_claim_publisher(&mut ctx);

    shop::create_shop(&publisher, &mut ctx);
    shop::create_shop(&publisher, &mut ctx);

    let created = event::events_by_type<shop::ShopCreated>();
    assert!(vec::length(&created) == 2, E_ASSERT_FAILURE);
    let first = vec::borrow(&created, 0);
    let second = vec::borrow(&created, 1);
    assert!(
        shop::test_shop_created_shop_address(first) != shop::test_shop_created_shop_address(second),
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_shop_created_owner_cap_id(first)
            != shop::test_shop_created_owner_cap_id(second),
        E_ASSERT_FAILURE,
    );

    shop::test_destroy_publisher(publisher);
}

#[test]
fun create_shop_records_sender_in_event() {
    let mut ctx = tx::new_from_hint(OTHER_OWNER, 5, 0, 0, 0);
    let publisher = shop::test_claim_publisher(&mut ctx);

    shop::create_shop(&publisher, &mut ctx);

    let created = event::events_by_type<shop::ShopCreated>();
    assert!(vec::length(&created) == 1, E_ASSERT_FAILURE);
    let shop_created = vec::borrow(&created, 0);
    assert!(shop::test_shop_created_owner(shop_created) == OTHER_OWNER, E_ASSERT_FAILURE);

    shop::test_destroy_publisher(publisher);
}

#[test]
fun create_shop_handles_existing_id_counts() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 6, 0, 0, 0);
    let publisher = shop::test_claim_publisher(&mut ctx);

    let (temp_shop, temp_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    shop::test_destroy_owner_cap(temp_cap);
    shop::test_destroy_shop(temp_shop);

    let starting_ids = tx::get_ids_created(&ctx);

    shop::create_shop(&publisher, &mut ctx);

    assert!(tx::get_ids_created(&ctx) == starting_ids + 2, E_ASSERT_FAILURE);

    shop::test_destroy_publisher(publisher);
}

#[test]
fun create_shop_shares_shop_and_transfers_owner_cap() {
    let mut scn = scenario::begin(TEST_OWNER);
    let publisher = shop::test_claim_publisher(scenario::ctx(&mut scn));

    shop::create_shop(&publisher, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreated>();
    assert!(vec::length(&created_events) == 1, E_ASSERT_FAILURE);
    let shop_created = vec::borrow(&created_events, 0);
    let shop_id = obj::id_from_address(shop::test_shop_created_shop_address(shop_created));
    let owner_cap_id = obj::id_from_address(shop::test_shop_created_owner_cap_id(shop_created));

    shop::test_destroy_publisher(publisher);

    let effects = scenario::next_tx(&mut scn, TEST_OWNER);
    let created_ids = scenario::created(&effects);
    assert!(vec::length(&created_ids) == 2, E_ASSERT_FAILURE);
    assert!(*vec::borrow(&created_ids, 0) == shop_id, E_ASSERT_FAILURE);
    assert!(*vec::borrow(&created_ids, 1) == owner_cap_id, E_ASSERT_FAILURE);

    let shared_ids = scenario::shared(&effects);
    assert!(vec::length(&shared_ids) == 1, E_ASSERT_FAILURE);
    assert!(*vec::borrow(&shared_ids, 0) == shop_id, E_ASSERT_FAILURE);

    let transferred = scenario::transferred_to_account(&effects);
    assert!(vec_map::length(&transferred) == 1, E_ASSERT_FAILURE);
    assert!(*vec_map::get(&transferred, &owner_cap_id) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(scenario::num_user_events(&effects) == 1, E_ASSERT_FAILURE);

    let shared_shop: shop::Shop = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(&scn, owner_cap_id);
    assert!(shop::test_shop_owner(&shared_shop) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_cap_owner(&owner_cap) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(
        shop::test_shop_owner_cap_shop_address(&owner_cap) == shop::test_shop_id(&shared_shop),
        E_ASSERT_FAILURE,
    );

    scenario::return_shared(shared_shop);
    scenario::return_to_sender(&scn, owner_cap);
    let _ = scenario::end(scn);
}

#[test]
fun update_shop_owner_rotates_payout_and_emits_event() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 40, 0, 0, 0);
    let (mut shop, mut owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::update_shop_owner(&mut shop, &mut owner_cap, OTHER_OWNER, &mut ctx);

    assert!(shop::test_shop_owner(&shop) == OTHER_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_cap_owner(&owner_cap) == OTHER_OWNER, E_ASSERT_FAILURE);

    let events = event::events_by_type<shop::ShopOwnerUpdated>();
    assert!(vec::length(&events) == 1, E_ASSERT_FAILURE);
    let rotated = vec::borrow(&events, 0);
    let cap_id = shop::test_shop_owner_cap_id(&owner_cap);

    assert!(
        shop::test_shop_owner_updated_shop(rotated) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_shop_owner_updated_previous(rotated) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_new(rotated) == OTHER_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_cap_id(rotated) == cap_id, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_rotated_by(rotated) == TEST_OWNER, E_ASSERT_FAILURE);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun update_shop_owner_emits_event_even_when_unchanged() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 42, 0, 0, 0);
    let (mut shop, mut owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::update_shop_owner(&mut shop, &mut owner_cap, TEST_OWNER, &mut ctx);

    assert!(shop::test_shop_owner(&shop) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_cap_owner(&owner_cap) == TEST_OWNER, E_ASSERT_FAILURE);

    let events = event::events_by_type<shop::ShopOwnerUpdated>();
    assert!(vec::length(&events) == 1, E_ASSERT_FAILURE);
    let rotated = vec::borrow(&events, 0);
    let cap_id = shop::test_shop_owner_cap_id(&owner_cap);
    let shop_id = shop::test_shop_id(&shop);

    assert!(shop::test_shop_owner_updated_shop(rotated) == shop_id, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_previous(rotated) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_new(rotated) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_cap_id(rotated) == cap_id, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_rotated_by(rotated) == TEST_OWNER, E_ASSERT_FAILURE);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun update_shop_owner_records_rotated_by_sender() {
    let mut ctx = tx::new_from_hint(THIRD_OWNER, 43, 0, 0, 0);
    let (mut shop, mut owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::update_shop_owner(&mut shop, &mut owner_cap, OTHER_OWNER, &mut ctx);

    let events = event::events_by_type<shop::ShopOwnerUpdated>();
    assert!(vec::length(&events) == 1, E_ASSERT_FAILURE);
    let rotated = vec::borrow(&events, 0);

    assert!(shop::test_shop_owner(&shop) == OTHER_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_cap_owner(&owner_cap) == OTHER_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_previous(rotated) == TEST_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_new(rotated) == OTHER_OWNER, E_ASSERT_FAILURE);
    assert!(shop::test_shop_owner_updated_rotated_by(rotated) == THIRD_OWNER, E_ASSERT_FAILURE);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_shop_owner_rejects_foreign_cap() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 41, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, mut other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::update_shop_owner(&mut shop, &mut other_cap, OTHER_OWNER, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun add_accepted_currency_records_currency_and_event() {
    let mut ctx = tx::new_from_hint(@0x0, 7, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let expected_feed_id = PRIMARY_FEED_ID;
    let feed_for_registration = PRIMARY_FEED_ID;
    let (price_info_object, pyth_object_id) = create_price_info_object_for_feed(
        feed_for_registration,
        &mut ctx,
    );
    let created_before = tx::get_ids_created(&ctx);
    let events_before = vec::length(&event::events_by_type<shop::AcceptedCoinAdded>());
    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &currency,
        expected_feed_id,
        pyth_object_id,
        &price_info_object,
        &owner_cap,
        &mut ctx,
    );
    txf::public_share_object(price_info_object);

    let accepted_currency_id = shop::test_last_created_id(&ctx);
    assert!(tx::get_ids_created(&ctx) == created_before + 1, E_ASSERT_FAILURE);
    assert!(shop::test_accepted_currency_exists(&shop, accepted_currency_id), E_ASSERT_FAILURE);
    let (
        shop_address,
        coin_type,
        stored_feed_id,
        stored_pyth,
        decimals,
        symbol,
    ) = shop::test_accepted_currency_values(&shop, accepted_currency_id);
    assert!(shop_address == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(coin_type == test_coin_type(), E_ASSERT_FAILURE);
    assert!(stored_feed_id == expected_feed_id, E_ASSERT_FAILURE);
    assert!(stored_pyth == pyth_object_id, E_ASSERT_FAILURE);
    assert!(decimals == 9, E_ASSERT_FAILURE);
    assert!(symbol == b"TCO", E_ASSERT_FAILURE);
    let mapped_id = shop::test_accepted_currency_id_for_type(&shop, coin_type);
    assert!(mapped_id == accepted_currency_id, E_ASSERT_FAILURE);

    let added_events = event::events_by_type<shop::AcceptedCoinAdded>();
    assert!(vec::length(&added_events) == events_before + 1, E_ASSERT_FAILURE);
    let added_event = vec::borrow(&added_events, events_before);
    assert!(
        shop::test_accepted_coin_added_shop(added_event) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_accepted_coin_added_coin_type(added_event) == coin_type, E_ASSERT_FAILURE);
    assert!(
        shop::test_accepted_coin_added_feed_id(added_event) == expected_feed_id,
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_accepted_coin_added_pyth_object_id(added_event) == pyth_object_id,
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_accepted_coin_added_decimals(added_event) == 9, E_ASSERT_FAILURE);

    test_utils::destroy(currency);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_accepted_currency_rejects_foreign_owner_cap() {
    let mut ctx = tx::new_from_hint(@0x0, 8, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed(
        PRIMARY_FEED_ID,
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &currency,
        b"BAD",
        price_info_id,
        &price_info_object,
        &other_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyExists)]
fun add_accepted_currency_rejects_duplicate_coin_type() {
    let mut ctx = tx::new_from_hint(@0x0, 9, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);

    add_currency_with_feed<TestCoin>(&mut shop, &currency, PRIMARY_FEED_ID, &owner_cap, &mut ctx);

    add_currency_with_feed<TestCoin>(&mut shop, &currency, SECONDARY_FEED_ID, &owner_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
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
        &currency,
        b"",
        price_info_id,
        &price_info_object,
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
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
        &currency,
        SHORT_FEED_ID,
        price_info_id,
        &price_info_object,
        &owner_cap,
        &mut ctx,
    );

    test_utils::destroy(currency);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
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
        &currency,
        SECONDARY_FEED_ID,
        price_info_id,
        &price_info_object,
        &owner_cap,
        &mut ctx,
    );

    test_utils::destroy(currency);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun add_accepted_currency_rejects_missing_price_object() {
    let mut ctx = tx::new_from_hint(@0x0, 16, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, _) = create_price_info_object_for_feed(PRIMARY_FEED_ID, &mut ctx);

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &currency,
        PRIMARY_FEED_ID,
        obj::id_from_address(@0xB),
        &price_info_object,
        &owner_cap,
        &mut ctx,
    );

    test_utils::destroy(currency);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun remove_accepted_currency_removes_state_and_emits_event() {
    let mut ctx = tx::new_from_hint(@0x0, 11, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let primary_currency = create_test_currency(&mut ctx);
    let secondary_currency = create_alt_test_currency(&mut ctx);
    let removed_before = vec::length(&event::events_by_type<shop::AcceptedCoinRemoved>());

    add_currency_with_feed<TestCoin>(
        &mut shop,
        &primary_currency,
        PRIMARY_FEED_ID,
        &owner_cap,
        &mut ctx,
    );
    let first_currency_id = shop::test_last_created_id(&ctx);

    add_currency_with_feed<AltTestCoin>(
        &mut shop,
        &secondary_currency,
        SECONDARY_FEED_ID,
        &owner_cap,
        &mut ctx,
    );
    let second_currency_id = shop::test_last_created_id(&ctx);
    let created_before_removal = tx::get_ids_created(&ctx);

    shop::remove_accepted_currency(&mut shop, first_currency_id, &owner_cap, &mut ctx);

    assert!(!shop::test_accepted_currency_exists(&shop, first_currency_id), E_ASSERT_FAILURE);
    assert!(shop::test_accepted_currency_exists(&shop, second_currency_id), E_ASSERT_FAILURE);
    assert!(
        shop::test_accepted_currency_id_for_type(&shop, alt_coin_type()) == second_currency_id,
        E_ASSERT_FAILURE,
    );
    assert!(tx::get_ids_created(&ctx) == created_before_removal, E_ASSERT_FAILURE);

    let removed_events = event::events_by_type<shop::AcceptedCoinRemoved>();
    assert!(vec::length(&removed_events) == removed_before + 1, E_ASSERT_FAILURE);
    let removed_event = vec::borrow(&removed_events, removed_before);
    assert!(
        shop::test_accepted_coin_removed_shop(removed_event) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_accepted_coin_removed_coin_type(removed_event) == test_coin_type(),
        E_ASSERT_FAILURE,
    );

    add_currency_with_feed<TestCoin>(
        &mut shop,
        &primary_currency,
        TERTIARY_FEED_ID,
        &owner_cap,
        &mut ctx,
    );
    let readded_currency_id = shop::test_last_created_id(&ctx);
    assert!(
        shop::test_accepted_currency_id_for_type(&shop, test_coin_type()) == readded_currency_id,
        E_ASSERT_FAILURE,
    );

    shop::remove_accepted_currency(&mut shop, readded_currency_id, &owner_cap, &mut ctx);
    shop::remove_accepted_currency(&mut shop, second_currency_id, &owner_cap, &mut ctx);
    test_utils::destroy(primary_currency);
    test_utils::destroy(secondary_currency);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_accepted_currency_rejects_foreign_owner_cap() {
    let mut ctx = tx::new_from_hint(@0x0, 12, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);

    add_currency_with_feed<TestCoin>(
        &mut shop,
        &currency,
        PRIMARY_FEED_ID,
        &owner_cap,
        &mut ctx,
    );
    let currency_id = shop::test_last_created_id(&ctx);

    shop::remove_accepted_currency(&mut shop, currency_id, &other_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_rejects_missing_id() {
    let mut ctx = tx::new_from_hint(@0x0, 13, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::remove_accepted_currency(
        &mut shop,
        obj::id_from_address(@0xDEAD),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun quote_view_matches_internal_math() {
    let mut ctx = tx::new_from_hint(@0x0, 17, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed_with_price(
        PRIMARY_FEED_ID,
        sample_price(),
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &currency,
        PRIMARY_FEED_ID,
        price_info_id,
        &price_info_object,
        &owner_cap,
        &mut ctx,
    );
    let accepted_currency_id = shop::test_last_created_id(&ctx);
    let (
        _,
        _,
        _,
        _,
        decimals,
        _,
    ) = shop::test_accepted_currency_values(&shop, accepted_currency_id);

    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1);
    let price_usd_cents: u64 = 10_000;

    let view_quote = shop::quote_amount_for_price_info_object(
        &shop,
        accepted_currency_id,
        &price_info_object,
        price_usd_cents,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    let price = pyth::get_price_no_older_than(
        &price_info_object,
        &clock_obj,
        shop::test_default_max_price_age_secs(),
    );
    let derived_quote = shop::test_quote_amount_from_usd_cents(
        price_usd_cents,
        decimals,
        &price,
        shop::test_default_max_confidence_ratio_bps(),
    );

    assert!(derived_quote == 10_101_010_102, E_ASSERT_FAILURE);
    assert!(view_quote == derived_quote, E_ASSERT_FAILURE);

    txf::public_share_object(price_info_object);
    clock::destroy_for_testing(clock_obj);
    test_utils::destroy(currency);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun quote_view_rejects_mismatched_price_info_object() {
    let mut ctx = tx::new_from_hint(@0x0, 18, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let currency = create_test_currency(&mut ctx);
    let (price_info_object, price_info_id) = create_price_info_object_for_feed_with_price(
        PRIMARY_FEED_ID,
        sample_price(),
        &mut ctx,
    );

    shop::add_accepted_currency<TestCoin>(
        &mut shop,
        &currency,
        PRIMARY_FEED_ID,
        price_info_id,
        &price_info_object,
        &owner_cap,
        &mut ctx,
    );
    let accepted_currency_id = shop::test_last_created_id(&ctx);
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1);
    let (mismatched_price_info_object, _) = create_price_info_object_for_feed_with_price(
        SECONDARY_FEED_ID,
        sample_price(),
        &mut ctx,
    );

    shop::quote_amount_for_price_info_object(
        &shop,
        accepted_currency_id,
        &mismatched_price_info_object,
        10_000,
        opt::none(),
        opt::none(),
        &clock_obj,
    );

    txf::public_share_object(price_info_object);
    txf::public_share_object(mismatched_price_info_object);
    clock::destroy_for_testing(clock_obj);
    test_utils::destroy(currency);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun add_item_listing_stores_metadata() {
    let mut ctx: tx::TxContext = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Cool Bike",
        125_00,
        25,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);
    assert!(shop::test_listing_exists(&shop, listing_id), E_ASSERT_FAILURE);
    let (
        name,
        base_price_usd_cents,
        stock,
        shop_id,
        spotlight_template_id,
    ) = shop::test_listing_values(
        &shop,
        listing_id,
    );
    let added_events = event::events_by_type<shop::ItemListingAdded>();
    assert!(vec::length(&added_events) == 1, E_ASSERT_FAILURE);
    let added_event = vec::borrow(&added_events, 0);

    assert!(name == b"Cool Bike", E_ASSERT_FAILURE);
    assert!(base_price_usd_cents == 125_00, E_ASSERT_FAILURE);
    assert!(stock == 25, E_ASSERT_FAILURE);
    assert!(shop_id == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::is_none(&spotlight_template_id), E_ASSERT_FAILURE);
    let shop_address = shop::test_shop_id(&shop);
    let listing_address = obj::id_to_address(&listing_id);
    assert!(shop::test_item_listing_added_shop(added_event) == shop_address, E_ASSERT_FAILURE);
    assert!(
        shop::test_item_listing_added_listing(added_event) == listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_item_listing_added_name(added_event) == b"Cool Bike", E_ASSERT_FAILURE);
    assert!(
        shop::test_item_listing_added_base_price_usd_cents(added_event) == 125_00,
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_item_listing_added_stock(added_event) == 25, E_ASSERT_FAILURE);
    assert!(
        opt::is_none(&shop::test_item_listing_added_spotlight_template(added_event)),
        E_ASSERT_FAILURE,
    );

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun add_item_listing_links_spotlight_template() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 44, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Limited Tire Set",
        200_00,
        8,
        opt::some(template_id),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);
    let (_, _, _, _, spotlight_template_id) = shop::test_listing_values(&shop, listing_id);
    let added_events = event::events_by_type<shop::ItemListingAdded>();
    assert!(vec::length(&added_events) == 1, E_ASSERT_FAILURE);
    let added_event = vec::borrow(&added_events, 0);
    let shop_address = shop::test_shop_id(&shop);
    let listing_address = obj::id_to_address(&listing_id);

    assert!(opt::is_some(&spotlight_template_id), E_ASSERT_FAILURE);
    assert!(opt::borrow(&spotlight_template_id) == template_id, E_ASSERT_FAILURE);
    assert!(shop::test_item_listing_added_shop(added_event) == shop_address, E_ASSERT_FAILURE);
    assert!(
        shop::test_item_listing_added_listing(added_event) == listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_name(added_event) == b"Limited Tire Set",
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_base_price_usd_cents(added_event) == 200_00,
        E_ASSERT_FAILURE,
    );
    let spotlight_template = shop::test_item_listing_added_spotlight_template(added_event);
    assert!(opt::is_some(&spotlight_template), E_ASSERT_FAILURE);
    assert!(opt::borrow(&spotlight_template) == obj::id_to_address(&template_id), E_ASSERT_FAILURE);
    assert!(shop::test_item_listing_added_stock(added_event) == 8, E_ASSERT_FAILURE);

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyItemName)]
fun add_item_listing_rejects_empty_name() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 45, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"",
        100_00,
        10,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Wrong Owner Cap",
        15_00,
        3,
        opt::none(),
        &other_cap,
        &mut ctx,
    );

    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidPrice)]
fun add_item_listing_rejects_zero_price() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Zero Price",
        0,
        10,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EZeroStock)]
fun add_item_listing_rejects_zero_stock() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"No Stock",
        10_00,
        0,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun add_item_listing_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let foreign_template = create_discount_template(&mut other_shop, &other_cap, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Bad Template",
        15_00,
        5,
        opt::some(foreign_template),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_template(&mut other_shop, foreign_template);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun update_item_listing_stock_updates_listing_and_emits_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Helmet",
        48_00,
        4,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);
    let listing_address = obj::id_to_address(&listing_id);

    shop::update_item_listing_stock(&mut shop, listing_id, 11, &owner_cap, &mut ctx);

    let (
        name,
        base_price_usd_cents,
        stock,
        shop_id,
        spotlight_template,
    ) = shop::test_listing_values(&shop, listing_id);
    assert!(name == b"Helmet", E_ASSERT_FAILURE);
    assert!(base_price_usd_cents == 48_00, E_ASSERT_FAILURE);
    assert!(opt::is_none(&spotlight_template), E_ASSERT_FAILURE);
    assert!(stock == 11, E_ASSERT_FAILURE);

    let stock_events = event::events_by_type<shop::ItemListingStockUpdated>();
    assert!(vec::length(&stock_events) == 1, E_ASSERT_FAILURE);
    let stock_event = vec::borrow(&stock_events, 0);
    assert!(shop::test_item_listing_stock_updated_shop(stock_event) == shop_id, E_ASSERT_FAILURE);
    assert!(
        shop::test_item_listing_stock_updated_listing(stock_event) == listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_item_listing_stock_updated_new_stock(stock_event) == 11, E_ASSERT_FAILURE);

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_item_listing_stock_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (foreign_shop, foreign_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Borrowed Listing",
        18_00,
        9,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);

    shop::update_item_listing_stock(&mut shop, listing_id, 7, &foreign_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(foreign_cap);
    shop::test_destroy_shop(foreign_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = 0x2::dynamic_field::EFieldDoesNotExist)]
fun update_item_listing_stock_rejects_unknown_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut other_shop,
        b"Foreign Listing",
        10_00,
        2,
        opt::none(),
        &other_cap,
        &mut ctx,
    );

    let foreign_listing_id = shop::test_last_created_id(&ctx);

    shop::update_item_listing_stock(&mut shop, foreign_listing_id, 3, &owner_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_listing(&mut other_shop, foreign_listing_id);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun update_item_listing_stock_handles_multiple_updates_and_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Pads",
        22_00,
        5,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);
    let listing_address = obj::id_to_address(&listing_id);

    shop::update_item_listing_stock(&mut shop, listing_id, 8, &owner_cap, &mut ctx);
    shop::update_item_listing_stock(&mut shop, listing_id, 3, &owner_cap, &mut ctx);

    let (_, _, stock, _, _) = shop::test_listing_values(&shop, listing_id);
    assert!(stock == 3, E_ASSERT_FAILURE);

    let stock_events = event::events_by_type<shop::ItemListingStockUpdated>();
    assert!(vec::length(&stock_events) == 2, E_ASSERT_FAILURE);
    let first = vec::borrow(&stock_events, 0);
    let second = vec::borrow(&stock_events, 1);
    assert!(
        shop::test_item_listing_stock_updated_listing(first) == listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_stock_updated_listing(second) == listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_item_listing_stock_updated_new_stock(first) == 8, E_ASSERT_FAILURE);
    assert!(shop::test_item_listing_stock_updated_new_stock(second) == 3, E_ASSERT_FAILURE);

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun remove_item_listing_removes_listing_and_emits_event() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Chain Grease",
        12_00,
        3,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let removed_listing_id = shop::test_last_created_id(&ctx);
    let removed_listing_address = obj::id_to_address(&removed_listing_id);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Repair Kit",
        42_00,
        2,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let remaining_listing_id = shop::test_last_created_id(&ctx);
    let shop_address = shop::test_shop_id(&shop);

    shop::remove_item_listing(&mut shop, removed_listing_id, &owner_cap, &mut ctx);

    let removed_events = event::events_by_type<shop::ItemListingRemoved>();
    assert!(vec::length(&removed_events) == 1, E_ASSERT_FAILURE);
    let removed = vec::borrow(&removed_events, 0);
    assert!(shop::test_item_listing_removed_shop(removed) == shop_address, E_ASSERT_FAILURE);
    assert!(
        shop::test_item_listing_removed_listing(removed) == removed_listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(!shop::test_listing_exists(&shop, removed_listing_id), E_ASSERT_FAILURE);

    assert!(shop::test_listing_exists(&shop, remaining_listing_id), E_ASSERT_FAILURE);
    let (name, price, stock, listing_shop_address, spotlight) = shop::test_listing_values(
        &shop,
        remaining_listing_id,
    );
    assert!(name == b"Repair Kit", E_ASSERT_FAILURE);
    assert!(price == 42_00, E_ASSERT_FAILURE);
    assert!(stock == 2, E_ASSERT_FAILURE);
    assert!(spotlight == opt::none(), E_ASSERT_FAILURE);
    assert!(listing_shop_address == shop_address, E_ASSERT_FAILURE);

    shop::test_remove_listing(&mut shop, remaining_listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (foreign_shop, foreign_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Borrowed Owner",
        30_00,
        6,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);

    shop::remove_item_listing(&mut shop, listing_id, &foreign_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(foreign_cap);
    shop::test_destroy_shop(foreign_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = 0x2::dynamic_field::EFieldDoesNotExist)]
fun remove_item_listing_rejects_unknown_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut other_shop,
        b"Foreign Stock",
        55_00,
        4,
        opt::none(),
        &other_cap,
        &mut ctx,
    );

    let foreign_listing_id = shop::test_last_created_id(&ctx);

    shop::remove_item_listing(&mut shop, foreign_listing_id, &owner_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_listing(&mut other_shop, foreign_listing_id);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EZeroStock)]
fun update_item_listing_stock_rejects_zero_stock() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Maintenance Kit",
        32_00,
        5,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);

    shop::update_item_listing_stock(&mut shop, listing_id, 0, &owner_cap, &mut ctx);

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun create_discount_template_persists_fields_and_emits_event() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_250,
        10,
        opt::some(50),
        opt::some(5),
        &owner_cap,
        &mut ctx,
    );

    let template_id = shop::test_last_created_id(&ctx);
    let template_address = obj::id_to_address(&template_id);
    assert!(shop::test_discount_template_exists(&shop, template_id), E_ASSERT_FAILURE);

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
    ) = shop::test_discount_template_values(&shop, template_id);

    assert!(shop_address == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::is_none(&applies_to_listing), E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_kind(rule) == 0, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(rule) == 1_250, E_ASSERT_FAILURE);
    assert!(starts_at == 10, E_ASSERT_FAILURE);
    assert!(opt::borrow(&expires_at) == 50, E_ASSERT_FAILURE);
    assert!(opt::borrow(&max_redemptions) == 5, E_ASSERT_FAILURE);
    assert!(claims_issued == 0, E_ASSERT_FAILURE);
    assert!(redemptions == 0, E_ASSERT_FAILURE);
    assert!(active, E_ASSERT_FAILURE);

    let created_events = event::events_by_type<shop::DiscountTemplateCreated>();
    assert!(vec::length(&created_events) == 1, E_ASSERT_FAILURE);
    let created = vec::borrow(&created_events, 0);
    assert!(
        shop::test_discount_template_created_shop(created) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_discount_template_created_id(created) == template_address, E_ASSERT_FAILURE);
    let created_rule = shop::test_discount_template_created_rule(created);
    assert!(shop::test_discount_rule_kind(created_rule) == 0, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(created_rule) == 1_250, E_ASSERT_FAILURE);

    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun create_discount_template_links_listing_and_percent_rule() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Wheelset",
        600_00,
        4,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);

    shop::create_discount_template(
        &mut shop,
        opt::some(listing_id),
        1,
        2_500,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let template_id = shop::test_last_created_id(&ctx);
    assert!(shop::test_discount_template_exists(&shop, template_id), E_ASSERT_FAILURE);
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
    ) = shop::test_discount_template_values(&shop, template_id);

    assert!(shop_address == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::borrow(&applies_to_listing) == listing_id, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_kind(rule) == 1, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(rule) == 2_500, E_ASSERT_FAILURE);
    assert!(starts_at == 0, E_ASSERT_FAILURE);
    assert!(opt::is_none(&expires_at), E_ASSERT_FAILURE);
    assert!(opt::is_none(&max_redemptions), E_ASSERT_FAILURE);
    assert!(claims_issued == 0, E_ASSERT_FAILURE);
    assert!(redemptions == 0, E_ASSERT_FAILURE);
    assert!(active, E_ASSERT_FAILURE);

    let created_events = event::events_by_type<shop::DiscountTemplateCreated>();
    assert!(vec::length(&created_events) == 1, E_ASSERT_FAILURE);
    let created = vec::borrow(&created_events, 0);
    let created_rule = shop::test_discount_template_created_rule(created);
    assert!(shop::test_discount_rule_kind(created_rule) == 1, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(created_rule) == 2_500, E_ASSERT_FAILURE);

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun create_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        100,
        0,
        opt::none(),
        opt::none(),
        &other_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleKind)]
fun create_discount_template_rejects_invalid_rule_kind() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        2,
        100,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleValue)]
fun create_discount_template_rejects_percent_above_limit() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        1,
        10_001,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateWindow)]
fun create_discount_template_rejects_invalid_schedule() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_000,
        10,
        opt::some(10),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun create_discount_template_rejects_foreign_listing_reference() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut other_shop,
        b"Foreign Listing",
        7_500,
        2,
        opt::none(),
        &other_cap,
        &mut ctx,
    );
    let foreign_listing_id = shop::test_last_created_id(&ctx);

    shop::create_discount_template(
        &mut shop,
        opt::some(foreign_listing_id),
        0,
        500,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_listing(&mut other_shop, foreign_listing_id);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun update_discount_template_updates_fields_and_emits_event() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Wheelset",
        600_00,
        4,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);

    shop::create_discount_template(
        &mut shop,
        opt::some(listing_id),
        0,
        1_000,
        10,
        opt::some(20),
        opt::some(2),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);

    shop::update_discount_template(
        &mut shop,
        template_id,
        1,
        750,
        50,
        opt::some(200),
        opt::some(10),
        &owner_cap,
    );

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
    ) = shop::test_discount_template_values(&shop, template_id);
    assert!(shop_address == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::borrow(&applies_to_listing) == listing_id, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_kind(rule) == 1, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(rule) == 750, E_ASSERT_FAILURE);
    assert!(starts_at == 50, E_ASSERT_FAILURE);
    assert!(opt::borrow(&expires_at) == 200, E_ASSERT_FAILURE);
    assert!(opt::borrow(&max_redemptions) == 10, E_ASSERT_FAILURE);
    assert!(claims_issued == 0, E_ASSERT_FAILURE);
    assert!(redemptions == 0, E_ASSERT_FAILURE);
    assert!(active, E_ASSERT_FAILURE);

    let updated_events = event::events_by_type<shop::DiscountTemplateUpdated>();
    assert!(vec::length(&updated_events) == 1, E_ASSERT_FAILURE);
    let updated = vec::borrow(&updated_events, 0);
    assert!(
        shop::test_discount_template_updated_shop(updated) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_discount_template_updated_id(updated) == obj::id_to_address(&template_id),
        E_ASSERT_FAILURE,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, shop_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::none(),
        &shop_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);

    shop::update_discount_template(
        &mut shop,
        template_id,
        0,
        250,
        0,
        opt::none(),
        opt::none(),
        &other_cap,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(shop_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun update_discount_template_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let foreign_template = create_discount_template(&mut other_shop, &other_cap, &mut ctx);

    shop::update_discount_template(
        &mut shop,
        foreign_template,
        0,
        250,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_template(&mut other_shop, foreign_template);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateWindow)]
fun update_discount_template_rejects_invalid_schedule() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::some(50),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);

    shop::update_discount_template(
        &mut shop,
        template_id,
        0,
        1_000,
        100,
        opt::some(50),
        opt::none(),
        &owner_cap,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleKind)]
fun update_discount_template_rejects_invalid_rule_kind() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);

    shop::update_discount_template(
        &mut shop,
        template_id,
        2,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidRuleValue)]
fun update_discount_template_rejects_percent_above_limit() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);

    shop::update_discount_template(
        &mut shop,
        template_id,
        1,
        10_001,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun toggle_discount_template_updates_active_and_emits_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        2_000,
        25,
        opt::some(50),
        opt::some(3),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
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
    ) = shop::test_discount_template_values(&shop, template_id);

    assert!(active, E_ASSERT_FAILURE);
    shop::toggle_discount_template(&mut shop, template_id, false, &owner_cap, &mut ctx);

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
    ) = shop::test_discount_template_values(&shop, template_id);

    assert!(shop_address_after_first == shop_address, E_ASSERT_FAILURE);
    assert!(applies_to_listing_after_first == applies_to_listing, E_ASSERT_FAILURE);
    assert!(
        shop::test_discount_rule_kind(rule_after_first) == shop::test_discount_rule_kind(rule),
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_discount_rule_value(rule_after_first) == shop::test_discount_rule_value(rule),
        E_ASSERT_FAILURE,
    );
    assert!(starts_at_after_first == starts_at, E_ASSERT_FAILURE);
    assert!(expires_at_after_first == expires_at, E_ASSERT_FAILURE);
    assert!(max_redemptions_after_first == max_redemptions, E_ASSERT_FAILURE);
    assert!(claims_issued_after_first == claims_issued, E_ASSERT_FAILURE);
    assert!(redemptions_after_first == redemptions, E_ASSERT_FAILURE);
    assert!(!active_after_first, E_ASSERT_FAILURE);

    let toggled_events = event::events_by_type<shop::DiscountTemplateToggled>();
    assert!(vec::length(&toggled_events) == 1, E_ASSERT_FAILURE);
    let first = vec::borrow(&toggled_events, 0);
    assert!(
        shop::test_discount_template_toggled_shop(first) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_discount_template_toggled_id(first) == template_address, E_ASSERT_FAILURE);
    assert!(!shop::test_discount_template_toggled_active(first), E_ASSERT_FAILURE);

    shop::toggle_discount_template(&mut shop, template_id, true, &owner_cap, &mut ctx);

    let (
        _,
        _,
        _,
        _,
        _,
        _,
        claims_issued_after_second,
        redemptions_after_second,
        active_after_second,
    ) = shop::test_discount_template_values(&shop, template_id);
    assert!(claims_issued_after_second == claims_issued, E_ASSERT_FAILURE);
    assert!(redemptions_after_second == redemptions, E_ASSERT_FAILURE);
    assert!(active_after_second, E_ASSERT_FAILURE);

    let toggled_events_after_second = event::events_by_type<shop::DiscountTemplateToggled>();
    assert!(vec::length(&toggled_events_after_second) == 2, E_ASSERT_FAILURE);
    let second = vec::borrow(&toggled_events_after_second, 1);
    assert!(shop::test_discount_template_toggled_id(second) == template_address, E_ASSERT_FAILURE);
    assert!(shop::test_discount_template_toggled_active(second), E_ASSERT_FAILURE);

    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_discount_template_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let template_id = create_discount_template(&mut shop, &_owner_cap, &mut ctx);

    shop::toggle_discount_template(&mut shop, template_id, false, &other_cap, &mut ctx);

    shop::test_destroy_owner_cap(_owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_discount_template_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);
    let foreign_template = create_discount_template(&mut other_shop, &other_cap, &mut ctx);

    shop::toggle_discount_template(&mut shop, foreign_template, false, &owner_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_template(&mut other_shop, foreign_template);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_discount_template_rejects_unknown_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let stray_template_uid = obj::new(&mut ctx);
    let stray_template = obj::uid_to_inner(&stray_template_uid);

    shop::toggle_discount_template(&mut shop, stray_template, false, &owner_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    obj::delete(stray_template_uid);
    abort E_ASSERT_FAILURE
}

#[test]
fun toggle_template_on_listing_sets_and_clears_spotlight() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Promo Jacket",
        180_00,
        6,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);
    let ids_before_toggle = tx::get_ids_created(&ctx);

    let (_, _, _, _, spotlight_before) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::is_none(&spotlight_before), E_ASSERT_FAILURE);
    assert!(
        vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0,
        E_ASSERT_FAILURE,
    );

    shop::toggle_template_on_listing(
        &mut shop,
        listing_id,
        opt::some(template_id),
        &owner_cap,
        &mut ctx,
    );

    let (_, _, _, _, spotlight_after_set) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::is_some(&spotlight_after_set), E_ASSERT_FAILURE);
    assert!(opt::borrow(&spotlight_after_set) == template_id, E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == ids_before_toggle, E_ASSERT_FAILURE);
    assert!(
        vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0,
        E_ASSERT_FAILURE,
    );

    shop::toggle_template_on_listing(&mut shop, listing_id, opt::none(), &owner_cap, &mut ctx);

    let (_, _, _, _, spotlight_after_clear) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::is_none(&spotlight_after_clear), E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == ids_before_toggle, E_ASSERT_FAILURE);
    assert!(
        vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0,
        E_ASSERT_FAILURE,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_template_on_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Chain Lube",
        12_00,
        30,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);

    shop::toggle_template_on_listing(
        &mut shop,
        listing_id,
        opt::some(template_id),
        &other_cap,
        &mut ctx,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun toggle_template_on_listing_rejects_foreign_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut other_shop,
        b"Spare Tube",
        8_00,
        15,
        opt::none(),
        &other_cap,
        &mut ctx,
    );
    let foreign_listing_id = shop::test_last_created_id(&ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);

    shop::toggle_template_on_listing(
        &mut shop,
        foreign_listing_id,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_listing(&mut other_shop, foreign_listing_id);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_template_on_listing_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Bike Pump",
        35_00,
        10,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let foreign_template = create_discount_template(&mut other_shop, &other_cap, &mut ctx);

    shop::toggle_template_on_listing(
        &mut shop,
        listing_id,
        opt::some(foreign_template),
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_template(&mut other_shop, foreign_template);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun toggle_template_on_listing_rejects_unknown_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Frame Protector",
        22_00,
        40,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let stray_template_uid = obj::new(&mut ctx);
    let stray_template = obj::uid_to_inner(&stray_template_uid);

    shop::toggle_template_on_listing(
        &mut shop,
        listing_id,
        opt::some(stray_template),
        &owner_cap,
        &mut ctx,
    );

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    obj::delete(stray_template_uid);
    abort E_ASSERT_FAILURE
}

#[test]
fun attach_template_to_listing_sets_spotlight_without_emitting_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Promo Bag",
        95_00,
        12,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);
    let ids_before = tx::get_ids_created(&ctx);
    let toggled_before = vec::length(&event::events_by_type<shop::DiscountTemplateToggled>());

    shop::attach_template_to_listing(&mut shop, listing_id, template_id, &owner_cap, &mut ctx);

    let (_, _, _, shop_id, spotlight) = shop::test_listing_values(&shop, listing_id);
    assert!(shop_id == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::is_some(&spotlight), E_ASSERT_FAILURE);
    assert!(opt::borrow(&spotlight) == template_id, E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == ids_before, E_ASSERT_FAILURE);
    assert!(
        vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == toggled_before,
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_discount_template_exists(&shop, template_id), E_ASSERT_FAILURE);

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun attach_template_to_listing_overwrites_existing_spotlight() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    let first_template = create_discount_template(&mut shop, &owner_cap, &mut ctx);
    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Bundle",
        140_00,
        3,
        opt::some(first_template),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let second_template = create_discount_template(&mut shop, &owner_cap, &mut ctx);
    let ids_before = tx::get_ids_created(&ctx);

    let (_, _, _, _, spotlight_before) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::borrow(&spotlight_before) == first_template, E_ASSERT_FAILURE);

    shop::attach_template_to_listing(
        &mut shop,
        listing_id,
        second_template,
        &owner_cap,
        &mut ctx,
    );

    let (_, _, _, _, spotlight_after) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::borrow(&spotlight_after) == second_template, E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == ids_before, E_ASSERT_FAILURE);
    assert!(shop::test_discount_template_exists(&shop, first_template), E_ASSERT_FAILURE);
    assert!(shop::test_discount_template_exists(&shop, second_template), E_ASSERT_FAILURE);
    assert!(
        vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0,
        E_ASSERT_FAILURE,
    );

    shop::test_remove_template(&mut shop, second_template);
    shop::test_remove_template(&mut shop, first_template);
    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun attach_template_to_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Helmet Stickers",
        9_00,
        10,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);

    shop::attach_template_to_listing(&mut shop, listing_id, template_id, &other_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun attach_template_to_listing_rejects_foreign_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut other_shop,
        b"Brake Pads",
        18_00,
        4,
        opt::none(),
        &other_cap,
        &mut ctx,
    );
    let foreign_listing = shop::test_last_created_id(&ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);

    shop::attach_template_to_listing(&mut shop, foreign_listing, template_id, &owner_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_listing(&mut other_shop, foreign_listing);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun attach_template_to_listing_rejects_foreign_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Chain Whip",
        27_00,
        5,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let foreign_template = create_discount_template(&mut other_shop, &other_cap, &mut ctx);

    shop::attach_template_to_listing(
        &mut shop,
        listing_id,
        foreign_template,
        &owner_cap,
        &mut ctx,
    );

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_template(&mut other_shop, foreign_template);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateShopMismatch)]
fun attach_template_to_listing_rejects_unknown_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Pedals",
        51_00,
        6,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let stray_template_uid = obj::new(&mut ctx);
    let stray_template = obj::uid_to_inner(&stray_template_uid);

    shop::attach_template_to_listing(
        &mut shop,
        listing_id,
        stray_template,
        &owner_cap,
        &mut ctx,
    );

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    obj::delete(stray_template_uid);
    abort E_ASSERT_FAILURE
}

#[test]
fun clear_template_from_listing_removes_spotlight_without_side_effects() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Rain Jacket",
        120_00,
        7,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);
    shop::attach_template_to_listing(&mut shop, listing_id, template_id, &owner_cap, &mut ctx);

    let (_, _, _, _, spotlight_before) = shop::test_listing_values(&shop, listing_id);
    let created_before = tx::get_ids_created(&ctx);
    let toggled_before = vec::length(&event::events_by_type<shop::DiscountTemplateToggled>());
    assert!(opt::borrow(&spotlight_before) == template_id, E_ASSERT_FAILURE);

    shop::clear_template_from_listing(&mut shop, listing_id, &owner_cap, &mut ctx);

    let (_, _, _, _, spotlight_after) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::is_none(&spotlight_after), E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == created_before, E_ASSERT_FAILURE);
    assert!(
        vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == toggled_before,
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_discount_template_exists(&shop, template_id), E_ASSERT_FAILURE);

    shop::test_remove_template(&mut shop, template_id);
    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun clear_template_from_listing_is_noop_when_no_spotlight_set() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Bar Tape",
        19_00,
        25,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);
    let created_before = tx::get_ids_created(&ctx);
    let toggled_before = vec::length(&event::events_by_type<shop::DiscountTemplateToggled>());

    shop::clear_template_from_listing(&mut shop, listing_id, &owner_cap, &mut ctx);

    let (_, _, _, _, spotlight_after) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::is_none(&spotlight_after), E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == created_before, E_ASSERT_FAILURE);
    assert!(
        vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == toggled_before,
        E_ASSERT_FAILURE,
    );

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun clear_template_from_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop,
        b"Valve Stem",
        11_00,
        14,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop::test_last_created_id(&ctx);

    shop::clear_template_from_listing(&mut shop, listing_id, &other_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingShopMismatch)]
fun clear_template_from_listing_rejects_foreign_listing() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::ShopItem>(
        &mut other_shop,
        b"Cassette",
        85_00,
        9,
        opt::none(),
        &other_cap,
        &mut ctx,
    );
    let foreign_listing_id = shop::test_last_created_id(&ctx);

    shop::clear_template_from_listing(&mut shop, foreign_listing_id, &owner_cap, &mut ctx);

    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    shop::test_remove_listing(&mut other_shop, foreign_listing_id);
    shop::test_destroy_owner_cap(other_cap);
    shop::test_destroy_shop(other_shop);
    abort E_ASSERT_FAILURE
}

#[test]
fun claim_discount_ticket_mints_transfers_and_records_claim() {
    let mut scn = scenario::begin(TEST_OWNER);
    let publisher = shop::test_claim_publisher(scenario::ctx(&mut scn));

    shop::create_shop(&publisher, scenario::ctx(&mut scn));
    let created_events = event::events_by_type<shop::ShopCreated>();
    assert!(vec::length(&created_events) == 1, E_ASSERT_FAILURE);
    let created = vec::borrow(&created_events, 0);
    let shop_id = obj::id_from_address(shop::test_shop_created_shop_address(created));
    let owner_cap_id = obj::id_from_address(shop::test_shop_created_owner_cap_id(created));

    shop::test_destroy_publisher(publisher);
    let _ = scenario::next_tx(&mut scn, TEST_OWNER);

    let mut shop_obj = scenario::take_shared_by_id(&scn, shop_id);
    let owner_cap: shop::ShopOwnerCap = scenario::take_from_sender_by_id(&scn, owner_cap_id);

    shop::add_item_listing<shop::ShopItem>(
        &mut shop_obj,
        b"Limited Helmet",
        120_00,
        3,
        opt::none(),
        &owner_cap,
        scenario::ctx(&mut scn),
    );
    let listing_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    shop::create_discount_template(
        &mut shop_obj,
        opt::some(listing_id),
        0,
        1_500,
        5,
        opt::some(50),
        opt::some(10),
        &owner_cap,
        scenario::ctx(&mut scn),
    );
    let template_id = shop::test_last_created_id(scenario::ctx(&mut scn));

    scenario::return_to_sender(&scn, owner_cap);
    scenario::return_shared(shop_obj);

    let _ = scenario::next_tx(&mut scn, OTHER_OWNER);

    let mut shared_shop = scenario::take_shared_by_id(&scn, shop_id);
    let mut clock_obj = clock::create_for_testing(scenario::ctx(&mut scn));
    clock::set_for_testing(&mut clock_obj, 10_000);
    let (_, _, _, _, _, _, claims_issued_before, _, _) = shop::test_discount_template_values(
        &shared_shop,
        template_id,
    );

    shop::test_claim_discount_ticket(
        &mut shared_shop,
        template_id,
        &clock_obj,
        scenario::ctx(&mut scn),
    );

    let (_, _, _, _, _, _, claims_issued_after, _, _) = shop::test_discount_template_values(
        &shared_shop,
        template_id,
    );
    assert!(claims_issued_after == claims_issued_before + 1, E_ASSERT_FAILURE);
    assert!(
        shop::test_discount_claim_exists(&shared_shop, template_id, OTHER_OWNER),
        E_ASSERT_FAILURE,
    );

    let claim_events = event::events_by_type<shop::DiscountClaimed>();
    let claim_events_len = vec::length(&claim_events);
    assert!(claim_events_len > 0, E_ASSERT_FAILURE);
    let claimed = vec::borrow(&claim_events, claim_events_len - 1);
    let shop_address = obj::id_to_address(&shop_id);
    let template_address = obj::id_to_address(&template_id);
    assert!(shop::test_discount_claimed_shop(claimed) == shop_address, E_ASSERT_FAILURE);
    assert!(shop::test_discount_claimed_template_id(claimed) == template_address, E_ASSERT_FAILURE);
    assert!(shop::test_discount_claimed_claimer(claimed) == OTHER_OWNER, E_ASSERT_FAILURE);
    let ticket_id = obj::id_from_address(shop::test_discount_claimed_discount_id(claimed));

    scenario::return_shared(shared_shop);
    clock::destroy_for_testing(clock_obj);

    let effects = scenario::next_tx(&mut scn, OTHER_OWNER);
    assert!(scenario::num_user_events(&effects) == 1, E_ASSERT_FAILURE);
    let ticket = scenario::take_from_sender_by_id<shop::DiscountTicket>(&scn, ticket_id);
    let (
        ticket_template,
        ticket_shop,
        ticket_listing,
        ticket_owner,
    ) = shop::test_discount_ticket_values(&ticket);
    assert!(ticket_template == template_address, E_ASSERT_FAILURE);
    assert!(ticket_shop == shop_address, E_ASSERT_FAILURE);
    assert!(opt::borrow(&ticket_listing) == listing_id, E_ASSERT_FAILURE);
    assert!(ticket_owner == OTHER_OWNER, E_ASSERT_FAILURE);
    scenario::return_to_sender(&scn, ticket);

    let _ = scenario::end(scn);
}

#[test]
fun prune_discount_claims_removes_marker_for_inactive_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1_000);

    shop::test_claim_discount_ticket(&mut shop, template_id, &clock_obj, &mut ctx);
    let claimer = tx::sender(&ctx);
    assert!(shop::test_discount_claim_exists(&shop, template_id, claimer), E_ASSERT_FAILURE);

    shop::toggle_discount_template(&mut shop, template_id, false, &owner_cap, &mut ctx);
    let mut claimers = vec::empty<address>();
    vec::push_back(&mut claimers, claimer);
    shop::prune_discount_claims(
        &mut shop,
        template_id,
        claimers,
        &owner_cap,
        &clock_obj,
    );

    assert!(!shop::test_discount_claim_exists(&shop, template_id, claimer), E_ASSERT_FAILURE);

    clock::destroy_for_testing(clock_obj);
    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountClaimsNotPrunable)]
fun prune_discount_claims_rejects_active_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1_000);

    shop::test_claim_discount_ticket(&mut shop, template_id, &clock_obj, &mut ctx);
    let claimer = tx::sender(&ctx);
    let mut claimers = vec::empty<address>();
    vec::push_back(&mut claimers, claimer);

    shop::prune_discount_claims(
        &mut shop,
        template_id,
        claimers,
        &owner_cap,
        &clock_obj,
    );

    clock::destroy_for_testing(clock_obj);
    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateTooEarly)]
fun claim_discount_ticket_rejects_before_start_time() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 20, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        500,
        10,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 5_000);

    shop::test_claim_discount_ticket(&mut shop, template_id, &clock_obj, &mut ctx);

    clock::destroy_for_testing(clock_obj);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateExpired)]
fun claim_discount_ticket_rejects_after_expiry() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 21, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        700,
        0,
        opt::some(3),
        opt::some(5),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 4_000);

    shop::test_claim_discount_ticket(&mut shop, template_id, &clock_obj, &mut ctx);

    clock::destroy_for_testing(clock_obj);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateInactive)]
fun claim_discount_ticket_rejects_inactive_template() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 22, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_000,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
    shop::toggle_discount_template(&mut shop, template_id, false, &owner_cap, &mut ctx);
    let clock_obj = clock::create_for_testing(&mut ctx);

    shop::test_claim_discount_ticket(&mut shop, template_id, &clock_obj, &mut ctx);

    clock::destroy_for_testing(clock_obj);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::ETemplateMaxedOut)]
fun claim_discount_ticket_rejects_when_maxed() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 23, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        450,
        0,
        opt::none(),
        opt::some(0),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 2_000);
    shop::test_claim_discount_ticket(&mut shop, template_id, &clock_obj, &mut ctx);

    clock::destroy_for_testing(clock_obj);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountAlreadyClaimed)]
fun claim_discount_ticket_rejects_duplicate_claim() {
    let mut ctx = tx::new_from_hint(TEST_OWNER, 24, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::create_discount_template(
        &mut shop,
        opt::none(),
        0,
        1_250,
        0,
        opt::none(),
        opt::none(),
        &owner_cap,
        &mut ctx,
    );
    let template_id = shop::test_last_created_id(&ctx);
    let mut clock_obj = clock::create_for_testing(&mut ctx);
    clock::set_for_testing(&mut clock_obj, 1_000);
    let ticket = shop::test_claim_discount_ticket_inline(
        &mut shop,
        template_id,
        TEST_OWNER,
        1,
        &mut ctx,
    );
    shop::test_destroy_discount_ticket(ticket);

    shop::test_claim_discount_ticket(&mut shop, template_id, &clock_obj, &mut ctx);

    clock::destroy_for_testing(clock_obj);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
    abort E_ASSERT_FAILURE
}

fun create_test_currency(ctx: &mut tx::TxContext): registry::Currency<TestCoin> {
    let mut registry_obj = registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = registry::new_currency<TestCoin>(
        &mut registry_obj,
        9,
        string::utf8(b"TCO"),
        string::utf8(b"Test Coin"),
        string::utf8(b"Test coin for shop"),
        string::utf8(b""),
        ctx,
    );
    let currency = registry::unwrap_for_testing(init);
    test_utils::destroy(registry_obj);
    txf::public_share_object(treasury_cap);
    currency
}

fun create_alt_test_currency(ctx: &mut tx::TxContext): registry::Currency<AltTestCoin> {
    let mut registry_obj = registry::create_coin_data_registry_for_testing(ctx);
    let (init, treasury_cap) = registry::new_currency<AltTestCoin>(
        &mut registry_obj,
        6,
        string::utf8(b"ATC"),
        string::utf8(b"Alt Test Coin"),
        string::utf8(b"Alternate test coin for shop"),
        string::utf8(b""),
        ctx,
    );
    let currency = registry::unwrap_for_testing(init);
    test_utils::destroy(registry_obj);
    txf::public_share_object(treasury_cap);
    currency
}

fun test_coin_type(): type_name::TypeName {
    type_name::with_defining_ids<TestCoin>()
}

fun alt_coin_type(): type_name::TypeName {
    type_name::with_defining_ids<AltTestCoin>()
}

fun create_discount_template(
    shop: &mut shop::Shop,
    owner_cap: &shop::ShopOwnerCap,
    ctx: &mut tx::TxContext,
): obj::ID {
    shop::create_discount_template(
        shop,
        opt::none(),
        0,
        500,
        0,
        opt::none(),
        opt::some(5),
        owner_cap,
        ctx,
    );
    shop::test_last_created_id(ctx)
}

fun claim_foreign_publisher(ctx: &mut tx::TxContext): pkg::Publisher {
    pkg::test_claim<ForeignPublisherOTW>(ForeignPublisherOTW {}, ctx)
}
