/// This module defines the `Discount` struct, which represents a configurable discount that can be applied to item listings in the oracle market. Discounts are owned by shops and can be attached to listings to create promotions.
module sui_oracle_market::discount;

use openzeppelin_math::rounding;
use openzeppelin_math::u64;

// === Errors ===

#[error(code = 1)]
const EInvalidRuleKind: vector<u8> = "invalid rule kind";
#[error(code = 2)]
const EInvalidRuleValue: vector<u8> = "invalid rule value";
#[error(code = 3)]
const EPriceOverflow: vector<u8> = "price overflow";
#[error(code = 4)]
const EDiscountWindow: vector<u8> = "invalid discount window";
#[error(code = 5)]
const EInvalidMaxRedemptions: vector<u8> = "invalid max redemptions";
#[error(code = 6)]
const EDiscountFinalized: vector<u8> = "discount finalized";
#[error(code = 7)]
const EDiscountInactive: vector<u8> = "discount inactive";
#[error(code = 8)]
const EDiscountTooEarly: vector<u8> = "discount too early";
#[error(code = 9)]
const EDiscountExpired: vector<u8> = "discount expired";
#[error(code = 10)]
const EDiscountMaxedOut: vector<u8> = "discount maxed out";
#[error(code = 11)]
const EDiscountListingMismatch: vector<u8> = "discount listing mismatch";

// === Constants ===

const BASIS_POINT_DENOMINATOR: u64 = 10_000;

// === Structs ===

/// Discount rules mirror the spec: fixed (USD cents) or percentage basis points off.
public enum DiscountRule has copy, drop, store {
    Fixed { amount_cents: u64 },
    Percent { bps: u16 },
}

/// Local representation for the rule kind that callers encode as a primitive.
public enum DiscountRuleKind has copy, drop {
    Fixed,
    Percent,
}

/// Configurable discount tracked under the shop.
public struct Discount has drop, store {
    /// Discount identifier and key in `Shop.discounts`.
    id: ID,
    /// Optional listing scope restriction.
    applies_to_listing: Option<ID>,
    /// Fixed/percent discount payload.
    rule: DiscountRule,
    /// Activation timestamp (seconds).
    starts_at: u64,
    /// Optional expiration timestamp (seconds).
    expires_at: Option<u64>,
    /// Optional global redemption cap.
    max_redemptions: Option<u64>,
    /// Number of discounts redeemed in checkout.
    redemptions: u64,
    /// Owner-controlled enable/disable flag.
    active: bool,
}

// === View Functions ===

/// Returns the discount ID.
public fun id(discount: &Discount): ID {
    discount.id
}

/// Returns the optional listing ID this discount applies to.
public fun applies_to_listing(discount: &Discount): Option<ID> {
    discount.applies_to_listing
}

/// Returns the discount rule configured on a discount.
public fun rule(discount: &Discount): DiscountRule {
    discount.rule
}

/// Returns the discount start time in seconds.
public fun starts_at(discount: &Discount): u64 {
    discount.starts_at
}

/// Returns the optional discount expiration time in seconds.
public fun expires_at(discount: &Discount): Option<u64> {
    discount.expires_at
}

/// Returns the optional maximum redemptions for a discount.
public fun max_redemptions(discount: &Discount): Option<u64> {
    discount.max_redemptions
}

/// Returns how many times a discount has been redeemed.
public fun redemptions(discount: &Discount): u64 {
    discount.redemptions
}

/// Returns whether a discount is currently active.
public fun active(discount: &Discount): bool {
    discount.active
}

// === Package Functions ===

/// Creates a discount from primitive rule inputs and allocates a fresh ID.
public(package) fun create(
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    ctx: &mut TxContext,
): Discount {
    expires_at.do!(|expires_at| {
        assert!(expires_at > starts_at, EDiscountWindow);
    });
    max_redemptions.do!(|max_value| {
        assert!(max_value > 0, EInvalidMaxRedemptions);
    });

    let rule = build(parse_kind(rule_kind), rule_value);
    let id = ctx.fresh_object_address().to_id();

    Discount {
        id,
        applies_to_listing: option::none(),
        rule,
        starts_at,
        expires_at,
        max_redemptions,
        redemptions: 0,
        active: true,
    }
}

/// Updates the discount rule or timing parameters on an existing discount,
/// subject to guardrails and restrictions to prevent updates to finalized discounts.
public(package) fun update(
    discount: &mut Discount,
    rule_kind: u8,
    rule_value: u64,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
    now_sec: u64,
) {
    expires_at.do!(|expires_at| {
        assert!(expires_at > starts_at, EDiscountWindow);
    });
    max_redemptions.do!(|max_value| {
        assert!(max_value > 0, EInvalidMaxRedemptions);
    });

    // Assert discount can be updated
    assert!(discount.redemptions == 0, EDiscountFinalized);
    assert!(!discount.finished(now_sec), EDiscountFinalized);

    let discount_rule_kind = parse_kind(rule_kind);
    let discount_rule = build(discount_rule_kind, rule_value);

    discount.rule = discount_rule;
    discount.starts_at = starts_at;
    discount.expires_at = expires_at;
    discount.max_redemptions = max_redemptions;
}

/// Applies a discount to a listing price, enforcing all guardrails
/// and restrictions (active, timing, redemption cap, listing scope)
/// and incrementing redemptions if successful.
/// Returns the discounted price in USD cents.
public(package) fun redeem(
    discount: &mut Discount,
    listing_id: ID,
    listing_price_usd_cents: u64,
    now_sec: u64,
): u64 {
    assert!(discount.active, EDiscountInactive);
    discount.applies_to_listing.do!(|applies_to_listing| {
        assert!(applies_to_listing == listing_id, EDiscountListingMismatch);
    });
    assert!(discount.starts_at <= now_sec, EDiscountTooEarly);
    discount.expires_at.do!(|expires_at| {
        assert!(now_sec < expires_at, EDiscountExpired);
    });
    assert!(!discount.redemption_cap_reached(), EDiscountMaxedOut);

    // Increment redemptions and calculate discount price.
    discount.redemptions = discount.redemptions + 1;
    discount
        .rule()
        .apply(
            listing_price_usd_cents,
        )
}

/// Returns the encoded rule kind (`0 = fixed`, `1 = percent`) for a `DiscountRule`.
public(package) fun kind(rule: DiscountRule): u8 {
    match (rule) {
        DiscountRule::Fixed { amount_cents: _ } => 0,
        DiscountRule::Percent { bps: _ } => 1,
    }
}

/// Returns the numeric payload (`amount_cents` or `bps`) for a `DiscountRule`.
public(package) fun value(rule: DiscountRule): u64 {
    match (rule) {
        DiscountRule::Fixed { amount_cents } => amount_cents,
        DiscountRule::Percent { bps } => bps as u64,
    }
}

/// Sets the active status of a discount.
public(package) fun set_active(discount: &mut Discount, active: bool) {
    discount.active = active;
}

/// Set applies to listing and returns previously set value if any.
public(package) fun set_applies_to_listing(
    discount: &mut Discount,
    applies_to_listing: ID,
): Option<ID> {
    discount.applies_to_listing.swap_or_fill(applies_to_listing)
}

// === Private Functions ===

/// Parses primitive rule kind encoding into a typed rule kind.
fun parse_kind(raw_kind: u8): DiscountRuleKind {
    if (raw_kind == 0) {
        DiscountRuleKind::Fixed
    } else {
        assert!(raw_kind == 1, EInvalidRuleKind);
        DiscountRuleKind::Percent
    }
}

/// Builds a rule payload from a parsed kind and primitive value.
fun build(rule_kind: DiscountRuleKind, rule_value: u64): DiscountRule {
    match (rule_kind) {
        DiscountRuleKind::Fixed => DiscountRule::Fixed { amount_cents: rule_value },
        DiscountRuleKind::Percent => {
            assert!(rule_value <= BASIS_POINT_DENOMINATOR, EInvalidRuleValue);
            DiscountRule::Percent { bps: rule_value as u16 }
        },
    }
}

/// Applies a fixed or percent discount and returns the resulting USD-cent price.
fun apply(rule: DiscountRule, base_price_usd_cents: u64): u64 {
    match (rule) {
        DiscountRule::Fixed { amount_cents } => {
            if (amount_cents >= base_price_usd_cents) {
                0
            } else {
                base_price_usd_cents - amount_cents
            }
        },
        DiscountRule::Percent { bps } => {
            let remaining_bps = BASIS_POINT_DENOMINATOR - (bps as u64);
            // Round UP to ensure sellers don't lose fractional cents.
            let maybe_discounted = u64::mul_div(
                base_price_usd_cents,
                remaining_bps,
                BASIS_POINT_DENOMINATOR,
                rounding::up(),
            );
            maybe_discounted.destroy_or!(abort EPriceOverflow)
        },
    }
}

/// Returns whether a discount can no longer be used due to expiry or cap exhaustion.
fun finished(discount: &Discount, now_sec: u64): bool {
    let expired = discount
        .expires_at
        .map_ref!(|expires_at| now_sec >= *expires_at)
        .destroy_or!(false);
    let maxed_out = discount.redemption_cap_reached();
    expired || maxed_out
}

/// Returns whether the optional redemption cap has been reached.
fun redemption_cap_reached(discount: &Discount): bool {
    discount
        .max_redemptions
        .map_ref!(|max_redemptions| discount.redemptions >= *max_redemptions)
        .destroy_or!(false)
}
