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

public struct ShopOwnerCap has key, store {
  id: UID,
  shop_id: address,
}

public struct ShopCreated has copy, drop {
  shop_id: address,
  owner_cap_id: address,
  owner: address,
}

public struct ShopOwnerUpdated has copy, drop {
  shop_id: address,
  new_owner: address,
}

public fun create_shop(name: string::String, ctx: &mut TxContext): (ID, ShopOwnerCap) {
  let owner = ctx.sender();
  let shop = Shop {
    id: object::new(ctx),
    name,
    owner,
    disabled: false,
  };
  let shop_id = shop.id.uid_to_address();
  let shop_object_id = shop.id.to_inner();
  let owner_cap = ShopOwnerCap { id: object::new(ctx), shop_id };
  let owner_cap_id = owner_cap.id.uid_to_address();

  event::emit(ShopCreated { shop_id, owner_cap_id, owner });
  transfer::share_object(shop);
  (shop_object_id, owner_cap)
}

public fun update_shop_owner(
  shop: &mut Shop,
  owner_cap: &ShopOwnerCap,
  new_owner: address,
) {
  let shop_id = shop.id.uid_to_address();
  assert!(owner_cap.shop_id == shop_id, EInvalidOwnerCap);
  shop.owner = new_owner;
  event::emit(ShopOwnerUpdated { shop_id, new_owner });
}
