/// This module defines the `AcceptedCurrency` struct, which represents a currency that a shop accepts for purchases. Each accepted currency is associated with a Pyth price feed to enable real-time pricing in the oracle market.
module sui_oracle_market::currency;

use openzeppelin_math::rounding;
use openzeppelin_math::u128 as oz_u128;
use pyth::i64;
use pyth::price::Price;
use pyth::price_info::{Self, PriceInfoObject};
use pyth::pyth;
use std::string::String;
use std::u128;
use sui::clock::Clock;
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
#[error(code = 4)]
const EPriceInvalidPublishTime: vector<u8> = "invalid publish timestamp";
#[error(code = 5)]
const EPriceOverflow: vector<u8> = "price overflow";
#[error(code = 6)]
const EPriceNonPositive: vector<u8> = "price non-positive";
#[error(code = 7)]
const EConfidenceIntervalTooWide: vector<u8> = "confidence interval too wide";
#[error(code = 8)]
const EConfidenceExceedsPrice: vector<u8> = "confidence exceeds price";

// === Constants ===

const PYTH_PRICE_IDENTIFIER_LENGTH: u64 = 32;
const MAX_DECIMAL_POWER: u64 = 24;
const DEFAULT_MAX_PRICE_AGE_SECS: u64 = 60;
/// Reject price feeds with sigma/mu above 10%.
const DEFAULT_MAX_CONFIDENCE_RATIO_BPS: u16 = 1_000;
const BASIS_POINT_DENOMINATOR: u128 = 10_000;
const CENTS_PER_DOLLAR: u128 = 100;

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

/// Creates accepted-currency metadata with validated feed and guardrail caps.
public(package) fun create<C>(
    feed_id: vector<u8>,
    pyth_object_id: ID,
    currency: &Currency<C>,
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

/// Quotes required coin amount with seller caps and optional buyer-tightened guardrails.
public(package) fun quote_amount_with_guardrails(
    accepted_currency: &AcceptedCurrency,
    price_info_object: &PriceInfoObject,
    price_usd_cents: u64,
    max_price_age_secs: Option<u64>,
    max_confidence_ratio_bps: Option<u16>,
    clock: &Clock,
): u64 {
    // Compute effective max age.
    let requested_max_age = max_price_age_secs.destroy_or!(
        accepted_currency.max_price_age_secs_cap,
    );
    let effective_max_age = requested_max_age.min(accepted_currency.max_price_age_secs_cap);

    // Compute effective confidence ratio.
    let requested_confidence_ratio = max_confidence_ratio_bps.destroy_or!(
        accepted_currency.max_confidence_ratio_bps_cap,
    );
    let effective_confidence_ratio = requested_confidence_ratio.min(accepted_currency.max_confidence_ratio_bps_cap);

    // Assert publish time.
    let price_info = price_info::get_price_info_from_price_info_object(
        price_info_object,
    );
    let current_price = price_info.get_price_feed().get_price();
    let publish_time = current_price.get_timestamp();
    let now_sec = now_secs(clock);
    assert!(now_sec >= publish_time, EPriceInvalidPublishTime);
    assert!(now_sec - publish_time <= effective_max_age, EPriceInvalidPublishTime);

    // Get pyth price and quote amount.
    let price = pyth::get_price_no_older_than(
        price_info_object,
        clock,
        effective_max_age,
    );
    quote_amount_from_usd_cents(
        price_usd_cents,
        accepted_currency.decimals,
        price,
        effective_confidence_ratio,
    )
}

/// Converts a USD-cent amount into a quoted coin amount.
public(package) fun quote_amount_from_usd_cents(
    usd_cents: u64,
    decimals: u8,
    price: Price,
    max_confidence_ratio_bps: u16,
): u64 {
    let price_value = price.get_price();
    let mantissa = positive_price_to_u128(price_value);
    let confidence = price.get_conf() as u128;
    let exponent = price.get_expo();
    let exponent_is_negative = exponent.get_is_negative();
    let exponent_magnitude = if (exponent_is_negative) {
        exponent.get_magnitude_if_negative()
    } else {
        exponent.get_magnitude_if_positive()
    };
    let conservative_mantissa = conservative_price_mantissa(
        mantissa,
        confidence,
        max_confidence_ratio_bps,
    );

    assert!(decimals as u64 <= MAX_DECIMAL_POWER, EUnsupportedCurrencyDecimals);
    let coin_decimals_pow10 = u128::pow(10, decimals);
    assert!(exponent_magnitude <= MAX_DECIMAL_POWER, EPriceOverflow);
    let exponent_pow10 = u128::pow(10, exponent_magnitude as u8);

    let mut numerator_multiplier = coin_decimals_pow10;
    if (exponent_is_negative) {
        numerator_multiplier = // TODO#q: try checked_mul and remove wormhole dep.
            oz_u128::mul_div(
                numerator_multiplier,
                exponent_pow10,
                1,
                rounding::down(),
            ).destroy_or!(abort EPriceOverflow);
    };

    let mut denominator_multiplier = oz_u128::mul_div(
        conservative_mantissa,
        CENTS_PER_DOLLAR,
        1,
        rounding::down(),
    ).destroy_or!(abort EPriceOverflow);

    if (!exponent_is_negative) {
        denominator_multiplier =
            oz_u128::mul_div(
                denominator_multiplier,
                exponent_pow10,
                1,
                rounding::down(),
            ).destroy_or!(abort EPriceOverflow);
    };

    let amount = oz_u128::mul_div(
        usd_cents as u128,
        numerator_multiplier,
        denominator_multiplier,
        rounding::up(),
    ).destroy_or!(abort EPriceOverflow);

    amount.try_as_u64().destroy_or!(abort EPriceOverflow)
}

/// Normalize consensus clock milliseconds to seconds once at the boundary.
/// Pyth stale checks and price timestamps are second-based (`max_age_secs` vs `price::get_timestamp`),
/// so keeping module guardrails in seconds avoids mixed-unit errors.
public(package) fun now_secs(clock: &Clock): u64 {
    clock.timestamp_ms() / 1000
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

/// Apply mu-sigma per Pyth best practices to avoid undercharging when prices are uncertain.
fun conservative_price_mantissa(
    mantissa: u128,
    confidence: u128,
    max_confidence_ratio_bps: u16,
): u128 {
    assert!(mantissa > confidence, EConfidenceExceedsPrice);
    let scaled_confidence = confidence * BASIS_POINT_DENOMINATOR;
    let max_allowed = mantissa * (max_confidence_ratio_bps as u128);
    assert!(scaled_confidence <= max_allowed, EConfidenceIntervalTooWide);
    mantissa - confidence
}

/// Converts a positive signed Pyth price component into `u128`.
fun positive_price_to_u128(value: i64::I64): u128 {
    assert!(!value.get_is_negative(), EPriceNonPositive);
    let magnitude = value.get_magnitude_if_positive() as u128;
    assert!(magnitude > 0, EPriceNonPositive);
    magnitude
}
