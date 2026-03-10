module pyth::price;

use pyth::i64::I64;

// === Structs ===

/// Oracle price with confidence interval in fixed-point form.
public struct Price has copy, drop, store {
    /// Price value.
    price: I64,
    /// Confidence interval.
    conf: u64,
    /// Exponent (10^expo).
    expo: I64,
    /// Unix timestamp in seconds.
    timestamp: u64,
}

// === Public Functions ===

public fun new(price: I64, conf: u64, expo: I64, timestamp: u64): Price {
    Price {
        price,
        conf,
        expo,
        timestamp,
    }
}

public fun get_price(price: &Price): I64 {
    price.price
}

public fun get_conf(price: &Price): u64 {
    price.conf
}

public fun get_timestamp(price: &Price): u64 {
    price.timestamp
}

public fun get_expo(price: &Price): I64 {
    price.expo
}
