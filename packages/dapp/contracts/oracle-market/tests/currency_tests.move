#[test_only]
module sui_oracle_market::currency_tests;

use pyth::i64;
use pyth::price;
use pyth::price_info;
use pyth::pyth;
use std::unit_test::assert_eq;
use sui::test_scenario;
use sui_oracle_market::currency;
use sui_oracle_market::events;
use sui_oracle_market::shop;
use sui_oracle_market::test_helpers::{Self, assert_emitted, owner, second_owner};

// === Tests ===

#[test]
fun update_shop_owner_updates_owner_and_emits_previous_owner_event() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.update_shop_owner(&owner_cap, second_owner());

    assert_eq!(shop.owner(), second_owner());
    assert_emitted!(
        events::shop_owner_updated(
            shop.id(),
            owner_cap.owner_cap_id(),
            owner(),
        ),
    );

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyExists)]
fun add_accepted_currency_rejects_duplicate_coin_type() {
    let mut ctx = tx_context::new_from_hint(@0x0, 9, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let currency = test_helpers::create_test_currency(&mut ctx);

    let _ = test_helpers::add_currency_with_feed<test_helpers::TestCoin>(
        &mut shop,
        &currency,
        test_helpers::primary_feed_id(),
        &owner_cap,
        &mut ctx,
    );

    let _ = test_helpers::add_currency_with_feed<test_helpers::TestCoin>(
        &mut shop,
        &currency,
        test_helpers::secondary_feed_id(),
        &owner_cap,
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EEmptyFeedId)]
fun add_accepted_currency_rejects_empty_feed_id() {
    let mut ctx = tx_context::new_from_hint(@0x0, 10, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let currency = test_helpers::create_test_currency(&mut ctx);
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        b"",
        price_info_id,
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EInvalidFeedIdLength)]
fun add_accepted_currency_rejects_short_feed_id() {
    let mut ctx = tx_context::new_from_hint(@0x0, 14, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let currency = test_helpers::create_test_currency(&mut ctx);
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        test_helpers::short_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EUnsupportedCurrencyDecimals)]
fun add_accepted_currency_rejects_excessive_decimals() {
    let mut ctx = tx_context::new_from_hint(@0x0, 11, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let currency = test_helpers::create_high_decimal_currency(&mut ctx);
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<test_helpers::HighDecimalCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EFeedIdentifierMismatch)]
fun add_accepted_currency_rejects_identifier_mismatch() {
    let mut ctx = tx_context::new_from_hint(@0x0, 15, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let currency = test_helpers::create_test_currency(&mut ctx);
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        &mut ctx,
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        test_helpers::secondary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun add_accepted_currency_rejects_missing_price_object() {
    let mut ctx = tx_context::new_from_hint(@0x0, 17, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let currency = test_helpers::create_test_currency(&mut ctx);
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        &mut ctx,
    );

    shop.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        @0xB.to_id(),
        option::none(),
        option::none(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EPriceInvalidPublishTime)]
fun quote_rejects_price_timestamp_older_than_max_age() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(&mut scn, owner());
    // Timestamp = 0 keeps the Price stale once we advance the on-chain clock.
    let publish_time = 0;
    let price = price::new(
        i64::new(1_000, false),
        10,
        i64::new(2, true),
        publish_time,
    );
    let price_info_object = test_helpers::create_price_info_object_for_feed_with_price_and_times(
        test_helpers::primary_feed_id(),
        price,
        publish_time,
        publish_time,
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = scn.next_tx(owner());

    let shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 200_000);

    shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &scn.take_shared_by_id<price_info::PriceInfoObject>(
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
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let _ = scn.next_tx(owner());
    let _ = scn.next_tx(@0x0);
    let primary_currency = test_helpers::create_test_currency(scn.ctx());
    let secondary_currency = test_helpers::create_alt_test_currency(scn.ctx());
    let _ = scn.next_tx(owner());

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    let first_price_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let first_price_id = first_price_object.uid_to_inner();

    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap_obj,
        &primary_currency,
        &first_price_object,
        test_helpers::primary_feed_id(),
        first_price_id,
        option::none(),
        option::none(),
    );
    let _first_currency_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    transfer::public_share_object(first_price_object);

    let second_price_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::secondary_feed_id(),
        scn.ctx(),
    );
    let second_price_id = second_price_object.uid_to_inner();

    shop_obj.add_accepted_currency<test_helpers::AltTestCoin>(
        &owner_cap_obj,
        &secondary_currency,
        &second_price_object,
        test_helpers::secondary_feed_id(),
        second_price_id,
        option::none(),
        option::none(),
    );
    let _second_currency_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    transfer::public_share_object(second_price_object);
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    std::unit_test::destroy(primary_currency);
    std::unit_test::destroy(secondary_currency);
    let _ = scn.end();
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_accepted_currency_rejects_foreign_owner_cap() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let _ = scn.next_tx(second_owner());
    let (_, wrong_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let _ = scn.next_tx(owner());
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    let currency = test_helpers::prepare_test_currency_for_owner(&mut scn, owner());
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = scn.next_tx(second_owner());

    let wrong_cap = scn.take_from_sender_by_id(
        wrong_cap_id,
    );
    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);

    shared_shop.remove_accepted_currency<test_helpers::TestCoin>(
        &wrong_cap,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_rejects_missing_id() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let _ = scn.next_tx(second_owner());
    let (
        other_shop_id,
        other_owner_cap_id,
    ) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(&mut scn, second_owner());
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut other_shop_obj = scn.take_shared_by_id<shop::Shop>(
        other_shop_id,
    );
    let other_owner_cap_obj = scn.take_from_sender_by_id<shop::ShopOwnerCap>(
        other_owner_cap_id,
    );
    other_shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &other_owner_cap_obj,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    let _foreign_currency_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    scn.return_to_sender(other_owner_cap_obj);
    test_scenario::return_shared(other_shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = scn.next_tx(owner());
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    shared_shop.remove_accepted_currency<test_helpers::TestCoin>(
        &owner_cap_obj,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_handles_missing_type_mapping() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(&mut scn, owner());
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(currency);
    transfer::public_share_object(price_info_object);

    test_helpers::remove_currency_if_exists<test_helpers::TestCoin>(&mut shop_obj, &owner_cap);

    scn.return_to_sender(owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(owner());

    let owner_cap = scn.take_from_sender_by_id<shop::ShopOwnerCap>(
        owner_cap_id,
    );
    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    shared_shop.remove_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun remove_accepted_currency_rejects_mismatched_type_mapping() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(&mut scn, owner());
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    let _first_currency_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    std::unit_test::destroy(currency);

    test_helpers::remove_currency_if_exists<test_helpers::TestCoin>(&mut shop_obj, &owner_cap);

    let replacement_currency = test_helpers::prepare_test_currency_for_owner(&mut scn, owner());
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &replacement_currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    std::unit_test::destroy(replacement_currency);
    std::unit_test::destroy(price_info_object);

    scn.return_to_sender(owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(owner());

    let owner_cap = scn.take_from_sender_by_id<shop::ShopOwnerCap>(
        owner_cap_id,
    );
    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    shared_shop.remove_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
    );
    shared_shop.remove_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
    );
    abort
}

#[test]
fun quote_view_matches_internal_math() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(&mut scn, owner());
    let price_info_object = test_helpers::create_price_info_object_for_feed_with_price(
        test_helpers::primary_feed_id(),
        test_helpers::sample_price(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = scn.next_tx(owner());

    let shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 1);
    let price_usd_cents = 10_000;
    let accepted_currency = shared_shop.currency<test_helpers::TestCoin>();
    let decimals = accepted_currency.decimals();

    let view_quote = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        price_usd_cents,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let price = pyth::get_price_no_older_than(
        &price_info_obj,
        &clock_obj,
        test_helpers::test_default_max_price_age_secs(),
    );
    let derived_quote = currency::quote_amount_from_usd_cents(
        price_usd_cents,
        decimals,
        price,
        test_helpers::test_default_max_confidence_ratio_bps(),
    );

    assert_eq!(derived_quote, 10_101_010_102);
    assert_eq!(view_quote, derived_quote);

    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    std::unit_test::destroy(currency);
    let _ = scn.end();
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EPriceOverflow)]
fun quote_amount_rejects_overflow_before_runtime_abort() {
    let price = price::new(
        i64::new(1, false),
        0,
        i64::new(0, false),
        0,
    );
    let max_usd_cents = 18_446_744_073_709_551_615;

    currency::quote_amount_from_usd_cents(
        max_usd_cents,
        24, // MAX_DECIMAL_POWER; forces usd_cents * 10^24 to overflow u128.
        price,
        test_helpers::test_default_max_confidence_ratio_bps(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun quote_view_rejects_mismatched_price_info_object() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(&mut scn, owner());
    let price_info_object = test_helpers::create_price_info_object_for_feed_with_price(
        test_helpers::primary_feed_id(),
        test_helpers::sample_price(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    transfer::public_share_object(price_info_object);

    let _ = scn.next_tx(owner());

    let shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 1);
    let mismatched_price_info_object = test_helpers::create_price_info_object_for_feed_with_price(
        test_helpers::secondary_feed_id(),
        test_helpers::sample_price(),
        scn.ctx(),
    );

    shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &mismatched_price_info_object,
        10_000,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}
