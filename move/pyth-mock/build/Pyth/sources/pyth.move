module pyth::pyth;

use pyth::price as pyth_price;
use pyth::price_feed;
use pyth::price_info::{Self as price_info, PriceInfoObject};
use sui::clock::{Self as sui_clock, Clock};

const E_STALE_PRICE_UPDATE: u64 = 0;

/// Return the cached price if it is newer than `max_age_secs` relative to the on-chain clock.
public fun get_price_no_older_than(
    price_info_object: &PriceInfoObject,
    clock: &Clock,
    max_age_secs: u64,
): pyth_price::Price {
    let price = get_price_unsafe(price_info_object);
    check_price_is_fresh(&price, clock, max_age_secs);
    price
}

/// Return the cached price without any freshness check.
public fun get_price_unsafe(price_info_object: &PriceInfoObject): pyth_price::Price {
    let price_info = price_info::get_price_info_from_price_info_object(price_info_object);
    price_feed::get_price(price_info::get_price_feed(&price_info))
}

fun check_price_is_fresh(price: &pyth_price::Price, clock: &Clock, max_age_secs: u64) {
    let now_secs = sui_clock::timestamp_ms(clock) / 1000;
    let price_ts = pyth_price::get_timestamp(price);
    let age = if (now_secs > price_ts) {
        now_secs - price_ts
    } else {
        price_ts - now_secs
    };
    assert!(age < max_age_secs, E_STALE_PRICE_UPDATE);
}
