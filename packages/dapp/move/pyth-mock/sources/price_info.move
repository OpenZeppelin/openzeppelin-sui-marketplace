module Pyth::price_info;

use Pyth::i64;
use Pyth::price;
use Pyth::price_feed::{Self, PriceFeed};
use Pyth::price_identifier;
use sui::clock;

/// Minimal on-chain container for a Pyth price feed.
public struct PriceInfoObject has key, store {
    id: UID,
    price_info: PriceInfo,
}

/// Copyable payload holding attestation metadata plus the feed values.
public struct PriceInfo has copy, drop, store {
    attestation_time: u64,
    arrival_time: u64,
    price_feed: PriceFeed,
}

/// Create a price feed object owned by the sender and immediately share it so anyone can read.
/// Values are timestamped with the current clock to keep them fresh for `get_price_no_older_than`.
#[allow(lint(share_owned))]
public fun publish_price_feed(
    feed_id: vector<u8>,
    price_value: u64,
    price_is_negative: bool,
    conf: u64,
    expo: u64,
    expo_is_negative: bool,
    clock: &clock::Clock,
    ctx: &mut tx_context::TxContext,
) {
    let price_info_object = new_price_info_object_from_raw(
        feed_id,
        price_value,
        price_is_negative,
        conf,
        expo,
        expo_is_negative,
        clock,
        ctx,
    );
    transfer::public_share_object(price_info_object);
}

/// Update an existing feed in-place with fresh values and timestamps.
public fun update_price_feed(
    price_info_object: &mut PriceInfoObject,
    price_value: u64,
    price_is_negative: bool,
    conf: u64,
    expo: u64,
    expo_is_negative: bool,
    clock: &clock::Clock,
) {
    let now_secs = clock::timestamp_ms(clock) / 1000;
    let identifier = price_feed::get_price_identifier(
        &price_info_object.price_info.price_feed,
    );
    let price = build_price(
        price_value,
        price_is_negative,
        conf,
        expo,
        expo_is_negative,
        now_secs,
    );
    let feed = price_feed::new(identifier, price, price);
    price_info_object.price_info =
        PriceInfo {
            attestation_time: now_secs,
            arrival_time: now_secs,
            price_feed: feed,
        };
}

/// Helper for tests and other modules to materialize a new price info object without sharing.
public fun new_price_info_object(
    price_info: PriceInfo,
    ctx: &mut tx_context::TxContext,
): PriceInfoObject {
    PriceInfoObject {
        id: object::new(ctx),
        price_info,
    }
}

/// Build a price info object using primitive args rather than nested structs.
/// The returned object is owned by the caller; share it if broader access is required.
public fun new_price_info_object_from_raw(
    feed_id: vector<u8>,
    price_value: u64,
    price_is_negative: bool,
    conf: u64,
    expo: u64,
    expo_is_negative: bool,
    clock: &clock::Clock,
    ctx: &mut tx_context::TxContext,
): PriceInfoObject {
    let now_secs = clock::timestamp_ms(clock) / 1000;
    let price = build_price(
        price_value,
        price_is_negative,
        conf,
        expo,
        expo_is_negative,
        now_secs,
    );
    let feed = build_price_feed(feed_id, price);
    let price_info = new_price_info(now_secs, now_secs, feed);
    new_price_info_object(price_info, ctx)
}

/// Create copyable price info data.
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

/// Test helper mirroring the upstream Pyth API.
#[test_only]
public fun new_price_info_object_for_test(
    price_info: PriceInfo,
    ctx: &mut tx_context::TxContext,
): PriceInfoObject {
    new_price_info_object(price_info, ctx)
}

public fun uid_to_inner(price_info: &PriceInfoObject): ID {
    object::uid_to_inner(&price_info.id)
}

public fun get_price_info_from_price_info_object(price_info: &PriceInfoObject): PriceInfo {
    price_info.price_info
}

public fun get_price_identifier(price_info: &PriceInfo): price_identifier::PriceIdentifier {
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

fun build_price_feed(feed_id: vector<u8>, price: price::Price): PriceFeed {
    let identifier = price_identifier::from_byte_vec(feed_id);
    price_feed::new(identifier, price, price)
}

fun build_price(
    price_value: u64,
    price_is_negative: bool,
    conf: u64,
    expo: u64,
    expo_is_negative: bool,
    timestamp: u64,
): price::Price {
    let price = i64::new(price_value, price_is_negative);
    let exponent = i64::new(expo, expo_is_negative);
    price::new(price, conf, exponent, timestamp)
}
