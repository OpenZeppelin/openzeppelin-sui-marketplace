# 17 - PTBs + Gas + Fees

**Path:** [Learning Path](./) > 17 PTBs + Gas + Fees

This chapter explains programmable transaction blocks (PTBs), gas coin handling, and storage fees, then maps those ideas to this repo's buy flow.

## 1. Learning goals
1. Understand PTBs as the Sui-native way to compose calls atomically.
2. Learn why gas coins are separate objects and how SUI payments affect gas selection.
3. Connect storage fees and rebates to how the shop handles change and coin cleanup.

## 2. Prerequisites
1. A basic understanding of the buyer flow in `docs/12-buyer-ui.md`.
2. Localnet optional if you want to run examples.

## 3. EVM -> Sui translation
1. **Router contracts -> client PTBs**: you build the transaction client-side rather than shipping a new on-chain router for every workflow.
2. **Gas as balance -> gas as object**: gas is a `Coin<SUI>` object. You choose which coin pays gas.
3. **Gas refunds -> storage rebates**: deleting objects returns storage fees; coin cleanup matters.

## 4. Concept deep dive: PTBs
- **Command limit**: a PTB can include up to 1,024 commands, which shapes batching strategies.
- **Atomicity**: if any command fails, the entire PTB aborts.
- **View-only flows**: `devInspect` lets you call view functions or simulate transactions without mutating state.

Code: `packages/domain/core/src/flows/buy.ts` (`buildBuyTransaction`, `estimateRequiredAmount`)

## 5. Concept deep dive: gas coins and SUI payments
- **Separate gas coin (repo choice)**: when paying with SUI, the flow keeps a dedicated gas coin to avoid mixing payment and gas; custom PTBs can split from the gas coin instead.
- **Coin splitting**: Move conventions prefer passing an exact-amount coin by value. This repo instead splits a payment coin inside the PTB and returns change.
- **Gas smashing**: Sui can combine gas coins for efficiency, but you still must provide a valid gas coin in the transaction.
- **Sponsored transactions (optional)**: a sponsor can pay gas for another signer, which is useful for onboarding flows.

Code: `packages/domain/core/src/flows/buy.ts` (`maybeSetDedicatedGasForSuiPayments`)

## 6. Concept deep dive: storage fees and rebates
- **Storage fees**: object creation and mutation carry storage cost.
- **Storage rebates**: deleting objects returns part of the storage cost.
- **Why it matters here**: `finalize_purchase_transfers` explicitly destroys zero-value coins to reclaim storage.

Code: `packages/dapp/move/oracle-market/sources/shop.move` (`finalize_purchase_transfers`)

**Code spotlight: refund or destroy change**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
fun finalize_purchase_transfers<TItem: store, TCoin>(
  owed_coin_opt: option::Option<coin::Coin<TCoin>>,
  change_coin: coin::Coin<TCoin>,
  minted_item: ShopItem<TItem>,
  payout_to: address,
  refund_extra_to: address,
  mint_to: address,
) {
  if (option::is_some(&owed_coin_opt)) {
    let owed_coin = option::destroy_some(owed_coin_opt);
    transfer::public_transfer(owed_coin, payout_to);
  } else {
    option::destroy_none(owed_coin_opt);
  };
  if (change_coin.value() == 0) {
    change_coin.destroy_zero();
  } else {
    transfer::public_transfer(change_coin, refund_extra_to);
  };
  transfer::public_transfer(minted_item, mint_to);
}
```

## 7. Exercises
1. Buy with SUI and only one SUI coin object. Expected outcome: the script explains this flow expects a dedicated payment coin.
2. Run a `devInspect` quote with `estimateRequiredAmount` and compare it to the actual purchase. Expected outcome: quote is conservative (mu-sigma) and sufficient for the buy.

## 8. Diagram: buy PTB
```
PTB
  1) update Pyth price feed (optional)
  2) buy_item or claim_and_buy_item_with_discount
  3) pay owner (convention prefers exact-amount coin; this repo may split and return change)
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://docs.sui.io/concepts/transactions/gas-smashing
- https://docs.sui.io/concepts/transactions/sponsored-transactions
- https://docs.sui.io/concepts/tokenomics/gas-in-sui
- https://docs.sui.io/concepts/transactions/transaction-lifecycle

## 10. Navigation
1. Previous: [10 Discounts + Tickets](./10-discounts-tickets.md)
2. Next: [11 UI reference (setup + localnet execution)](./11-ui-reference.md)
3. Back to map: [Learning Path Map](./)
