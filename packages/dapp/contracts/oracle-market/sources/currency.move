/// This module defines the `AcceptedCurrency` struct, which represents a currency that a shop accepts for purchases. Each accepted currency is associated with a Pyth price feed to enable real-time pricing in the oracle market.
module sui_oracle_market::currency;

use std::string::String;
use sui::coin_registry::Currency;

// === Errors ===

#[error(code = 0)]
const EEmptyFeedId: vector<u8> = "empty feed id";
#[error(code = 1)]
const EInvalidFeedIdLength: vector<u8> = "invalid feed id length";
#[error(code = 2)]
const EUnsupportedCurrencyDecimals: vector<u8> = "unsupported currency decimals";
#[error(code = 3)]
const EInvalidGuardrailCap: vector<u8> = "invalid guardrail cap";

// === Constants ===

const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;
const MAX_DECIMAL_POWER: u64 = 24;
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;
/// Reject price feeds with sigma/mu above 10%.
const DEFAULT_MAX_CONFIDENCE_RATIO_BPS: u16 = 1_000;

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

public(package) fun create<TCoin>(
    feed_id: vector<u8>,
    pyth_object_id: ID,
    currency: &Currency<TCoin>,
    max_price_age_secs_cap: Option<u64>,
    max_confidence_ratio_bps_cap: Option<u16>,
): AcceptedCurrency {
    // Resolve age_cap and confidence_cap
    let age_cap = resolve_guardrail_cap!(max_price_age_secs_cap, DEFAULT_MAX_PRICE_AGE_SECS);
    let confidence_cap = resolve_guardrail_cap!(
        max_confidence_ratio_bps_cap,
        DEFAULT_MAX_CONFIDENCE_RATIO_BPS,
    );

    let decimals = currency.decimals();
    let symbol = currency.symbol();

    assert!(!feed_id.is_empty(), EEmptyFeedId);
    assert!(feed_id.length() == PYTH_PRICE_IDENTIFIER_LENGTH, EInvalidFeedIdLength);
    assert!(decimals as u64 <= MAX_DECIMAL_POWER, EUnsupportedCurrencyDecimals);

    AcceptedCurrency {
        feed_id,
        pyth_object_id,
        decimals,
        symbol,
        max_price_age_secs_cap: age_cap,
        max_confidence_ratio_bps_cap: confidence_cap,
    }
}

// === Private Functions ===

/// Normalize a seller-provided guardrail cap, enforcing module-level ceilings and non-zero.
macro fun resolve_guardrail_cap<$T>($proposed_cap: Option<$T>, $module_cap: $T): $T {
    let proposed_cap = $proposed_cap;
    let module_cap = $module_cap;
    let value = proposed_cap.destroy_or!(module_cap);
    assert!(value > 0, EInvalidGuardrailCap);
    value.min(module_cap)
}
