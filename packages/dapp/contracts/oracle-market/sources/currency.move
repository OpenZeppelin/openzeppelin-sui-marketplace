/// This module defines the `AcceptedCurrency` struct, which represents a currency that a shop accepts for purchases. Each accepted currency is associated with a Pyth price feed to enable real-time pricing in the oracle market.
module sui_oracle_market::currency;

use std::string::String;

// === Structs ===

/// Defines which external coins the shop is able to price/accept.
public struct AcceptedCurrency has drop, store {
    /// Pyth price feed identifier (32 bytes).
    feed_id: vector<u8>,
    /// ID of Pyth PriceInfoObject.
    pyth_object_id: ID,
    /// Coin decimal precision from registry metadata.
    decimals: u8,
    /// Display symbol for UIs/logging.
    symbol: String,
    /// Upper bound on caller-provided max age override.
    max_price_age_secs_cap: u64,
    /// Upper bound on caller-provided confidence override.
    max_confidence_ratio_bps_cap: u16,
}

// === View Functions ===

/// Returns the oracle feed identifier bytes for an accepted currency.
public fun feed_id(currency: &AcceptedCurrency): vector<u8> {
    currency.feed_id
}

/// Returns the bound Pyth object ID for an accepted currency.
public fun pyth_object_id(currency: &AcceptedCurrency): ID {
    currency.pyth_object_id
}

/// Returns the decimals configured for an accepted currency.
public fun decimals(currency: &AcceptedCurrency): u8 {
    currency.decimals
}

/// Returns the ticker symbol configured for an accepted currency.
public fun symbol(currency: &AcceptedCurrency): String {
    currency.symbol
}

/// Returns the seller cap for `max_price_age_secs` overrides.
public fun max_price_age_secs_cap(currency: &AcceptedCurrency): u64 {
    currency.max_price_age_secs_cap
}

/// Returns the seller cap for `max_confidence_ratio_bps` overrides.
public fun max_confidence_ratio_bps_cap(currency: &AcceptedCurrency): u16 {
    currency.max_confidence_ratio_bps_cap
}

// === Package Functions ===

public(package) fun new(
    feed_id: vector<u8>,
    pyth_object_id: ID,
    decimals: u8,
    symbol: String,
    max_price_age_secs_cap: u64,
    max_confidence_ratio_bps_cap: u16,
): AcceptedCurrency {
    AcceptedCurrency {
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
        max_price_age_secs_cap,
        max_confidence_ratio_bps_cap,
    }
}
