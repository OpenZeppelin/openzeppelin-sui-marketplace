module Pyth::price_info;

use Pyth::i64;
use Pyth::price;
use Pyth::price_feed::{Self, PriceFeed};
use Pyth::price_identifier::{Self, PriceIdentifier};
use sui::clock::{Self, Clock};

/// Simplified price info object for localnet tests.
public struct PriceInfoObject has key, store {
    id: UID,
    price_info: PriceInfo,
}

/// Snapshot of a price feed and its timestamps.
public struct PriceInfo has copy, drop, store {
    attestation_time: u64,
    arrival_time: u64,
    price_feed: PriceFeed,
}

public fun new_price_info(
    attestation_time: u64,
    arrival_time: u64,
    price_feed: PriceFeed,
): PriceInfo {
    PriceInfo {
        attestation_time,
        arrival_time,
        price_feed,
    }
}

public fun new_price_info_object(price_info: PriceInfo, ctx: &mut TxContext): PriceInfoObject {
    PriceInfoObject {
        id: object::new(ctx),
        price_info,
    }
}

/// Publish and share a new mock price feed on localnet.
public fun publish_price_feed(
    feed_id_bytes: vector<u8>,
    price_magnitude: u64,
    price_is_negative: bool,
    confidence: u64,
    exponent_magnitude: u64,
    exponent_is_negative: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let price_identifier = price_identifier::from_byte_vec(feed_id_bytes);
    let price_value = price::new(
        i64::new(price_magnitude, price_is_negative),
        confidence,
        i64::new(exponent_magnitude, exponent_is_negative),
        clock::timestamp_ms(clock) / 1000,
    );
    let price_feed = price_feed::new(price_identifier, price_value, price_value);
    let price_info = new_price_info(
        clock::timestamp_ms(clock) / 1000,
        clock::timestamp_ms(clock) / 1000,
        price_feed,
    );
    let price_info_object = new_price_info_object(price_info, ctx);
    transfer::share_object(price_info_object);
}

/// Update an existing mock price feed with fresh timestamps and values.
public fun update_price_feed(
    price_info_object: &mut PriceInfoObject,
    price_magnitude: u64,
    price_is_negative: bool,
    confidence: u64,
    exponent_magnitude: u64,
    exponent_is_negative: bool,
    clock: &Clock,
) {
    let price_identifier = price_feed::get_price_identifier(
        get_price_feed(&price_info_object.price_info),
    );
    let price_value = price::new(
        i64::new(price_magnitude, price_is_negative),
        confidence,
        i64::new(exponent_magnitude, exponent_is_negative),
        clock::timestamp_ms(clock) / 1000,
    );
    let price_feed = price_feed::new(price_identifier, price_value, price_value);
    price_info_object.price_info =
        new_price_info(
            clock::timestamp_ms(clock) / 1000,
            clock::timestamp_ms(clock) / 1000,
            price_feed,
        );
}

#[test_only]
public fun new_price_info_object_for_test(
    price_info: PriceInfo,
    ctx: &mut TxContext,
): PriceInfoObject {
    new_price_info_object(price_info, ctx)
}

public fun uid_to_inner(price_info_object: &PriceInfoObject): ID {
    object::uid_to_inner(&price_info_object.id)
}

public fun get_price_info_from_price_info_object(price_info_object: &PriceInfoObject): PriceInfo {
    price_info_object.price_info
}

public fun get_price_identifier(price_info: &PriceInfo): PriceIdentifier {
    price_feed::get_price_identifier(&price_info.price_feed)
}

public fun get_price_feed(price_info: &PriceInfo): &PriceFeed {
    &price_info.price_feed
}

public fun get_attestation_time(price_info: &PriceInfo): u64 {
    price_info.attestation_time
}

public fun get_arrival_time(price_info: &PriceInfo): u64 {
    price_info.arrival_time
}
