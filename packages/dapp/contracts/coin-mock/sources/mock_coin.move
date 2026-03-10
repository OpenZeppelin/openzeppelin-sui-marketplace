module mock_coin::mock_coin;

use sui::coin;
use sui::coin_registry::{Self, CoinRegistry};

// === Structs ===

/// Dev/local-only mock USD coin. Published for localnet convenience.
public struct LocalMockUsd has key, store {
    /// Unique ID for the coin object.
    id: UID,
}

/// Dev/local-only mock BTC coin. Published for localnet convenience.
public struct LocalMockBtc has key, store {
    /// Unique ID for the coin object.
    id: UID,
}

// === Constants ===

/// Fixed supply minted at initialization and transferred to `recipient`.
const MOCK_COIN_SUPPLY: u64 = 1_000_000_000_000_000_000;

// === Public Functions ===

/// Initializes the local mock USD currency.
entry fun init_local_mock_usd(
    registry: &mut CoinRegistry,
    recipient: address,
    ctx: &mut TxContext,
) {
    let (init, treasury_cap) = coin_registry::new_currency<LocalMockUsd>(
        registry,
        6,
        b"USDc".to_string(),
        b"Local Mock USD".to_string(),
        b"Local mock asset for development only.".to_string(),
        b"".to_string(),
        ctx,
    );
    finalize_and_fund_coin(treasury_cap, init, recipient, ctx);
}

/// Initializes the local mock BTC currency.
entry fun init_local_mock_btc(
    registry: &mut CoinRegistry,
    recipient: address,
    ctx: &mut TxContext,
) {
    let (init, treasury_cap) = coin_registry::new_currency<LocalMockBtc>(
        registry,
        8,
        b"BTC".to_string(),
        b"Local Mock BTC".to_string(),
        b"Local mock asset for development only.".to_string(),
        b"".to_string(),
        ctx,
    );
    finalize_and_fund_coin(treasury_cap, init, recipient, ctx);
}

// === Private Functions ===

fun finalize_and_fund_coin<T: key + store>(
    mut treasury_cap: coin::TreasuryCap<T>,
    init: coin_registry::CurrencyInitializer<T>,
    recipient: address,
    ctx: &mut TxContext,
) {
    let metadata_cap = init.finalize(ctx);
    let minted = treasury_cap.mint(MOCK_COIN_SUPPLY, ctx);

    transfer::public_transfer(treasury_cap, recipient);
    transfer::public_transfer(metadata_cap, recipient);
    transfer::public_transfer(minted, recipient);
}
