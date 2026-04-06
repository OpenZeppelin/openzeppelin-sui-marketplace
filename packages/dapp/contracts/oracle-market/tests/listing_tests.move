#[test_only]
module sui_oracle_market::listing_tests;

use std::unit_test::assert_eq;
use sui::event;
use sui_oracle_market::events;
use sui_oracle_market::shop;
use sui_oracle_market::test_helpers::{Self, assert_emitted, owner, second_owner};

// === Tests ===

#[test]
fun add_item_listing_stores_metadata() {
    let mut ctx: tx_context::TxContext = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let ids_before = tx_context::get_ids_created(&ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
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
    let name = listing.name();
    let base_price_usd_cents = listing.base_price_usd_cents();
    let stock = listing.stock();
    let spotlight_discount_id = listing.spotlight_discount_id();

    assert_eq!(name, b"Cool Bike".to_string());
    assert_eq!(base_price_usd_cents, 125_00);
    assert_eq!(stock, 25);
    assert!(option::is_none(&spotlight_discount_id));
    assert_emitted!(
        events::item_listing_added(
            shop.id(),
            listing_id,
        ),
    );

    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun add_item_listing_links_spotlight_discount() {
    let mut ctx = tx_context::new_from_hint(owner(), 44, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let discount_id = test_helpers::create_discount(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Limited Tire Set".to_string(),
        200_00,
        8,
        option::some(discount_id),
        &mut ctx,
    );
    let listing = shop.listing(listing_id);
    let spotlight_discount_id = listing.spotlight_discount_id();

    assert!(option::is_some(&spotlight_discount_id));
    spotlight_discount_id.do_ref!(|value| {
        assert_eq!(*value, discount_id);
    });
    assert_emitted!(
        events::item_listing_added(
            shop.id(),
            listing_id,
        ),
    );

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun add_item_listing_with_discount_creates_listing_and_pinned_discount() {
    let mut ctx = tx_context::new_from_hint(owner(), 404, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let ids_before = tx_context::get_ids_created(&ctx);

    let (listing_id, discount_id) = shop.add_item_listing_with_discount<test_helpers::TestItem>(
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
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before + 2);
    assert!(listing_id != discount_id);
    assert_eq!(tx_context::last_created_object_id(&ctx).to_id(), discount_id);

    assert!(shop.listing_exists(listing_id));
    assert!(shop.discount_exists(discount_id));
    test_helpers::assert_listing_spotlight_discount_id(&shop, listing_id, discount_id);
    test_helpers::assert_listing_scoped_percent_discount(
        &shop,
        discount_id,
        listing_id,
        1_500,
        0,
        20,
    );
    let shop_id = shop.id();
    assert_emitted!(events::item_listing_added(shop_id, listing_id));
    assert_emitted!(
        events::discount_created(
            shop_id,
            discount_id,
        ),
    );

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_item_listing_with_discount_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);

    shop.add_item_listing_with_discount<test_helpers::TestItem>(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::listing::EEmptyItemName)]
fun add_item_listing_rejects_empty_name() {
    let mut ctx = tx_context::new_from_hint(owner(), 45, 0, 0, 0);
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.add_item_listing<test_helpers::TestItem>(
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
    let (mut shop, _owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);

    shop.add_item_listing<test_helpers::TestItem>(
        &other_cap,
        b"Wrong Owner Cap".to_string(),
        15_00,
        3,
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::listing::EInvalidPrice)]
fun add_item_listing_rejects_zero_price() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Zero Price".to_string(),
        0,
        10,
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::listing::EZeroStock)]
fun add_item_listing_rejects_zero_stock() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"No Stock".to_string(),
        10_00,
        0,
        option::none(),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun add_item_listing_rejects_foreign_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let foreign_discount_id = test_helpers::create_discount(
        &mut other_shop,
        &other_cap,
        &mut ctx,
    );

    shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Bad Discount".to_string(),
        15_00,
        5,
        option::some(foreign_discount_id),
        &mut ctx,
    );

    abort
}

#[test]
fun update_item_listing_stock_updates_listing_and_emits_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
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
    let name = listing.name();
    let base_price_usd_cents = listing.base_price_usd_cents();
    let stock = listing.stock();
    let spotlight_discount = listing.spotlight_discount_id();
    assert_eq!(name, b"Helmet".to_string());
    assert_eq!(base_price_usd_cents, 48_00);
    assert!(option::is_none(&spotlight_discount));
    assert_eq!(stock, 11);

    assert_emitted!(events::item_listing_stock_updated(shop.id(), listing_id, 4));

    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_item_listing_stock_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_foreign_shop, foreign_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
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
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<test_helpers::TestItem>(
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
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Pads".to_string(),
        22_00,
        5,
        option::none(),
        &mut ctx,
    );

    let expected_stock_updated_event = events::item_listing_stock_updated(
        shop.id(),
        listing_id,
        5,
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
    let stock = listing.stock();
    assert_eq!(stock, 3);

    assert_emitted!(
        events::item_listing_stock_updated(
            shop.id(),
            listing_id,
            8,
        ),
    );
    assert_eq!(event::events_by_type<events::ItemListingStockUpdated>().length(), 2);

    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun remove_item_listing_removes_listing_and_emits_event() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let removed_listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Chain Grease".to_string(),
        12_00,
        3,
        option::none(),
        &mut ctx,
    );

    let remaining_listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Repair Kit".to_string(),
        42_00,
        2,
        option::none(),
        &mut ctx,
    );
    let shop_address = shop.id();

    shop.remove_item_listing(
        &owner_cap,
        removed_listing_id,
    );

    assert_emitted!(events::item_listing_removed(shop_address, removed_listing_id));

    assert!(!shop.listing_exists(removed_listing_id));
    assert!(shop.listing_exists(remaining_listing_id));

    let listing = shop.listing(remaining_listing_id);
    let name = listing.name();
    let price = listing.base_price_usd_cents();
    let stock = listing.stock();
    let spotlight = listing.spotlight_discount_id();
    assert_eq!(name, b"Repair Kit".to_string());
    assert_eq!(price, 42_00);
    assert_eq!(stock, 2);
    assert_eq!(spotlight, option::none());

    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, remaining_listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_foreign_shop, foreign_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
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
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<test_helpers::TestItem>(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingHasActiveDiscounts)]
fun remove_item_listing_rejects_listing_with_active_bound_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Discount Locked Listing".to_string(),
        45_00,
        2,
        option::none(),
        &mut ctx,
    );
    let _discount_id = shop.create_discount(
        &owner_cap,
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
fun remove_item_listing_allows_listing_with_inactive_bound_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Discount Paused Listing".to_string(),
        45_00,
        2,
        option::none(),
        &mut ctx,
    );
    let discount_id = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop.toggle_discount(
        &owner_cap,
        discount_id,
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
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
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

    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}
