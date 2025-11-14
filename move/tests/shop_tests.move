#[test_only]
module sui_oracle_market::shop_tests;

use std::option as opt;
use std::vector as vec;
use sui::event;
use sui::object as obj;
use sui::package as pkg;
use sui::tx_context as tx;
use sui_oracle_market::shop;

const TEST_OWNER: address = @0xBEEF;
const E_ASSERT_FAILURE: u64 = 0;

public struct ForeignPublisherOTW has drop {}

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
fun add_item_listing_stores_metadata() {
    let mut ctx: tx::TxContext = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::GenericItem>(
        &mut shop,
        b"Cool Bike",
        125_00,
        25,
        opt::none(),
        &owner_cap,
        &mut ctx,
    );

    let listing_id = shop::test_last_created_id(&ctx);
    let (name, base_price_usd, stock, shop_id, spotlight_template_id) = shop::test_listing_values(
        &shop,
        listing_id,
    );

    assert!(name == b"Cool Bike", E_ASSERT_FAILURE);
    assert!(base_price_usd == 125_00, E_ASSERT_FAILURE);
    assert!(stock == 25, E_ASSERT_FAILURE);
    assert!(shop_id == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::is_none(&spotlight_template_id), E_ASSERT_FAILURE);

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test]
fun add_item_listing_links_spotlight_template() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let template_id = create_discount_template(&mut shop, &owner_cap, &mut ctx);

    shop::add_item_listing<shop::GenericItem>(
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

    assert!(opt::is_some(&spotlight_template_id), E_ASSERT_FAILURE);
    assert!(opt::borrow(&spotlight_template_id) == template_id, E_ASSERT_FAILURE);

    shop::test_remove_listing(&mut shop, listing_id);
    shop::test_remove_template(&mut shop, template_id);
    shop::test_destroy_owner_cap(owner_cap);
    shop::test_destroy_shop(shop);
}

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EEmptyItemName)]
fun add_item_listing_rejects_empty_name() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::GenericItem>(
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

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidPrice)]
fun add_item_listing_rejects_zero_price() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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
