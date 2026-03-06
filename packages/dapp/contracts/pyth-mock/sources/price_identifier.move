module pyth::price_identifier;

// === Constants ===

const IDENTIFIER_BYTES_LENGTH: u64 = 32;
const EIncorrectIdentifierLength: u64 = 0;

// === Structs ===

/// Identifier for a Pyth price feed (32 bytes).
public struct PriceIdentifier has copy, drop, store {
    /// Raw identifier bytes.
    bytes: vector<u8>,
}

// === Public Functions ===

public fun from_byte_vec(bytes: vector<u8>): PriceIdentifier {
    assert!(bytes.length() == IDENTIFIER_BYTES_LENGTH, EIncorrectIdentifierLength);
    PriceIdentifier { bytes }
}

public fun get_bytes(price_identifier: &PriceIdentifier): vector<u8> {
    price_identifier.bytes
}
