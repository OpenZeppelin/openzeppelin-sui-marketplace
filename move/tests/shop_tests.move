#[test_only]
module sui_oracle_market::shop_tests;

use std::option as opt;
use std::vector as vec;
use sui::event;
use sui::object as obj;
use sui::package as pkg;
use sui::test_scenario as scenario;
use sui::tx_context as tx;
use sui::vec_map;
use sui_oracle_market::shop;

const TEST_OWNER: address = @0xBEEF;
const OTHER_OWNER: address = @0xCAFE;
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
    assert!(shop::test_listing_exists(&shop, listing_id), E_ASSERT_FAILURE);
    let (name, base_price_usd, stock, shop_id, spotlight_template_id) = shop::test_listing_values(
        &shop,
        listing_id,
    );
    let added_events = event::events_by_type<shop::ItemListingAdded>();
    assert!(vec::length(&added_events) == 1, E_ASSERT_FAILURE);
    let added_event = vec::borrow(&added_events, 0);

    assert!(name == b"Cool Bike", E_ASSERT_FAILURE);
    assert!(base_price_usd == 125_00, E_ASSERT_FAILURE);
    assert!(stock == 25, E_ASSERT_FAILURE);
    assert!(shop_id == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::is_none(&spotlight_template_id), E_ASSERT_FAILURE);
    let shop_address = shop::test_shop_id(&shop);
    let listing_address = obj::id_to_address(&listing_id);
    assert!(
        shop::test_item_listing_added_shop(added_event) == shop_address,
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_listing(added_event) == listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_name(added_event) == b"Cool Bike",
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_base_price(added_event) == 125_00,
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
    let added_events = event::events_by_type<shop::ItemListingAdded>();
    assert!(vec::length(&added_events) == 1, E_ASSERT_FAILURE);
    let added_event = vec::borrow(&added_events, 0);
    let shop_address = shop::test_shop_id(&shop);
    let listing_address = obj::id_to_address(&listing_id);

    assert!(opt::is_some(&spotlight_template_id), E_ASSERT_FAILURE);
    assert!(opt::borrow(&spotlight_template_id) == template_id, E_ASSERT_FAILURE);
    assert!(
        shop::test_item_listing_added_shop(added_event) == shop_address,
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_listing(added_event) == listing_address,
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_name(added_event) == b"Limited Tire Set",
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_item_listing_added_base_price(added_event) == 200_00,
        E_ASSERT_FAILURE,
    );
    let spotlight_template = shop::test_item_listing_added_spotlight_template(added_event);
    assert!(opt::is_some(&spotlight_template), E_ASSERT_FAILURE);
    assert!(
        opt::borrow(&spotlight_template) == obj::id_to_address(&template_id),
        E_ASSERT_FAILURE,
    );
    assert!(shop::test_item_listing_added_stock(added_event) == 8, E_ASSERT_FAILURE);

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

#[test, expected_failure(abort_code = ::sui_oracle_market::shop::EInvalidOwnerCap)]
fun add_item_listing_rejects_foreign_owner_cap() {
    let mut ctx = tx::dummy();
    let (mut shop, _owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);
    let (_other_shop, other_cap) = shop::test_setup_shop(OTHER_OWNER, &mut ctx);

    shop::add_item_listing<shop::GenericItem>(
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

#[test]
fun update_item_listing_stock_updates_listing_and_emits_events() {
    let mut ctx = tx::dummy();
    let (mut shop, owner_cap) = shop::test_setup_shop(TEST_OWNER, &mut ctx);

    shop::add_item_listing<shop::GenericItem>(
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

    let (name, base_price, stock, shop_id, spotlight_template) =
        shop::test_listing_values(&shop, listing_id);
    assert!(name == b"Helmet", E_ASSERT_FAILURE);
    assert!(base_price == 48_00, E_ASSERT_FAILURE);
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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
    assert!(shop::test_item_listing_stock_updated_listing(first) == listing_address, E_ASSERT_FAILURE);
    assert!(shop::test_item_listing_stock_updated_listing(second) == listing_address, E_ASSERT_FAILURE);
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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
    let (name, price, stock, listing_shop_address, spotlight) =
        shop::test_listing_values(&shop, remaining_listing_id);
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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
