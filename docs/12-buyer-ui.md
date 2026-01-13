# 12 - Buyer UI (Buyer Flow)

**Path:** [Learning Path](./) > 12 Buyer Flow + UI

This chapter shows the PTB buy flow and the UI path that mirrors it.

## 1. Learning goals
1. Build a buy transaction that updates Pyth and purchases in one PTB.
2. Understand coin objects as payment inputs.
3. Run the UI and see shared vs owned data in the dashboard.

## 2. Prereqs
1. Localnet running.
2. A Shop with listings and at least one accepted currency.
3. Optionally, a discount template to test the discount path.

## 3. Run it (CLI buy)
```bash
pnpm script buyer:buy \
  --shop-id <shopId> \
  --item-listing-id <listingId> \
  --coin-type <coinType>

pnpm script buyer:buy \
  --shop-id <shopId> \
  --item-listing-id <listingId> \
  --coin-type <coinType> \
  --discount-template-id <templateId> \
  --claim-discount
```

## 4. Run it (UI)
```bash
# packages/ui/.env.local
# NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
# NEXT_PUBLIC_LOCALNET_SHOP_ID=0x...

pnpm ui dev
```

## 5. EVM -> Sui translation
1. **approve + transferFrom -> move a `Coin<T>`**: you pass the coin object into the PTB; change is returned as a new coin object. When paying with SUI, you need a separate SUI coin for gas. See `buildBuyTransaction` in `packages/domain/core/src/flows/buy.ts`.
2. **Oracle update + buy -> single PTB**: the transaction updates Pyth and buys in one block. See `maybeUpdatePythPriceFeed` in `packages/domain/core/src/flows/buy.ts`.
3. **Localnet signing**: the UI signs in the wallet but executes through the app RPC client to avoid network mismatches. See `packages/ui/src/app/hooks/useBuyFlowModalState.ts`.

## 6. Concept deep dive: PTB and wallet execution
- **Programmable Transaction Blocks (PTBs)**: a PTB is a single transaction that chains multiple
  Move calls. Here, the PTB updates the oracle and then calls `buy_item` in the same block.
  Code: `packages/domain/core/src/flows/buy.ts` (`buildBuyTransaction`)
- **Quote before you spend**: the UI can dev-inspect `quote_amount_for_price_info_object` to
  estimate the required payment amount without mutating state.
  Code: `packages/domain/core/src/flows/buy.ts` (`estimateRequiredAmount`)
- **Sign vs execute split**: on localnet, the UI uses `signTransaction` and then executes the
  transaction via the app's RPC client. This avoids the wallet sending the transaction to the
  wrong network.
  Code: `packages/ui/src/app/hooks/useBuyFlowModalState.ts`
- **Price update policy**: for localnet/testnet/mainnet, the UI requires a Pyth update to be added
  to the PTB; for other networks it can be auto/skip. This keeps pricing deterministic and fresh.
  Code: `packages/ui/src/app/hooks/useBuyFlowModalState.ts`
- **Shared vs owned reads in UI**: storefront data comes from shared objects (listings, currencies,
  templates). Wallet data comes from owned objects (tickets, receipts).
  Code: `packages/ui/src/app/hooks/useShopDashboardData.tsx`

## 7. UI map (buyer path)
1. **Storefront view**: `packages/ui/src/app/components/StoreDashboard.tsx`
2. **Buy flow modal**: `packages/ui/src/app/components/BuyFlowModal.tsx`
3. **Shop selection**: `packages/ui/src/app/components/ShopSelection.tsx`
4. **Owner flows**: see `docs/13-owner-ui.md`

## 8. Code references
1. `packages/domain/core/src/flows/buy.ts` (buy transaction builder + Pyth update)
2. `packages/dapp/move/oracle-market/sources/shop.move` (buy_item, buy_item_with_discount)
3. `packages/dapp/src/scripts/buyer/buy.ts` (CLI buy flow)
4. `packages/ui/src/app/hooks/useBuyFlowModalState.ts` (UI PTB execution)
5. `packages/ui/src/app/hooks/useShopDashboardData.tsx` (shared vs owned reads)
6. PTB builder definition: `packages/domain/core/src/flows/buy.ts` (buildBuyTransaction)

**Code spotlight: buy entry points accept `Coin<T>` and PriceInfoObject**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
public entry fun buy_item<TItem: store, TCoin>(
  shop: &Shop,
  item_listing: &mut ItemListing,
  accepted_currency: &AcceptedCurrency,
  price_info_object: &price_info::PriceInfoObject,
  payment: coin::Coin<TCoin>,
  mint_to: address,
  refund_extra_to: address,
  max_price_age_secs: Option<u64>,
  max_confidence_ratio_bps: Option<u64>,
  clock: &clock::Clock,
  ctx: &mut tx::TxContext,
) {
  assert_shop_active(shop);
  assert_listing_matches_shop(shop, item_listing);
  let base_price_usd_cents: u64 = item_listing.base_price_usd_cents;
  process_purchase<TItem, TCoin>(
    shop,
    item_listing,
    accepted_currency,
    price_info_object,
    payment,
    mint_to,
    refund_extra_to,
    base_price_usd_cents,
    opt::none(),
    max_price_age_secs,
    max_confidence_ratio_bps,
    clock,
    ctx,
  );
}
```

**Code spotlight: CLI buy flow resolves pricing + payment inputs**
`packages/dapp/src/scripts/buyer/buy.ts`
```ts
const acceptedCurrencyMatch = await requireAcceptedCurrencyByCoinType({
  coinType: inputs.coinType,
  shopId: inputs.shopId,
  suiClient: tooling.suiClient
})

const acceptedCurrencySummary = await getAcceptedCurrencySummary(
  inputs.shopId,
  acceptedCurrencyMatch.acceptedCurrencyId,
  tooling.suiClient
)

const pythPriceInfoObjectId = normalizeIdOrThrow(
  acceptedCurrencySummary.pythObjectId,
  `AcceptedCurrency ${acceptedCurrencySummary.acceptedCurrencyId} is missing a pyth_object_id.`
)

const listingSummary = await getItemListingSummary(
  inputs.shopId,
  inputs.itemListingId,
  tooling.suiClient
)

const paymentCoinObjectId = await resolvePaymentCoinObjectId({
  providedCoinObjectId: inputs.paymentCoinObjectId,
  coinType: inputs.coinType,
  signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
  suiClient: tooling.suiClient
})

const discountContext = await resolveDiscountContext({
  claimDiscount: inputs.claimDiscount,
  discountTicketId: inputs.discountTicketId,
  discountTemplateId: inputs.discountTemplateId,
  suiClient: tooling.suiClient
})
```

## 9. Exercises
1. Pay with SUI while you only have one SUI coin object. Expected outcome: error explaining you need a second coin for gas in `packages/domain/core/src/flows/buy.ts`.
2. Buy an item from the UI and verify a `ShopItem` receipt appears in the wallet panel. Expected outcome: receipt IDs listed in the UI.

## 10. Diagram: buy PTB
```
PTB
  1) pyth::update_price_feeds
  2) shop::buy_item (or claim_and_buy_item_with_discount)
  3) emit events + mint ShopItem
```

## 11. Further reading (Sui docs)
- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://docs.sui.io/guides/developer/objects/object-ownership

## 12. Navigation
1. Previous: [11 UI reference (setup + localnet execution)](./11-ui-reference.md)
2. Next: [13 Owner Console + Admin Flows](./13-owner-ui.md)
3. Back to map: [Learning Path Map](./)
