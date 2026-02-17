module pyth::pyth;

use pyth::price;
use pyth::price_feed;
use pyth::price_info::{Self, PriceInfoObject};
use sui::clock::{Self, Clock};

const EStalePriceUpdate: u64 = 0;

/// Return the cached price if it is newer than `max_age_secs` relative to the on-chain clock.
public fun get_price_no_older_than(
    price_info_object: &PriceInfoObject,
    clock: &Clock,
    max_age_secs: u64,
): price::Price {
    let price = get_price_unsafe(price_info_object);
    check_price_is_fresh(price, max_age_secs, clock);
    price
}

/// Return the cached price without any freshness check.
public fun get_price_unsafe(price_info_object: &PriceInfoObject): price::Price {
    let price_info = price_info::get_price_info_from_price_info_object(price_info_object);
    price_feed::get_price(*price_info::get_price_feed(&price_info))
}

fun check_price_is_fresh(price: price::Price, max_age_secs: u64, clock: &Clock) {
    let now_secs = clock::timestamp_ms(clock) / 1000;
    let price_ts = price::get_timestamp(price);
    let age = if (now_secs > price_ts) {
        now_secs - price_ts
    } else {
        price_ts - now_secs
    };
    assert!(age < max_age_secs, EStalePriceUpdate);
}
