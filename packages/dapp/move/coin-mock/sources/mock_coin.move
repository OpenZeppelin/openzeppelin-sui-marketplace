module mock_coin::mock_coin;

use sui::coin;
use sui::coin_registry;

/// Dev/local-only mock USD coin. Published for localnet convenience.
public struct LocalMockUsd has key, store {
    id: UID,
}

/// Dev/local-only mock BTC coin. Published for localnet convenience.
public struct LocalMockBtc has key, store {
    id: UID,
}

const MOCK_COIN_SUPPLY: u64 = 1_000_000_000_000_000_000;

entry fun init_local_mock_usd(
    registry: &mut coin_registry::CoinRegistry,
    recipient: address,
    ctx: &mut tx_context::TxContext,
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

entry fun init_local_mock_btc(
    registry: &mut coin_registry::CoinRegistry,
    recipient: address,
    ctx: &mut tx_context::TxContext,
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

fun finalize_and_fund_coin<T: key + store>(
    mut treasury_cap: coin::TreasuryCap<T>,
    init: coin_registry::CurrencyInitializer<T>,
    recipient: address,
    ctx: &mut tx_context::TxContext,
) {
    let metadata_cap = coin_registry::finalize(init, ctx);
    let minted = treasury_cap.mint(MOCK_COIN_SUPPLY, ctx);

    transfer::public_transfer(treasury_cap, recipient);
    transfer::public_transfer(metadata_cap, recipient);
    transfer::public_transfer(minted, recipient);
}
