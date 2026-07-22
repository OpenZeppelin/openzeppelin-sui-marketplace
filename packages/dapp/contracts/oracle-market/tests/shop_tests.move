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

#[test]
fun transfer_moves_cap_to_recipient() {
    let recipient = @0xCA9;
    let mut scenario = sui::test_scenario::begin(owner());

    let (shop_id, owner_cap) = shop::create_shop_and_share(
        b"Shop".to_string(),
        scenario.ctx(),
    );
    let owner_cap_id = owner_cap.owner_cap_id();

    // `ShopOwnerCap` has no `store`, so this dedicated entry is the only way to move it.
    shop::transfer(owner_cap, recipient);

    // The recipient now holds the capability and can prove authority over the shop.
    scenario.next_tx(recipient);
    let received_cap = scenario.take_from_sender<shop::ShopOwnerCap>();
    assert_eq!(received_cap.owner_cap_id(), owner_cap_id);
    assert_eq!(received_cap.owner_cap_shop_id(), shop_id);

    scenario.return_to_sender(received_cap);
    scenario.end();
}
