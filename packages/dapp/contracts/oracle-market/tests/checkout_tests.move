#[test_only]
module sui_oracle_market::checkout_tests;

use pyth::i64;
use pyth::price;
use pyth::price_info;
use std::unit_test::assert_eq;
use sui::coin;
use sui::test_scenario;
use sui_oracle_market::currency;
use sui_oracle_market::events;
use sui_oracle_market::shop;
use sui_oracle_market::test_helpers::{
    Self,
    assert_emitted,
    owner,
    second_owner,
    third_owner,
    settle_purchase_outputs
};

// === Tests ===

#[test]
fun discount_redemption_without_listing_restriction_allows_zero_price() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
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

    let listing_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Freebie".to_string(),
        100,
        1,
        option::none(),
        scn.ctx(),
    );

    shop_obj.create_discount(
        &owner_cap,
        option::none(),
        0,
        1_000,
        0,
        option::none(),
        option::none(),
        scn.ctx(),
    );
    let discount_id = tx_context::last_created_object_id(scn.ctx()).to_id();

    transfer::public_share_object(price_info_object);

    scn.return_to_sender(owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);

    let payment = coin::mint_for_testing<test_helpers::TestCoin>(1, scn.ctx());
    let (minted_item, change_coin) = shared_shop.buy_item_with_discount<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        discount_id,
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), second_owner());
    let minted_item_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    assert_emitted!(
        events::purchase_completed(
            shop_id,
            listing_id,
            price_info_id,
            option::some(discount_id),
            minted_item_id,
            0,
            0,
        ),
    );

    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);
    let _ = scn.end();
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EDiscountListingMismatch)]
fun discount_redemption_rejects_listing_mismatch() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
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

    let listing_a_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Listing A".to_string(),
        100,
        1,
        option::none(),
        scn.ctx(),
    );
    let listing_b_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Listing B".to_string(),
        100,
        1,
        option::none(),
        scn.ctx(),
    );

    shop_obj.create_discount(
        &owner_cap,
        option::some(listing_a_id),
        1,
        100,
        0,
        option::none(),
        option::none(),
        scn.ctx(),
    );
    let discount_id = tx_context::last_created_object_id(scn.ctx()).to_id();

    transfer::public_share_object(price_info_object);

    scn.return_to_sender(owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);
    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );

    let (_minted_item, _change_coin) = shared_shop.buy_item_with_discount<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        discount_id,
        &price_info_obj,
        payment,
        listing_b_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EDiscountMaxedOut)]
fun discount_maxed_out_by_redemption() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
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

    let listing_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Promo".to_string(),
        100,
        2,
        option::none(),
        scn.ctx(),
    );

    shop_obj.create_discount(
        &owner_cap,
        option::some(listing_id),
        1,
        100,
        0,
        option::none(),
        option::some(1),
        scn.ctx(),
    );
    let discount_id = tx_context::last_created_object_id(scn.ctx()).to_id();

    transfer::public_share_object(price_info_object);

    scn.return_to_sender(owner_cap);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);
    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );

    let (minted_item, change_coin) = shared_shop.buy_item_with_discount<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        discount_id,
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), second_owner());

    let payment_again = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );
    let (_minted_item, _change_coin) = shared_shop.buy_item_with_discount<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        discount_id,
        &price_info_obj,
        payment_again,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun checkout_rejects_price_info_object_from_other_shop() {
    let mut scn = test_scenario::begin(owner());
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

    let _ = scn.next_tx(second_owner());

    let mut shared_shop_b = scn.take_shared_by_id<shop::Shop>(shop_b_id);
    let price_info_a: price_info::PriceInfoObject = scn.take_shared_by_id(
        price_info_a_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(1, scn.ctx());

    let (_minted_item, _change_coin) = shared_shop_b.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info_a,
        payment,
        listing_b_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun checkout_rejects_listing_not_registered_in_shop() {
    let mut scn = test_scenario::begin(owner());
    let (
        shop_id,
        _currency_id,
        _listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 1);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info: price_info::PriceInfoObject = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(1, scn.ctx());

    let (_minted_item, _change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info,
        payment,
        test_helpers::missing_listing_id(),
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun checkout_rejects_currency_from_other_shop() {
    let mut scn = test_scenario::begin(owner());
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

    let _ = scn.next_tx(second_owner());

    let mut shared_shop_a = scn.take_shared_by_id<shop::Shop>(shop_a_id);
    let price_info_b: price_info::PriceInfoObject = scn.take_shared_by_id(
        price_info_b_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(1, scn.ctx());

    let (_minted_item, _change_coin) = shared_shop_a.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info_b,
        payment,
        listing_a_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun accepted_currency_rejects_foreign_shop() {
    let mut scn = test_scenario::begin(owner());

    let (shop_a_id, owner_cap_a_id) = test_helpers::create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        test_helpers::default_shop_name(),
    );

    let (shop_b_id, _) = test_helpers::create_shop_and_owner_cap_ids_for_sender(
        &mut scn,
        test_helpers::default_shop_name(),
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_a_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_a_id,
    );
    test_helpers::add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        test_helpers::primary_feed_id(),
        option::none(),
        option::none(),
    );

    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    std::unit_test::destroy(currency);

    let _ = scn.next_tx(owner());

    let shared_shop_b = scn.take_shared_by_id<shop::Shop>(shop_b_id);

    shared_shop_b.currency<test_helpers::TestCoin>();
    abort
}

#[test]
fun remove_currency_field_clears_mapping() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    test_helpers::add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        test_helpers::primary_feed_id(),
        option::none(),
        option::none(),
    );

    test_helpers::remove_currency_if_exists<test_helpers::TestCoin>(&mut shop_obj, &owner_cap_obj);
    assert!(!shop_obj.currency_exists(test_helpers::test_coin_type()));

    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);
    std::unit_test::destroy(currency);
    let _ = scn.end();
}

#[test]
fun remove_accepted_currency_emits_removed_event_fields() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    let pyth_object_id = test_helpers::add_test_coin_accepted_currency_for_scenario(
        &mut scn,
        &mut shop_obj,
        &owner_cap_obj,
        &currency,
        test_helpers::primary_feed_id(),
        option::none(),
        option::none(),
    );

    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap = scn.take_from_sender_by_id(
        owner_cap_id,
    );
    shared_shop.remove_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
    );

    assert_emitted!(
        events::accepted_coin_removed(
            shared_shop.id(),
            pyth_object_id,
        ),
    );

    test_scenario::return_shared(shared_shop);
    scn.return_to_sender(owner_cap);
    std::unit_test::destroy(currency);
    let _ = scn.end();
}

fun setup_shop_with_currency_listing_and_price_info(
    scn: &mut test_scenario::Scenario,
    base_price_usd_cents: u64,
    stock: u64,
): (ID, ID, ID, ID) {
    setup_shop_with_currency_listing_and_price_info_for_item<test_helpers::TestItem>(
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

fun setup_shop_with_currency_listing_and_price_info_for_item<TItem: store>(
    scn: &mut test_scenario::Scenario,
    item_name: vector<u8>,
    base_price_usd_cents: u64,
    stock: u64,
): (ID, ID, ID, ID) {
    let currency = test_helpers::prepare_test_currency_for_owner(scn, owner());

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        owner(),
        scn.ctx(),
    );
    let shop_id = object::id(&shop_obj);
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();

    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        price_info_id,
        option::none(),
        option::none(),
    );
    let pyth_object_id = price_info_id;
    std::unit_test::destroy(currency);

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

#[test]
fun buy_item_emits_events_decrements_stock_and_refunds_change() {
    let mut scn = test_scenario::begin(owner());
    let (
        shop_id,
        pyth_object_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 2);

    let (mut shared_shop, price_info_obj, clock_obj) = test_helpers::begin_buyer_checkout_context(
        &mut scn,
        second_owner(),
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let extra = 7;
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount + extra,
        scn.ctx(),
    );

    let (minted_item, change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), second_owner());

    let minted_item_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.id(),
            listing_id,
            pyth_object_id,
            option::none(),
            minted_item_id,
            quote_amount,
            100,
        ),
    );

    assert_emitted!(
        events::item_listing_stock_updated(
            shared_shop.id(),
            listing_id,
            2,
        ),
    );

    test_helpers::close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = scn.end();
}

#[test]
fun buy_item_supports_example_car_receipts() {
    let mut scn = test_scenario::begin(owner());
    let (
        shop_id,
        pyth_object_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info_for_item<test_helpers::Car>(
        &mut scn,
        b"Car Listing",
        175_00,
        2,
    );

    let (mut shared_shop, price_info_obj, clock_obj) = test_helpers::begin_buyer_checkout_context(
        &mut scn,
        second_owner(),
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        175_00,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );

    let (minted_item, change_coin) = shared_shop.buy_item<
        test_helpers::Car,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), second_owner());

    let minted_item_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.id(),
            listing_id,
            pyth_object_id,
            option::none(),
            minted_item_id,
            quote_amount,
            175_00,
        ),
    );

    test_helpers::close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = scn.end();
}

#[test]
fun buy_item_supports_example_bike_receipts() {
    let mut scn = test_scenario::begin(owner());
    let (
        shop_id,
        pyth_object_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info_for_item<test_helpers::Bike>(
        &mut scn,
        b"Bike Listing",
        95_00,
        1,
    );

    let (mut shared_shop, price_info_obj, clock_obj) = test_helpers::begin_buyer_checkout_context(
        &mut scn,
        second_owner(),
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        95_00,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );

    let (minted_item, change_coin) = shared_shop.buy_item<
        test_helpers::Bike,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), second_owner());

    let minted_item_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.id(),
            listing_id,
            pyth_object_id,
            option::none(),
            minted_item_id,
            quote_amount,
            95_00,
        ),
    );

    test_helpers::close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = scn.end();
}

#[test]
fun buy_item_emits_events_with_exact_payment_and_zero_change() {
    let mut scn = test_scenario::begin(owner());
    let (
        shop_id,
        pyth_object_id,
        listing_id,
        price_info_id,
    ) = setup_shop_with_currency_listing_and_price_info(&mut scn, 100, 2);

    let (mut shared_shop, price_info_obj, clock_obj) = test_helpers::begin_buyer_checkout_context(
        &mut scn,
        second_owner(),
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );

    let (minted_item, change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), third_owner());

    let minted_item_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.id(),
            listing_id,
            pyth_object_id,
            option::none(),
            minted_item_id,
            quote_amount,
            100,
        ),
    );

    test_helpers::close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = scn.end();
}

#[test, expected_failure(abort_code = ::sui_oracle_market::listing::EOutOfStock)]
fun buy_item_rejects_out_of_stock_after_depletion() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        100,
        1,
    );

    let (mut shared_shop, price_info_obj, clock_obj) = test_helpers::begin_buyer_checkout_context(
        &mut scn,
        second_owner(),
        shop_id,
        price_info_id,
        10,
    );

    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );
    let (minted_item, change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), second_owner());

    test_scenario::return_shared(shared_shop);
    test_scenario::return_shared(price_info_obj);
    std::unit_test::destroy(clock_obj);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );

    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 11);
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );

    let (_minted_item, _change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EPythObjectMismatch)]
fun buy_item_rejects_price_info_object_id_mismatch() {
    let mut scn = test_scenario::begin(owner());
    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );

    let (mut shop_obj, owner_cap) = shop::test_setup_shop(
        owner(),
        scn.ctx(),
    );
    let shop_id = object::id(&shop_obj);
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let price_info_id = price_info_object.uid_to_inner();
    let other_price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let other_price_info_id = other_price_info_object.uid_to_inner();

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

    let listing_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Mismatch Item".to_string(),
        100,
        1,
        option::none(),
        scn.ctx(),
    );

    transfer::public_share_object(price_info_object);
    transfer::public_share_object(other_price_info_object);
    transfer::public_share_object(shop_obj);
    transfer::public_transfer(owner_cap, @0x0);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let other_price_info_obj = scn.take_shared_by_id(
        other_price_info_id,
    );

    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(1, scn.ctx());

    let (_minted_item, _change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &other_price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test]
fun buy_item_with_discount_emits_discount_redeemed_and_records_discount_id() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
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
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap_obj,
        b"Discounted Item".to_string(),
        1_000,
        2,
        option::none(),
        scn.ctx(),
    );

    shop_obj.create_discount(
        &owner_cap_obj,
        option::some(listing_id),
        0,
        250,
        0,
        option::none(),
        option::some(10),
        scn.ctx(),
    );
    let discount_id = tx_context::last_created_object_id(scn.ctx()).to_id();

    transfer::public_share_object(price_info_object);
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );

    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);

    let discounted_price_usd_cents = 1_000 - 250;
    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        discounted_price_usd_cents,
        option::none(),
        option::none(),
        &clock_obj,
    );

    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );
    let (minted_item, change_coin) = shared_shop.buy_item_with_discount<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        discount_id,
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );
    settle_purchase_outputs(minted_item, change_coin, second_owner(), second_owner());

    let minted_item_id = tx_context::last_created_object_id(scn.ctx()).to_id();
    assert_emitted!(
        events::purchase_completed(
            shared_shop.id(),
            listing_id,
            price_info_id,
            option::some(discount_id),
            minted_item_id,
            quote_amount,
            discounted_price_usd_cents,
        ),
    );

    assert_emitted!(
        events::discount_redeemed(
            shared_shop.id(),
            discount_id,
        ),
    );

    let discount = shared_shop.discount(discount_id);
    let redemptions = discount.redemptions();
    assert_eq!(redemptions, 1);

    test_helpers::close_buyer_checkout_context(shared_shop, price_info_obj, clock_obj);
    let _ = scn.end();
}

#[test, expected_failure(abort_code = ::sui::balance::ENotEnough)]
fun buy_item_rejects_insufficient_payment() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        10_000,
        2,
    );

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );

    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);

    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        10_000,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount - 1,
        scn.ctx(),
    );

    let (_minted_item, _change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EAcceptedCurrencyMissing)]
fun buy_item_rejects_wrong_coin_type() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        100,
        1,
    );

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);

    let payment = coin::mint_for_testing<test_helpers::AltTestCoin>(
        1,
        scn.ctx(),
    );
    let (_minted_item, _change_coin) = shared_shop.buy_item<
        test_helpers::TestItem,
        test_helpers::AltTestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::listing::EItemTypeMismatch)]
fun buy_item_rejects_item_type_mismatch() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, listing_id, price_info_id) = setup_shop_with_listing_and_price_info(
        &mut scn,
        100,
        1,
    );

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);

    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );
    let (_minted_item, _change_coin) = shared_shop.buy_item<
        test_helpers::OtherItem,
        test_helpers::TestCoin,
    >(
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EInvalidGuardrailCap)]
fun buy_item_rejects_guardrail_override_above_cap() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
        scn.ctx(),
    );
    let pyth_object_id = price_info_object.uid_to_inner();

    let mut shop_obj = scn.take_shared_by_id<shop::Shop>(shop_id);
    let owner_cap_obj = scn.take_from_sender_by_id(
        owner_cap_id,
    );

    // Seller caps must be non-zero; zero should abort with EInvalidGuardrailCap.
    shop_obj.add_accepted_currency<test_helpers::TestCoin>(
        &owner_cap_obj,
        &currency,
        &price_info_object,
        test_helpers::primary_feed_id(),
        pyth_object_id,
        option::some(0),
        option::some(0),
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EPriceNonPositive)]
fun quote_amount_from_usd_cents_rejects_negative_price() {
    let price_value = i64::new(1, true);
    let expo = i64::new(0, false);
    let price = price::new(price_value, 0, expo, 0);
    let _ = currency::quote_amount_from_usd_cents(
        100,
        9,
        price,
        test_helpers::test_default_max_confidence_ratio_bps(),
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EDiscountInactive)]
fun buy_item_with_discount_rejects_inactive_discount() {
    let mut scn = test_scenario::begin(owner());
    let (shop_id, owner_cap_id) = test_helpers::create_default_shop_and_owner_cap_ids_for_sender(
        &mut scn,
    );

    let currency = test_helpers::prepare_test_currency_for_owner(
        &mut scn,
        owner(),
    );
    let price_info_object = test_helpers::create_price_info_object_for_feed(
        test_helpers::primary_feed_id(),
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
    std::unit_test::destroy(currency);

    let listing_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap_obj,
        b"Inactive Discount Item".to_string(),
        100,
        1,
        option::none(),
        scn.ctx(),
    );

    shop_obj.create_discount(
        &owner_cap_obj,
        option::some(listing_id),
        0,
        25,
        0,
        option::none(),
        option::none(),
        scn.ctx(),
    );
    let discount_id = tx_context::last_created_object_id(scn.ctx()).to_id();

    transfer::public_share_object(price_info_object);
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shop_obj);

    let _ = scn.next_tx(second_owner());
    let _ = scn.next_tx(owner());

    let owner_cap_obj = scn.take_from_sender_by_id<shop::ShopOwnerCap>(
        owner_cap_id,
    );
    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    shared_shop.toggle_discount(
        &owner_cap_obj,
        discount_id,
        false,
    );
    scn.return_to_sender(owner_cap_obj);
    test_scenario::return_shared(shared_shop);

    let _ = scn.next_tx(second_owner());

    let mut shared_shop = scn.take_shared_by_id<shop::Shop>(shop_id);
    let price_info_obj = scn.take_shared_by_id(
        price_info_id,
    );
    let clock_obj = test_helpers::create_test_clock_at(scn.ctx(), 10);
    let quote_amount = shared_shop.quote_amount_for_price_info_object<test_helpers::TestCoin>(
        &price_info_obj,
        100,
        option::none(),
        option::none(),
        &clock_obj,
    );
    let payment = coin::mint_for_testing<test_helpers::TestCoin>(
        quote_amount,
        scn.ctx(),
    );

    let (_minted_item, _change_coin) = shared_shop.buy_item_with_discount<
        test_helpers::TestItem,
        test_helpers::TestCoin,
    >(
        discount_id,
        &price_info_obj,
        payment,
        listing_id,
        option::none(),
        option::none(),
        &clock_obj,
        scn.ctx(),
    );

    abort
}
#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EConfidenceExceedsPrice)]
fun quote_amount_from_usd_cents_rejects_confidence_exceeds_price() {
    let price_value = i64::new(10, false);
    let expo = i64::new(0, false);
    let price = price::new(price_value, 10, expo, 0);
    let _ = currency::quote_amount_from_usd_cents(
        100,
        9,
        price,
        test_helpers::test_default_max_confidence_ratio_bps(),
    );
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EConfidenceIntervalTooWide)]
fun quote_amount_from_usd_cents_rejects_confidence_interval_too_wide() {
    let price_value = i64::new(100, false);
    let expo = i64::new(0, false);
    let price = price::new(price_value, 50, expo, 0);
    let _ = currency::quote_amount_from_usd_cents(
        100,
        9,
        price,
        test_helpers::test_default_max_confidence_ratio_bps(),
    );
    abort
}
