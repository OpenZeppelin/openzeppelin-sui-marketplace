#[allow(lint(public_entry))]
module mock_coin::mock_coin;

use std::string;
use sui::coin;
use sui::coin_registry as registry;
use sui::object as obj;
use sui::transfer as txf;
use sui::tx_context as tx;

/// Dev/local-only mock USD coin. Published for localnet convenience.
public struct LocalMockUsd has key, store {
    id: obj::UID,
}

/// Dev/local-only mock BTC coin. Published for localnet convenience.
public struct LocalMockBtc has key, store {
    id: obj::UID,
}

const MOCK_COIN_SUPPLY: u64 = 1_000_000_000_000;

public entry fun init_local_mock_usd(
    registry: &mut registry::CoinRegistry,
    recipient: address,
    ctx: &mut tx::TxContext,
) {
    let (init, treasury_cap) = registry::new_currency<LocalMockUsd>(
        registry,
        6,
        string::utf8(b"USDc"),
        string::utf8(b"Local Mock USD"),
        string::utf8(b"Local mock asset for development only."),
        string::utf8(b""),
        ctx,
    );
    finalize_and_fund_coin(init, treasury_cap, recipient, ctx);
}

public entry fun init_local_mock_btc(
    registry: &mut registry::CoinRegistry,
    recipient: address,
    ctx: &mut tx::TxContext,
) {
    let (init, treasury_cap) = registry::new_currency<LocalMockBtc>(
        registry,
        8,
        string::utf8(b"BTC"),
        string::utf8(b"Local Mock BTC"),
        string::utf8(b"Local mock asset for development only."),
        string::utf8(b""),
        ctx,
    );
    finalize_and_fund_coin(init, treasury_cap, recipient, ctx);
}

fun finalize_and_fund_coin<T: key + store>(
    init: registry::CurrencyInitializer<T>,
    mut treasury_cap: coin::TreasuryCap<T>,
    recipient: address,
    ctx: &mut tx::TxContext,
) {
    let metadata_cap = registry::finalize(init, ctx);
    let minted = coin::mint(&mut treasury_cap, MOCK_COIN_SUPPLY, ctx);

    txf::public_transfer(treasury_cap, recipient);
    txf::public_transfer(metadata_cap, recipient);
    txf::public_transfer(minted, recipient);
}
