module pyth::i64;

// As Move does not support signed integers, this module wraps a magnitude with a sign bit.
const MAX_POSITIVE_MAGNITUDE: u64 = (1 << 63) - 1;
const MAX_NEGATIVE_MAGNITUDE: u64 = (1 << 63);

/// Signed 64-bit integer representation.
public struct I64 has copy, drop, store {
    negative: bool,
    magnitude: u64,
}

public fun new(magnitude: u64, negative: bool): I64 {
    let max_magnitude = if (negative) {
        MAX_NEGATIVE_MAGNITUDE
    } else {
        MAX_POSITIVE_MAGNITUDE
    };
    assert!(magnitude <= max_magnitude, 0);

    // Normalize zero to be non-negative so equality remains well-defined.
    let normalized_negative = if (magnitude == 0) { false } else { negative };

    I64 {
        magnitude,
        negative: normalized_negative,
    }
}

public fun get_is_negative(i: I64): bool {
    i.negative
}

public fun get_magnitude_if_positive(input: I64): u64 {
    assert!(!input.negative, 0);
    input.magnitude
}

public fun get_magnitude_if_negative(input: I64): u64 {
    assert!(input.negative, 0);
    input.magnitude
}
