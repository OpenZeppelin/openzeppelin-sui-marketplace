/// This module defines the `DiscountTemplate` struct, which represents a configurable discount that can be applied to item listings in the oracle market. Templates are owned by shops and can be attached to listings to create promotions.
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

/// Coupon template for creating discounts tracked under the shop.
public struct DiscountTemplate has drop, store {
    /// Template identifier and key in `Shop.discount_templates`.
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

/// Returns the template ID.
public fun id(template: &DiscountTemplate): ID {
    template.id
}

/// Returns the optional listing ID this template applies to.
public fun applies_to_listing(template: &DiscountTemplate): Option<ID> {
    template.applies_to_listing
}

/// Returns the discount rule configured on a template.
public fun rule(template: &DiscountTemplate): DiscountRule {
    template.rule
}

/// Returns the template start time in seconds.
public fun starts_at(template: &DiscountTemplate): u64 {
    template.starts_at
}

/// Returns the optional template expiration time in seconds.
public fun expires_at(template: &DiscountTemplate): Option<u64> {
    template.expires_at
}

/// Returns the optional maximum redemptions for a template.
public fun max_redemptions(template: &DiscountTemplate): Option<u64> {
    template.max_redemptions
}

/// Returns how many times a template has been redeemed.
public fun redemptions(template: &DiscountTemplate): u64 {
    template.redemptions
}

/// Returns whether a template is currently active.
public fun active(template: &DiscountTemplate): bool {
    template.active
}

// === Package Functions ===

public(package) fun new(
    template_id: ID,
    applies_to_listing: Option<ID>,
    rule: DiscountRule,
    starts_at: u64,
    expires_at: Option<u64>,
    max_redemptions: Option<u64>,
): DiscountTemplate {
    DiscountTemplate {
        id: template_id,
        applies_to_listing,
        rule,
        starts_at,
        expires_at,
        max_redemptions,
        redemptions: 0,
        active: true,
    }
}

public(package) fun parse_kind(raw_kind: u8): DiscountRuleKind {
    if (raw_kind == 0) {
        DiscountRuleKind::Fixed
    } else {
        assert!(raw_kind == 1, EInvalidRuleKind);
        DiscountRuleKind::Percent
    }
}

public(package) fun build(rule_kind: DiscountRuleKind, rule_value: u64): DiscountRule {
    match (rule_kind) {
        DiscountRuleKind::Fixed => DiscountRule::Fixed { amount_cents: rule_value },
        DiscountRuleKind::Percent => {
            assert!(rule_value <= BASIS_POINT_DENOMINATOR, EInvalidRuleValue);
            DiscountRule::Percent { bps: rule_value as u16 }
        },
    }
}

public(package) fun apply(rule: DiscountRule, base_price_usd_cents: u64): u64 {
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

public(package) fun apply_percent(base_price_usd_cents: u64, bps: u16): u64 {
    assert!((bps as u64) <= BASIS_POINT_DENOMINATOR, EInvalidRuleValue);
    DiscountRule::Percent { bps }.apply(base_price_usd_cents)
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

public(package) fun set_rule(template: &mut DiscountTemplate, rule: DiscountRule) {
    template.rule = rule;
}

public(package) fun set_starts_at(template: &mut DiscountTemplate, starts_at: u64) {
    template.starts_at = starts_at;
}

public(package) fun set_expires_at(template: &mut DiscountTemplate, expires_at: Option<u64>) {
    template.expires_at = expires_at;
}

public(package) fun set_max_redemptions(
    template: &mut DiscountTemplate,
    max_redemptions: Option<u64>,
) {
    template.max_redemptions = max_redemptions;
}

public(package) fun set_active(template: &mut DiscountTemplate, active: bool) {
    template.active = active;
}

public(package) fun increment_redemptions(template: &mut DiscountTemplate) {
    template.redemptions = template.redemptions + 1;
}

public(package) fun redemption_cap_reached(template: &DiscountTemplate): bool {
    template
        .max_redemptions
        .map_ref!(|max_redemptions| template.redemptions >= *max_redemptions)
        .destroy_or!(false)
}

public(package) fun finished(template: &DiscountTemplate, now: u64): bool {
    let expired = template.expires_at.map_ref!(|expires_at| now >= *expires_at).destroy_or!(false);
    let maxed_out = template.redemption_cap_reached();
    expired || maxed_out
}
