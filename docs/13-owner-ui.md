# 13 - Owner UI (Owner Console + Admin Flows)

**Path:** [Learning Path](./) > 13 Owner Console + Admin Flows

The UI includes owner-only flows to create and manage shops, listings, currencies, and discounts.

## 1. Learning goals
1. Understand how the UI detects shop ownership.
2. Map each owner action to a Move entry function.
3. See which UI components own each management flow.
4. Find the buyer flow doc for checkout and receipts.

## 2. Prerequisites
1. Localnet running.
2. `sui_oracle_market` published.
3. A Shop ID and an owner wallet that holds the ShopOwnerCap.
4. `packages/ui/.env.local` configured.

## 3. Run it
```bash
pnpm ui dev
```

## 4. Owner UI concept mapping (UI -> Move)
1. **Create shop** -> `shop::create_shop`
   - UI: `packages/ui/src/app/components/CreateShopModal.tsx`
   - Hook: `packages/ui/src/app/hooks/useCreateShopModalState.ts`
2. **Add listing** -> `shop::add_item_listing`
   - UI: `packages/ui/src/app/components/AddItemModal.tsx`
   - Hook: `packages/ui/src/app/hooks/useAddItemModalState.ts`
3. **Remove listing** -> `shop::remove_item_listing`
   - UI: `packages/ui/src/app/components/RemoveItemModal.tsx`
   - Hook: `packages/ui/src/app/hooks/useRemoveItemModalState.ts`
4. **Add currency** -> `shop::add_accepted_currency`
   - UI: `packages/ui/src/app/components/AddCurrencyModal.tsx`
   - Hook: `packages/ui/src/app/hooks/useAddCurrencyModalState.ts`
5. **Remove currency** -> `shop::remove_accepted_currency`
   - UI: `packages/ui/src/app/components/RemoveCurrencyModal.tsx`
   - Hook: `packages/ui/src/app/hooks/useRemoveCurrencyModalState.ts`
6. **Create discount template** -> `shop::create_discount_template`
   - UI: `packages/ui/src/app/components/AddDiscountModal.tsx`
   - Hook: `packages/ui/src/app/hooks/useAddDiscountModalState.ts`
7. **Remove discount template** -> `shop::prune_discount_claims` + marker removal
   - UI: `packages/ui/src/app/components/RemoveDiscountModal.tsx`
   - Hook: `packages/ui/src/app/hooks/useRemoveDiscountModalState.ts`

Buyer flows live in `docs/12-buyer-ui.md`.

## 5. Ownership detection
- The UI treats the wallet as the owner when `walletAddress == shopOwnerAddress`.
- The shop owner address is loaded from the Shop object via `useShopDashboardData`.
- This mirrors the on-chain rule that ownership is encoded in the Shop object and enforced by the
  ShopOwnerCap during mutations.
- UI gating is convenience only; on-chain enforcement always requires the `ShopOwnerCap` object.

Code:
- `packages/ui/src/app/hooks/useStoreDashboardViewModel.ts` (isShopOwner logic)
- `packages/ui/src/app/hooks/useShopDashboardData.tsx` (shop overview load)
- `packages/dapp/move/oracle-market/sources/shop.move` (Shop.owner field)

**Code spotlight: Shop owner is stored on-chain**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
entry fun update_shop_owner(
  shop: &mut Shop,
  owner_cap: &mut ShopOwnerCap,
  new_owner: address,
  ctx: &mut tx::TxContext,
) {
  assert_owner_cap(shop, owner_cap);

  let previous_owner: address = shop.owner;
  shop.owner = new_owner;
  owner_cap.owner = new_owner;

  event::emit(ShopOwnerUpdated {
    shop_address: shop_address(shop),
    previous_owner,
    new_owner,
    shop_owner_cap_id: obj::uid_to_address(&owner_cap.id),
    rotated_by: ctx.sender(),
  });
}
```

## 6. Exercises
1. Connect a non-owner wallet and confirm the owner controls are hidden. Expected outcome: only buyer actions are visible.
2. Connect the owner wallet and create a listing. Expected outcome: the new listing appears in the storefront.

## 7. Further reading (Sui docs)
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/concepts/sui-move-concepts

## 8. Navigation
1. Previous: [12 Buyer Flow + UI](./12-buyer-ui.md)
2. Next: [14 Advanced (execution model + upgrades)](./14-advanced.md)
3. Back to map: [Learning Path Map](./)
