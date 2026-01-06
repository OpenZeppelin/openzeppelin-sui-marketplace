# 10 - PTBs + Gas + Fees

**Path:** [Learning Path](./) > 10 PTBs + Gas + Fees

This chapter explains programmable transaction blocks (PTBs), gas coin handling, and storage fees, then maps those ideas to this repo's buy flow.

## 1. Learning goals
1. Understand PTBs as the Sui-native way to compose calls atomically.
2. Learn why gas coins are separate objects and how SUI payments affect gas selection.
3. Connect storage fees and rebates to how the shop handles change and coin cleanup.

## 2. Prereqs
1. A basic understanding of the buyer flow in `docs/07-buyer-ui.md`.
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
- **Separate gas coin**: when paying with SUI, you need one coin for gas and a different coin for payment.
- **Coin splitting**: payments are made by splitting coins inside the PTB; change is returned as a new coin object.
- **Gas smashing**: Sui can combine gas coins for efficiency, but you still must provide a valid gas coin in the transaction.
- **Sponsored transactions (optional)**: a sponsor can pay gas for another signer, which is useful for onboarding flows.

Code: `packages/domain/core/src/flows/buy.ts` (`maybeSetDedicatedGasForSuiPayments`)

## 6. Concept deep dive: storage fees and rebates
- **Storage fees**: object creation and mutation carry storage cost.
- **Storage rebates**: deleting objects returns part of the storage cost.
- **Why it matters here**: `refund_or_destroy` explicitly destroys zero-value coins to reclaim storage.

Code: `packages/dapp/move/oracle-market/sources/shop.move` (`refund_or_destroy`)

## 7. Exercises
1. Buy with SUI and only one SUI coin object. Expected outcome: the script explains you need a second SUI coin for gas.
2. Run a `devInspect` quote with `estimateRequiredAmount` and compare it to the actual purchase. Expected outcome: quote is conservative (mu-sigma) and sufficient for the buy.

## 8. Diagram: buy PTB
```
PTB
  1) update Pyth price feed (optional)
  2) buy_item or claim_and_buy_item_with_discount
  3) split payment coin -> pay owner + return change
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://docs.sui.io/concepts/transactions/gas-smashing
- https://docs.sui.io/concepts/transactions/sponsored-transactions
- https://docs.sui.io/concepts/tokenomics/gas-in-sui
- https://docs.sui.io/concepts/transactions/transaction-lifecycle

## 10. Navigation
1. Previous: [09 Object Ownership + Versioning](./09-object-ownership.md)
2. Next: [11 Data Access + Indexing](./11-data-access.md)
3. Back to map: [Learning Path Map](./)
