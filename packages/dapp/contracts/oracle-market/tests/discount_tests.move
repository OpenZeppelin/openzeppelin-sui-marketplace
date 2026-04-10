#[test_only]
module sui_oracle_market::discount_tests;

use pyth::i64;
use pyth::price;
use std::unit_test::assert_eq;
use sui::clock;
use sui::event;
use sui_oracle_market::currency;
use sui_oracle_market::events;
use sui_oracle_market::shop;
use sui_oracle_market::test_helpers::{Self, assert_emitted, owner, second_owner};

// === Tests ===

#[test]
fun create_discount_persists_fields_and_emits_event() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        1_250,
        10,
        option::some(50),
        option::some(5),
        &mut ctx,
    );
    assert!(shop.discount_exists(discount_id));

    let discount = shop.discount(discount_id);
    let applies_to_listing = discount.applies_to_listing();
    let rule = discount.rule();
    let starts_at = discount.starts_at();
    let expires_at = discount.expires_at();
    let max_redemptions = discount.max_redemptions();
    let redemptions = discount.redemptions();
    let active = discount.active();

    assert!(option::is_none(&applies_to_listing));
    let rule_kind = rule.kind();
    let rule_value = rule.value();
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
    assert_eq!(redemptions, 0);
    assert!(active);

    assert_emitted!(events::discount_created(shop.id(), discount_id));

    shop.remove_discount(&owner_cap, discount_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun create_discount_links_listing_and_percent_rule() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Wheelset".to_string(),
        600_00,
        4,
        option::none(),
        &mut ctx,
    );

    let discount_id = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        1,
        2_500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    assert!(shop.discount_exists(discount_id));
    let discount = shop.discount(discount_id);
    let applies_to_listing = discount.applies_to_listing();
    let rule = discount.rule();
    let starts_at = discount.starts_at();
    let expires_at = discount.expires_at();
    let max_redemptions = discount.max_redemptions();
    let redemptions = discount.redemptions();
    let active = discount.active();

    assert!(option::is_some(&applies_to_listing));
    applies_to_listing.do_ref!(|value| {
        assert_eq!(*value, listing_id);
    });
    let rule_kind = rule.kind();
    let rule_value = rule.value();
    assert_eq!(rule_kind, 1);
    assert_eq!(rule_value, 2_500);
    assert_eq!(starts_at, 0);
    assert!(option::is_none(&expires_at));
    assert!(option::is_none(&max_redemptions));
    assert_eq!(redemptions, 0);
    assert!(active);

    assert_emitted!(events::discount_created(shop.id(), discount_id));

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun create_discount_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);

    shop.create_discount(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EInvalidRuleKind)]
fun create_discount_rejects_invalid_rule_kind() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.create_discount(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EInvalidRuleValue)]
fun create_discount_rejects_percent_above_limit() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.create_discount(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EDiscountWindow)]
fun create_discount_rejects_invalid_schedule() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.create_discount(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EInvalidMaxRedemptions)]
fun create_discount_rejects_zero_max_redemptions() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        1_000,
        10,
        option::some(20),
        option::some(0),
        &mut ctx,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun create_discount_rejects_foreign_listing_reference() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<test_helpers::TestItem>(
        &other_cap,
        b"Foreign Listing".to_string(),
        7_500,
        2,
        option::none(),
        &mut ctx,
    );

    shop.create_discount(
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
fun update_discount_updates_fields_and_emits_event() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Wheelset".to_string(),
        600_00,
        4,
        option::none(),
        &mut ctx,
    );

    let discount_id = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        1_000,
        10,
        option::some(20),
        option::some(2),
        &mut ctx,
    );

    let clock_obj = test_helpers::create_test_clock_at(&mut ctx, 1);
    shop.update_discount(
        &owner_cap,
        discount_id,
        1,
        750,
        50,
        option::some(200),
        option::some(10),
        &clock_obj,
    );
    std::unit_test::destroy(clock_obj);

    let discount = shop.discount(discount_id);
    let applies_to_listing = discount.applies_to_listing();
    let rule = discount.rule();
    let starts_at = discount.starts_at();
    let expires_at = discount.expires_at();
    let max_redemptions = discount.max_redemptions();
    let redemptions = discount.redemptions();
    let active = discount.active();
    assert!(option::is_some(&applies_to_listing));
    applies_to_listing.do_ref!(|value| {
        assert_eq!(*value, listing_id);
    });
    let rule_kind = rule.kind();
    let rule_value = rule.value();
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
    assert_eq!(redemptions, 0);
    assert!(active);

    assert_emitted!(events::discount_updated(shop.id(), discount_id));

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun update_discount_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, shop_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &shop_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount(
        &other_cap,
        discount_id,
        0,
        250,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun update_discount_rejects_foreign_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );
    let foreign_discount = other_shop.create_discount(
        &other_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount(
        &owner_cap,
        foreign_discount,
        0,
        250,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EDiscountWindow)]
fun update_discount_rejects_invalid_schedule() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount(
        &owner_cap,
        discount_id,
        0,
        1_000,
        100,
        option::some(50),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EInvalidMaxRedemptions)]
fun update_discount_rejects_zero_max_redemptions() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount(
        &owner_cap,
        discount_id,
        0,
        1_000,
        0,
        option::none(),
        option::some(0),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EInvalidRuleKind)]
fun update_discount_rejects_invalid_rule_kind() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount(
        &owner_cap,
        discount_id,
        2,
        1_000,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EInvalidRuleValue)]
fun update_discount_rejects_percent_above_limit() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    let clock_obj = clock::create_for_testing(&mut ctx);
    shop.update_discount(
        &owner_cap,
        discount_id,
        1,
        10_001,
        0,
        option::none(),
        option::none(),
        &clock_obj,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::discount::EDiscountFinalized)]
fun update_discount_rejects_after_expiry() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::some(100),
        option::some(5),
        &mut ctx,
    );
    let clock_obj = test_helpers::create_test_clock_at(&mut ctx, 200_000);

    shop.update_discount(
        &owner_cap,
        discount_id,
        1,
        250,
        0,
        option::some(500),
        option::some(10),
        &clock_obj,
    );

    abort
}

#[test]
fun toggle_discount_updates_active_and_emits_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        2_000,
        25,
        option::some(50),
        option::some(3),
        &mut ctx,
    );

    let discount = shop.discount(discount_id);
    let applies_to_listing = discount.applies_to_listing();
    let rule = discount.rule();
    let starts_at = discount.starts_at();
    let expires_at = discount.expires_at();
    let max_redemptions = discount.max_redemptions();
    let redemptions = discount.redemptions();
    let active = discount.active();

    assert!(active);
    shop.toggle_discount(
        &owner_cap,
        discount_id,
        false,
    );

    let discount_values_after_first = shop.discount(discount_id);
    let applies_to_listing_after_first = discount_values_after_first.applies_to_listing();
    let rule_after_first = discount_values_after_first.rule();
    let starts_at_after_first = discount_values_after_first.starts_at();
    let expires_at_after_first = discount_values_after_first.expires_at();
    let max_redemptions_after_first = discount_values_after_first.max_redemptions();
    let redemptions_after_first = discount_values_after_first.redemptions();
    let active_after_first = discount_values_after_first.active();

    assert_eq!(applies_to_listing_after_first, applies_to_listing);
    let rule_kind = rule.kind();
    let rule_value = rule.value();
    let rule_after_first_kind = rule_after_first.kind();
    let rule_after_first_value = rule_after_first.value();
    assert_eq!(rule_after_first_kind, rule_kind);
    assert_eq!(rule_after_first_value, rule_value);
    assert_eq!(starts_at_after_first, starts_at);
    assert_eq!(expires_at_after_first, expires_at);
    assert_eq!(max_redemptions_after_first, max_redemptions);
    assert_eq!(redemptions_after_first, redemptions);
    assert!(!active_after_first);

    shop.toggle_discount(
        &owner_cap,
        discount_id,
        true,
    );

    let discount_values_after_second = shop.discount(discount_id);
    let applies_to_listing_after_second = discount_values_after_second.applies_to_listing();
    let rule_after_second = discount_values_after_second.rule();
    let starts_at_after_second = discount_values_after_second.starts_at();
    let expires_at_after_second = discount_values_after_second.expires_at();
    let max_redemptions_after_second = discount_values_after_second.max_redemptions();
    let redemptions_after_second = discount_values_after_second.redemptions();
    let active_after_second = discount_values_after_second.active();
    assert_eq!(applies_to_listing_after_second, applies_to_listing);
    let rule_after_second_kind = rule_after_second.kind();
    let rule_after_second_value = rule_after_second.value();
    assert_eq!(rule_after_second_kind, rule_kind);
    assert_eq!(rule_after_second_value, rule_value);
    assert_eq!(starts_at_after_second, starts_at);
    assert_eq!(expires_at_after_second, expires_at);
    assert_eq!(max_redemptions_after_second, max_redemptions);
    assert_eq!(redemptions_after_second, redemptions);
    assert!(active_after_second);

    assert_emitted!(events::discount_toggled(shop.id(), discount_id, false));
    assert_emitted!(events::discount_toggled(shop.id(), discount_id, true));

    shop.remove_discount(&owner_cap, discount_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_discount_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);
    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.toggle_discount(
        &other_cap,
        discount_id,
        false,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun toggle_discount_rejects_foreign_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );
    let foreign_discount = other_shop.create_discount(
        &other_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.toggle_discount(
        &owner_cap,
        foreign_discount,
        false,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun toggle_discount_rejects_unknown_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let stray_discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.remove_discount(&owner_cap, stray_discount_id);

    shop.toggle_discount(
        &owner_cap,
        stray_discount_id,
        false,
    );

    abort
}

#[test]
fun toggle_discount_on_listing_sets_and_clears_spotlight() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Promo Jacket".to_string(),
        180_00,
        6,
        option::none(),
        &mut ctx,
    );
    let discount_id = shop.create_discount(
        &owner_cap,
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
    let spotlight_before = listing_before.spotlight_discount_id();
    assert!(option::is_none(&spotlight_before));
    assert_eq!(event::events_by_type<events::DiscountToggled>().length(), 0);

    shop.attach_spotlight_discount(
        &owner_cap,
        discount_id,
        listing_id,
    );

    let listing_after_set = shop.listing(listing_id);
    let spotlight_after_set = listing_after_set.spotlight_discount_id();
    assert!(option::is_some(&spotlight_after_set));
    spotlight_after_set.do_ref!(|value| {
        assert_eq!(*value, discount_id);
    });
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before_toggle);
    assert_eq!(event::events_by_type<events::DiscountToggled>().length(), 0);

    shop.clear_spotlight_discount(
        &owner_cap,
        listing_id,
    );

    let listing_after_clear = shop.listing(listing_id);
    let spotlight_after_clear = listing_after_clear.spotlight_discount_id();
    assert!(option::is_none(&spotlight_after_clear));
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before_toggle);
    assert_eq!(event::events_by_type<events::DiscountToggled>().length(), 0);

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun toggle_discount_on_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Chain Lube".to_string(),
        12_00,
        30,
        option::none(),
        &mut ctx,
    );
    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.attach_spotlight_discount(
        &other_cap,
        discount_id,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun toggle_discount_on_listing_rejects_foreign_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<test_helpers::TestItem>(
        &other_cap,
        b"Spare Tube".to_string(),
        8_00,
        15,
        option::none(),
        &mut ctx,
    );
    let discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.attach_spotlight_discount(
        &owner_cap,
        discount_id,
        foreign_listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun toggle_discount_on_listing_rejects_foreign_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, _other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Bike Pump".to_string(),
        35_00,
        10,
        option::none(),
        &mut ctx,
    );
    let foreign_discount = other_shop.create_discount(
        &_other_cap,
        option::none(),
        0,
        500,
        0,
        option::none(),
        option::some(5),
        &mut ctx,
    );

    shop.attach_spotlight_discount(
        &owner_cap,
        foreign_discount,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun toggle_discount_on_listing_rejects_unknown_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Frame Protector".to_string(),
        22_00,
        40,
        option::none(),
        &mut ctx,
    );
    let stray_discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.remove_discount(&owner_cap, stray_discount_id);

    shop.attach_spotlight_discount(
        &owner_cap,
        stray_discount_id,
        listing_id,
    );

    abort
}

#[test]
fun attach_spotlight_discount_sets_spotlight_without_emitting_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Promo Bag".to_string(),
        95_00,
        12,
        option::none(),
        &mut ctx,
    );
    let discount_id = test_helpers::create_discount(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let ids_before = tx_context::get_ids_created(&ctx);

    shop.attach_spotlight_discount(
        &owner_cap,
        discount_id,
        listing_id,
    );

    let listing = shop.listing(listing_id);
    let spotlight = listing.spotlight_discount_id();
    assert!(option::is_some(&spotlight));
    spotlight.do_ref!(|value| {
        assert_eq!(*value, discount_id);
    });
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before);
    assert_eq!(event::events_by_type<events::DiscountToggled>().length(), 0);
    assert!(shop.discount_exists(discount_id));

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun attach_spotlight_discount_overwrites_existing_spotlight() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let first_discount = test_helpers::create_discount(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Bundle".to_string(),
        140_00,
        3,
        option::some(first_discount),
        &mut ctx,
    );
    let second_discount = test_helpers::create_discount(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    let ids_before = tx_context::get_ids_created(&ctx);

    let listing_before = shop.listing(listing_id);
    let spotlight_before = listing_before.spotlight_discount_id();
    assert!(option::is_some(&spotlight_before));
    spotlight_before.do_ref!(|value| {
        assert_eq!(*value, first_discount);
    });

    shop.attach_spotlight_discount(
        &owner_cap,
        second_discount,
        listing_id,
    );

    let listing_after = shop.listing(listing_id);
    let spotlight_after = listing_after.spotlight_discount_id();
    assert!(option::is_some(&spotlight_after));
    spotlight_after.do_ref!(|value| {
        assert_eq!(*value, second_discount);
    });
    assert_eq!(tx_context::get_ids_created(&ctx), ids_before);
    assert!(shop.discount_exists(first_discount));
    assert!(shop.discount_exists(second_discount));
    assert_eq!(event::events_by_type<events::DiscountToggled>().length(), 0);

    shop.remove_discount(&owner_cap, second_discount);
    shop.remove_discount(&owner_cap, first_discount);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun attach_spotlight_discount_accepts_matching_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Bundle".to_string(),
        140_00,
        3,
        option::none(),
        &mut ctx,
    );
    let discount_id = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        50,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop.attach_spotlight_discount(
        &owner_cap,
        discount_id,
        listing_id,
    );

    let listing = shop.listing(listing_id);
    let spotlight = listing.spotlight_discount_id();
    assert!(option::is_some(&spotlight));
    spotlight.do_ref!(|value| {
        assert_eq!(*value, discount_id);
    });
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun attach_spotlight_discount_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Helmet Stickers".to_string(),
        9_00,
        10,
        option::none(),
        &mut ctx,
    );
    let discount_id = test_helpers::create_discount(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    shop.attach_spotlight_discount(
        &other_cap,
        discount_id,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun attach_spotlight_discount_rejects_foreign_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<test_helpers::TestItem>(
        &other_cap,
        b"Brake Pads".to_string(),
        18_00,
        4,
        option::none(),
        &mut ctx,
    );
    let discount_id = test_helpers::create_discount(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );

    shop.attach_spotlight_discount(
        &owner_cap,
        discount_id,
        foreign_listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun attach_spotlight_discount_rejects_foreign_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Chain Whip".to_string(),
        27_00,
        5,
        option::none(),
        &mut ctx,
    );
    let foreign_discount = test_helpers::create_discount(
        &mut other_shop,
        &other_cap,
        &mut ctx,
    );

    shop.attach_spotlight_discount(
        &owner_cap,
        foreign_discount,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun attach_spotlight_discount_rejects_unknown_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Pedals".to_string(),
        51_00,
        6,
        option::none(),
        &mut ctx,
    );
    let stray_discount_id = shop.create_discount(
        &owner_cap,
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.remove_discount(&owner_cap, stray_discount_id);

    shop.attach_spotlight_discount(
        &owner_cap,
        stray_discount_id,
        listing_id,
    );

    abort
}

#[test]
fun clear_spotlight_discount_removes_spotlight_without_side_effects() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Rain Jacket".to_string(),
        120_00,
        7,
        option::none(),
        &mut ctx,
    );
    let discount_id = test_helpers::create_discount(
        &mut shop,
        &owner_cap,
        &mut ctx,
    );
    shop.attach_spotlight_discount(
        &owner_cap,
        discount_id,
        listing_id,
    );

    let listing_before = shop.listing(listing_id);
    let spotlight_before = listing_before.spotlight_discount_id();
    let created_before = tx_context::get_ids_created(&ctx);
    assert!(option::is_some(&spotlight_before));
    spotlight_before.do_ref!(|value| {
        assert_eq!(*value, discount_id);
    });

    shop.clear_spotlight_discount(
        &owner_cap,
        listing_id,
    );

    let listing_after = shop.listing(listing_id);
    let spotlight_after = listing_after.spotlight_discount_id();
    assert!(option::is_none(&spotlight_after));
    assert_eq!(tx_context::get_ids_created(&ctx), created_before);
    assert_eq!(event::events_by_type<events::DiscountToggled>().length(), 0);
    assert!(shop.discount_exists(discount_id));

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun clear_spotlight_discount_is_noop_when_no_spotlight_set() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Bar Tape".to_string(),
        19_00,
        25,
        option::none(),
        &mut ctx,
    );
    let created_before = tx_context::get_ids_created(&ctx);

    shop.clear_spotlight_discount(
        &owner_cap,
        listing_id,
    );

    let listing_after = shop.listing(listing_id);
    let spotlight_after = listing_after.spotlight_discount_id();
    assert!(option::is_none(&spotlight_after));
    assert_eq!(tx_context::get_ids_created(&ctx), created_before);
    assert_eq!(event::events_by_type<events::DiscountToggled>().length(), 0);

    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun clear_spotlight_discount_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Valve Stem".to_string(),
        11_00,
        14,
        option::none(),
        &mut ctx,
    );

    shop.clear_spotlight_discount(
        &other_cap,
        listing_id,
    );

    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun clear_spotlight_discount_rejects_foreign_listing() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (mut other_shop, other_cap) = shop::test_setup_shop(
        second_owner(),
        &mut ctx,
    );

    let foreign_listing_id = other_shop.add_item_listing<test_helpers::TestItem>(
        &other_cap,
        b"Cassette".to_string(),
        85_00,
        9,
        option::none(),
        &mut ctx,
    );

    shop.clear_spotlight_discount(
        &owner_cap,
        foreign_listing_id,
    );

    abort
}

#[test]
fun test_init_claims_publisher() {
    let mut ctx = tx_context::new_from_hint(owner(), 9991, 0, 0, 0);
    shop::test_init(&mut ctx);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyShopName)]
fun create_shop_rejects_empty_name() {
    let mut ctx = tx_context::new_from_hint(owner(), 10001, 0, 0, 0);
    let (_shop_id, owner_cap) = shop::create_shop(b"".to_string(), &mut ctx);
    std::unit_test::destroy(owner_cap);
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EListingNotFound)]
fun listing_rejects_foreign_shop() {
    let mut ctx = tx_context::new_from_hint(owner(), 10002, 0, 0, 0);
    let (mut shop_a, owner_cap_a) = shop::test_setup_shop(owner(), &mut ctx);
    let (shop_b, _owner_cap_b) = shop::test_setup_shop(second_owner(), &mut ctx);

    let listing_id = shop_a.add_item_listing<test_helpers::TestItem>(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun discount_rejects_foreign_shop() {
    let mut ctx = tx_context::new_from_hint(owner(), 10003, 0, 0, 0);
    let (mut shop_a, owner_cap_a) = shop::test_setup_shop(owner(), &mut ctx);
    let (shop_b, _owner_cap_b) = shop::test_setup_shop(second_owner(), &mut ctx);
    let discount_id = shop_a.create_discount(
        &owner_cap_a,
        option::none(),
        0,
        100,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop_b.discount(discount_id);
    abort
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EDiscountNotFound)]
fun remove_listing_and_discount_when_missing() {
    let mut ctx = tx_context::new_from_hint(owner(), 10004, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let dummy_uid = object::new(&mut ctx);
    let dummy_id = dummy_uid.to_inner();
    dummy_uid.delete();
    let missing_listing_identifier = test_helpers::missing_listing_id();

    test_helpers::remove_listing_if_exists(&mut shop_obj, &owner_cap, missing_listing_identifier);
    shop_obj.remove_discount(&owner_cap, dummy_id);

    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test]
fun remove_discount_drops_discount_and_clears_spotlight() {
    let mut ctx = tx_context::new_from_hint(owner(), 100041, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let listing_id = shop_obj.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Discount Listing".to_string(),
        100,
        1,
        option::none(),
        &mut ctx,
    );
    let discount_id = shop_obj.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        10,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop_obj.attach_spotlight_discount(
        &owner_cap,
        discount_id,
        listing_id,
    );
    shop_obj.remove_discount(&owner_cap, discount_id);

    assert!(!shop_obj.discount_exists(discount_id));
    let listing = shop_obj.listing(listing_id);
    let spotlight_after = listing.spotlight_discount_id();
    assert!(option::is_none(&spotlight_after));

    test_helpers::remove_listing_if_exists(&mut shop_obj, &owner_cap, listing_id);
    std::unit_test::destroy(shop_obj);
    std::unit_test::destroy(owner_cap);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun remove_discount_rejects_foreign_owner_cap() {
    let mut ctx = tx_context::new_from_hint(owner(), 100042, 0, 0, 0);
    let (mut shop_obj, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(second_owner(), &mut ctx);
    let discount_id = shop_obj.create_discount(
        &owner_cap,
        option::none(),
        0,
        10,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    shop_obj.remove_discount(&other_cap, discount_id);
    abort
}

#[test]
fun quote_amount_with_positive_exponent() {
    let price_value = i64::new(1_000, false);
    let expo = i64::new(2, false);
    let price = price::new(price_value, 10, expo, 0);
    let amount = currency::quote_amount_from_usd_cents(
        100,
        9,
        price,
        test_helpers::test_default_max_confidence_ratio_bps(),
    );
    assert!(amount > 0);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::currency::EUnsupportedCurrencyDecimals)]
fun quote_amount_rejects_large_exponent() {
    let price = test_helpers::sample_price();
    let _ = currency::quote_amount_from_usd_cents(
        100,
        39,
        price,
        test_helpers::test_default_max_confidence_ratio_bps(),
    );
    abort
}

// === toggle_discount spotlight interaction tests ===

#[test]
fun toggle_discount_activate_sets_spotlight_when_listing_has_none() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Promo Gloves".to_string(),
        45_00,
        8,
        option::none(),
        &mut ctx,
    );
    // Create a listing-scoped discount; it starts active.
    let discount_id = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        1_000,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );

    // Deactivate first so we can re-activate and observe the spotlight side effect.
    shop.toggle_discount(&owner_cap, discount_id, false);

    // Precondition: no spotlight yet.
    assert!(option::is_none(&shop.listing(listing_id).spotlight_discount_id()));

    shop.toggle_discount(&owner_cap, discount_id, true);

    // Activation should have set this discount as spotlight.
    let spotlight = shop.listing(listing_id).spotlight_discount_id();
    assert!(option::is_some(&spotlight));
    spotlight.do_ref!(|value| assert_eq!(*value, discount_id));

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun toggle_discount_activate_preserves_existing_spotlight() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Promo Helmet".to_string(),
        120_00,
        5,
        option::none(),
        &mut ctx,
    );
    // First discount: scoped to the listing; create_discount sets it as spotlight.
    let first_discount = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    // Second discount: also scoped to the listing.
    // create_discount unconditionally sets spotlight, so it now points to second_discount.
    let second_discount = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        750,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    // Restore first_discount as the intended spotlight.
    shop.attach_spotlight_discount(&owner_cap, first_discount, listing_id);
    // Deactivate second_discount so we can re-activate it in the assertion step.
    shop.toggle_discount(&owner_cap, second_discount, false);

    // Precondition: first_discount is the spotlight.
    let spotlight_before = shop.listing(listing_id).spotlight_discount_id();
    assert!(option::is_some(&spotlight_before));
    spotlight_before.do_ref!(|value| assert_eq!(*value, first_discount));

    // Activating the second discount must NOT overwrite the existing spotlight.
    shop.toggle_discount(&owner_cap, second_discount, true);

    let spotlight_after = shop.listing(listing_id).spotlight_discount_id();
    assert!(option::is_some(&spotlight_after));
    spotlight_after.do_ref!(|value| assert_eq!(*value, first_discount));

    shop.remove_discount(&owner_cap, second_discount);
    shop.remove_discount(&owner_cap, first_discount);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun toggle_discount_deactivate_clears_spotlight_when_matches() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Promo Jersey".to_string(),
        65_00,
        10,
        option::none(),
        &mut ctx,
    );
    let discount_id = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        1_000,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    shop.attach_spotlight_discount(&owner_cap, discount_id, listing_id);

    // Precondition: spotlight is set to this discount.
    let spotlight_before = shop.listing(listing_id).spotlight_discount_id();
    spotlight_before.do_ref!(|value| assert_eq!(*value, discount_id));

    shop.toggle_discount(&owner_cap, discount_id, false);

    // Deactivating the spotlighted discount must clear the spotlight.
    assert!(option::is_none(&shop.listing(listing_id).spotlight_discount_id()));

    shop.remove_discount(&owner_cap, discount_id);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test]
fun toggle_discount_deactivate_preserves_spotlight_belonging_to_different_discount() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    let listing_id = shop.add_item_listing<test_helpers::TestItem>(
        &owner_cap,
        b"Promo Shorts".to_string(),
        55_00,
        12,
        option::none(),
        &mut ctx,
    );
    // first_discount: scoped to listing; create_discount sets it as spotlight.
    let first_discount = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        500,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    // second_discount: also scoped to the listing.
    // create_discount unconditionally sets spotlight, so it now points to second_discount.
    let second_discount = shop.create_discount(
        &owner_cap,
        option::some(listing_id),
        0,
        250,
        0,
        option::none(),
        option::none(),
        &mut ctx,
    );
    // Restore first_discount as the intended spotlighted discount.
    shop.attach_spotlight_discount(&owner_cap, first_discount, listing_id);

    // Precondition: first_discount is the spotlight, second_discount is merely scoped.
    let spotlight_before = shop.listing(listing_id).spotlight_discount_id();
    assert!(option::is_some(&spotlight_before));
    spotlight_before.do_ref!(|value| assert_eq!(*value, first_discount));

    // Deactivating second_discount must NOT touch the spotlight of first_discount.
    shop.toggle_discount(&owner_cap, second_discount, false);

    let spotlight_after = shop.listing(listing_id).spotlight_discount_id();
    assert!(option::is_some(&spotlight_after));
    spotlight_after.do_ref!(|value| assert_eq!(*value, first_discount));

    shop.remove_discount(&owner_cap, second_discount);
    shop.remove_discount(&owner_cap, first_discount);
    test_helpers::remove_listing_if_exists(&mut shop, &owner_cap, listing_id);
    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}
