#[test_only]
module sui_oracle_market::shop_tests;

use std::unit_test::assert_eq;
use sui_oracle_market::events;
use sui_oracle_market::shop;
use sui_oracle_market::test_helpers::{assert_emitted, owner};

// === Tests ===

#[test]
fun toggle_shop_updates_active_flag_and_emits_events() {
    let mut ctx = tx_context::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(owner(), &mut ctx);

    assert_eq!(shop.active(), true);

    shop.toggle_shop(&owner_cap, false);

    assert_eq!(shop.active(), false);
    assert_emitted!(
        events::shop_toggled(
            shop.id(),
            owner_cap.owner_cap_id(),
            false,
        ),
    );

    shop.toggle_shop(&owner_cap, true);

    assert_eq!(shop.active(), true);
    assert_emitted!(
        events::shop_toggled(
            shop.id(),
            owner_cap.owner_cap_id(),
            true,
        ),
    );

    std::unit_test::destroy(owner_cap);
    std::unit_test::destroy(shop);
}
