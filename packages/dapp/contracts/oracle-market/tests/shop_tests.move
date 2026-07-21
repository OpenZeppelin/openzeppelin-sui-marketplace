#[test_only]
module sui_oracle_market::shop_tests;

use std::unit_test::assert_eq;
use sui_oracle_market::events;
use sui_oracle_market::shop;
use sui_oracle_market::test_helpers::{assert_emitted, owner};

// === Tests ===

#[test]
fun set_shop_status_updates_active_flag_and_emits_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    assert_eq!(shop.active(), true);

    shop.set_shop_status(&owner_cap, false);

    assert_eq!(shop.active(), false);
    assert_emitted!(
        events::shop_status_changed(
            shop.id(),
            owner_cap.owner_cap_id(),
            false,
        ),
    );

    shop.set_shop_status(&owner_cap, true);

    assert_eq!(shop.active(), true);
    assert_emitted!(
        events::shop_status_changed(
            shop.id(),
            owner_cap.owner_cap_id(),
            true,
        ),
    );

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EShopActiveStateUnchanged)]
fun set_shop_status_rejects_unchanged_state() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    // Shop is created active; setting it active again is a state-preserving no-op and must abort.
    assert_eq!(shop.active(), true);
    shop.set_shop_status(&owner_cap, true);

    abort
}
