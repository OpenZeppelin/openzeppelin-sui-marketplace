/// Mock Pyth `State` shared object that mirrors the real Pyth Sui contracts'
/// feed registry, so `@pythnetwork/pyth-sui-js`'s `getPriceFeedObjectId(feedId)`
/// works on localnet without changes. Real Pyth maintains a state object whose
/// `b"price_info"` dynamic-object-field is a `Table<PriceIdentifier, ID>` from
/// feed identifier bytes to the corresponding `PriceInfoObject` id.
module pyth::pyth_state;

use pyth::price_identifier::PriceIdentifier;
use sui::dynamic_object_field as dof;
use sui::table::{Self, Table};

// === Constants ===

/// Dynamic-field key used by the Pyth Sui SDK
/// (`@pythnetwork/pyth-sui-js`'s `getPriceTableInfo`) to look up the registry.
const PRICE_INFO_KEY: vector<u8> = b"price_info";

// === Structs ===

/// Top-level mock Pyth state. The `b"price_info"` dynamic object field holds a
/// `Table<PriceIdentifier, ID>`.
public struct State has key {
    id: UID,
}

/// One-time witness for the module. Only consumed in `init`.
public struct PYTH_STATE has drop {}

// === Init ===

/// Creates and shares the mock `State` and seeds it with an empty
/// `Table<PriceIdentifier, ID>` under `b"price_info"`.
fun init(_witness: PYTH_STATE, ctx: &mut TxContext) {
    let mut state = State { id: object::new(ctx) };
    let table: Table<PriceIdentifier, ID> = table::new(ctx);
    dof::add(&mut state.id, PRICE_INFO_KEY, table);
    transfer::share_object(state);
}

// === Package Functions ===

/// Borrow the `Table<PriceIdentifier, ID>` for mutation. Used by
/// `price_info::publish_price_feed` to register newly-published feeds.
public(package) fun price_info_table_mut(state: &mut State): &mut Table<PriceIdentifier, ID> {
    dof::borrow_mut(&mut state.id, PRICE_INFO_KEY)
}

// === Test-Only Helpers ===

#[test_only]
/// Test-only counterpart to `init` -- `init` requires the `PYTH_STATE` one-time
/// witness which can't be forged in `test_scenario`, so we expose the same
/// State construction without the witness for downstream test packages.
public fun init_for_testing(ctx: &mut TxContext) {
    let mut state = State { id: object::new(ctx) };
    let table: Table<PriceIdentifier, ID> = table::new(ctx);
    dof::add(&mut state.id, PRICE_INFO_KEY, table);
    transfer::share_object(state);
}
