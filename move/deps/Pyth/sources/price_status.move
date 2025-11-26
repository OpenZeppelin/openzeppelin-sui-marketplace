module pyth::price_status {
    //use pyth::error;

    /// The price feed is not currently updating for an unknown reason.
    const UNKNOWN: u64 = 0;
    /// The price feed is updating as expected.
    const TRADING: u64 = 1;
    /// The price feed is halted and should not be used for price discovery.
    const HALTED: u64 = 2;
    /// The price feed is in auction mode and should not be used for price discovery.
    const AUCTION: u64 = 3;

    /// PriceStatus represents the availability status of a price feed.
    /// Prices should only be used if they have a status of trading.
    struct PriceStatus has copy, drop, store {
        status: u64,
    }

    public fun from_u64(status: u64): PriceStatus {
        assert!(status <= AUCTION, 0);
        PriceStatus {
            status
        }
    }

    public fun get_status(price_status: &PriceStatus): u64 {
        price_status.status
    }

    public fun new_unknown(): PriceStatus {
        PriceStatus {
            status: UNKNOWN,
        }
    }

    public fun new_trading(): PriceStatus {
        PriceStatus {
            status: TRADING,
        }
    }

    public fun new_halted(): PriceStatus {
        PriceStatus {
            status: HALTED,
        }
    }

    public fun new_auction(): PriceStatus {
        PriceStatus {
            status: AUCTION,
        }
    }

    public fun is_trading(status: &PriceStatus): bool {
        status.status == TRADING
    }

    #[test]
    fun test_unknown_status() {
        assert!(PriceStatus{ status: UNKNOWN } == from_u64(0), 1);
    }

    #[test]
    fun test_trading_status() {
        assert!(PriceStatus{ status: TRADING } == from_u64(1), 1);
    }

    #[test]
    fun test_halted_status() {
        assert!(PriceStatus{ status: HALTED } == from_u64(2), 1);
    }

    #[test]
    fun test_auction_status() {
        assert!(PriceStatus{ status: AUCTION } == from_u64(3), 1);
    }

    #[test]
    #[expected_failure]
    fun test_invalid_price_status() {
        from_u64(4);
    }
}
