module simple_contract::shop;

use std::string;
use sui::event;

const EInvalidOwnerCap: u64 = 1;

public struct Shop has key {
  id: UID,
  name: string::String,
  owner: address,
  disabled: bool,
}

public struct ShopOwnerCap has key {
  id: UID,
  shop_id: address,
}

public struct ShopCreated has copy, drop {
  shop_id: address,
  shop_owner_cap_id: address,
  owner: address,
  name: vector<u8>,
}

public struct ShopOwnerUpdated has copy, drop {
  shop_id: address,
  new_owner: address,
}

entry fun create_shop(name: vector<u8>, ctx: &mut TxContext) {
  let owner = ctx.sender();
  let shop = Shop {
    id: object::new(ctx),
    name: string::utf8(name),
    owner,
    disabled: false,
  };
  let shop_id = object::uid_to_address(&shop.id);
  let owner_cap = ShopOwnerCap { id: object::new(ctx), shop_id };
  let owner_cap_id = object::uid_to_address(&owner_cap.id);

  transfer::share_object(shop);
  transfer::transfer(owner_cap, owner);
  event::emit(ShopCreated {
    shop_id,
    shop_owner_cap_id: owner_cap_id,
    owner,
    name,
  });
}

entry fun update_shop_owner(
  shop: &mut Shop,
  owner_cap: ShopOwnerCap,
  new_owner: address,
) {
  let shop_id = object::uid_to_address(&shop.id);
  assert!(owner_cap.shop_id == shop_id, EInvalidOwnerCap);
  shop.owner = new_owner;
  transfer::transfer(owner_cap, new_owner);
  event::emit(ShopOwnerUpdated { shop_id, new_owner });
}
