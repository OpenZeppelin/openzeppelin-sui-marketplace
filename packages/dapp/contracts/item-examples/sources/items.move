#[allow(unused_field)]
module item_examples::items;

/// Example on-chain items for typed listings and receipts.
public struct Car has key, store {
    id: UID,
    wheels: u64,
    motor_type: vector<u8>,
}

public struct Bike has key, store {
    id: UID,
    gears: u8,
    brand: vector<u8>,
}

public struct ConcertTicket has key, store {
    id: UID,
    event_name: vector<u8>,
    seat_label: vector<u8>,
}

public struct DigitalPass has key, store {
    id: UID,
    tier: u8,
    issued_at_secs: u64,
}
