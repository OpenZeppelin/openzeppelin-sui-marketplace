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
        minted,
        active,
    ) = shop::test_discount_template_values(&shop, template_id);

    assert!(shop_address == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::is_none(&applies_to_listing), E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_kind(rule) == 0, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(rule) == 1_250, E_ASSERT_FAILURE);
    assert!(starts_at == 10, E_ASSERT_FAILURE);
    assert!(opt::borrow(&expires_at) == 50, E_ASSERT_FAILURE);
    assert!(opt::borrow(&max_redemptions) == 5, E_ASSERT_FAILURE);
    assert!(minted == 0, E_ASSERT_FAILURE);
    assert!(active, E_ASSERT_FAILURE);

    let created_events = event::events_by_type<shop::DiscountTemplateCreated>();
    assert!(vec::length(&created_events) == 1, E_ASSERT_FAILURE);
    let created = vec::borrow(&created_events, 0);
    assert!(
        shop::test_discount_template_created_shop(created) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_discount_template_created_id(created) == template_address,
        E_ASSERT_FAILURE,
    );
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

    shop::add_item_listing<shop::GenericItem>(
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
        minted,
        active,
    ) = shop::test_discount_template_values(&shop, template_id);

    assert!(shop_address == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::borrow(&applies_to_listing) == listing_id, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_kind(rule) == 1, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(rule) == 2_500, E_ASSERT_FAILURE);
    assert!(starts_at == 0, E_ASSERT_FAILURE);
    assert!(opt::is_none(&expires_at), E_ASSERT_FAILURE);
    assert!(opt::is_none(&max_redemptions), E_ASSERT_FAILURE);
    assert!(minted == 0, E_ASSERT_FAILURE);
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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
        minted,
        active,
    ) = shop::test_discount_template_values(&shop, template_id);
    assert!(shop_address == shop::test_shop_id(&shop), E_ASSERT_FAILURE);
    assert!(opt::borrow(&applies_to_listing) == listing_id, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_kind(rule) == 1, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_value(rule) == 750, E_ASSERT_FAILURE);
    assert!(starts_at == 50, E_ASSERT_FAILURE);
    assert!(opt::borrow(&expires_at) == 200, E_ASSERT_FAILURE);
    assert!(opt::borrow(&max_redemptions) == 10, E_ASSERT_FAILURE);
    assert!(minted == 0, E_ASSERT_FAILURE);
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
        minted,
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
        minted_after_first,
        active_after_first,
    ) = shop::test_discount_template_values(&shop, template_id);

    assert!(shop_address_after_first == shop_address, E_ASSERT_FAILURE);
    assert!(applies_to_listing_after_first == applies_to_listing, E_ASSERT_FAILURE);
    assert!(shop::test_discount_rule_kind(rule_after_first) == shop::test_discount_rule_kind(rule), E_ASSERT_FAILURE);
    assert!(
        shop::test_discount_rule_value(rule_after_first) == shop::test_discount_rule_value(rule),
        E_ASSERT_FAILURE,
    );
    assert!(starts_at_after_first == starts_at, E_ASSERT_FAILURE);
    assert!(expires_at_after_first == expires_at, E_ASSERT_FAILURE);
    assert!(max_redemptions_after_first == max_redemptions, E_ASSERT_FAILURE);
    assert!(minted_after_first == minted, E_ASSERT_FAILURE);
    assert!(!active_after_first, E_ASSERT_FAILURE);

    let toggled_events = event::events_by_type<shop::DiscountTemplateToggled>();
    assert!(vec::length(&toggled_events) == 1, E_ASSERT_FAILURE);
    let first = vec::borrow(&toggled_events, 0);
    assert!(
        shop::test_discount_template_toggled_shop(first) == shop::test_shop_id(&shop),
        E_ASSERT_FAILURE,
    );
    assert!(
        shop::test_discount_template_toggled_id(first) == template_address,
        E_ASSERT_FAILURE,
    );
    assert!(!shop::test_discount_template_toggled_active(first), E_ASSERT_FAILURE);

    shop::toggle_discount_template(&mut shop, template_id, true, &owner_cap, &mut ctx);

    let (_, _, _, _, _, _, minted_after_second, active_after_second) =
        shop::test_discount_template_values(&shop, template_id);
    assert!(minted_after_second == minted, E_ASSERT_FAILURE);
    assert!(active_after_second, E_ASSERT_FAILURE);

    let toggled_events_after_second = event::events_by_type<shop::DiscountTemplateToggled>();
    assert!(vec::length(&toggled_events_after_second) == 2, E_ASSERT_FAILURE);
    let second = vec::borrow(&toggled_events_after_second, 1);
    assert!(
        shop::test_discount_template_toggled_id(second) == template_address,
        E_ASSERT_FAILURE,
    );
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

    shop::add_item_listing<shop::GenericItem>(
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
    assert!(vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0, E_ASSERT_FAILURE);

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
    assert!(vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0, E_ASSERT_FAILURE);

    shop::toggle_template_on_listing(&mut shop, listing_id, opt::none(), &owner_cap, &mut ctx);

    let (_, _, _, _, spotlight_after_clear) = shop::test_listing_values(&shop, listing_id);
    assert!(opt::is_none(&spotlight_after_clear), E_ASSERT_FAILURE);
    assert!(tx::get_ids_created(&ctx) == ids_before_toggle, E_ASSERT_FAILURE);
    assert!(vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0, E_ASSERT_FAILURE);

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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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
    shop::add_item_listing<shop::GenericItem>(
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
    assert!(vec::length(&event::events_by_type<shop::DiscountTemplateToggled>()) == 0, E_ASSERT_FAILURE);

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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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

    shop::add_item_listing<shop::GenericItem>(
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
