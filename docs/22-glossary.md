# 22 - Glossary: Quick Reference

**Path:** [Learning Path](./) > 22 Glossary

1. **Object**: On-chain data with an ID. Objects can be owned or shared. See `packages/dapp/contracts/oracle-market/sources/shop.move`.
2. **Owned object**: An object tied to an address; transfers are explicit. Example: `ShopOwnerCap`.
3. **Shared object**: Mutable through consensus by anyone who includes it in a transaction, but
   module checks still decide what can change. Example: `Shop`, `AcceptedCurrency`, `DiscountTemplate`.
4. **Capability**: An owned object that proves authority. Example: `ShopOwnerCap`.
5. **Dynamic field**: A key-value table attached to an object. Used for currency/template markers and discount claims.
6. **PTB (Programmable Transaction Block)**: A multi-call transaction that sequences Move calls. See `packages/domain/core/src/flows/buy.ts`.
7. **`Coin<T>`**: A Move resource representing fungible tokens. No allowances; the coin object is passed into transactions.
8. **PriceInfoObject**: Pyth's on-chain price object. Identifies a feed + price data.
9. **Guardrail**: On-chain validation rule for oracle freshness, confidence, or status.
10. **TypeName / type tag**: On-chain representation of a Move type used for typed listings and coin types.
11. **Ability**: A keyword that describes how a type can be stored and moved (`key`, `store`, `copy`, `drop`).
12. **TxContext**: Transaction context passed to entry functions for object creation and coin splits.
13. **Entry function**: A Move function callable by a transaction (PTB). It can be read-only or mutating.
14. **Publisher**: A publish-time object created by `init` that identifies the package publisher.
15. **Address-owned object**: An object owned by a specific address; only that address can use it in a transaction.
16. **Object-owned object**: An object owned by another object (common for dynamic-field children).
17. **Immutable object**: An object with no mutable owner; it can be read by anyone but cannot be mutated.
18. **UpgradeCap**: An owned object that authorizes package upgrades.
19. **Object version**: The version number recorded on an object after each mutation; used to verify freshness.
20. **Storage rebate**: A refund of storage fees when an object is deleted (e.g., `coin::destroy_zero`).
21. **Fastpath**: The low-latency execution path used by address-owned objects when no shared objects are involved.
22. **Consensus object**: A shared object that must be sequenced by consensus.

**Code spotlight: objects are structs with `key`**
`packages/dapp/contracts/oracle-market/sources/shop.move`
```move
public struct Shop has key, store {
  id: UID,
  owner: address,
  name: string::String,
  disabled: bool,
}
```

## Navigation
1. Previous: [21 Troubleshooting](./21-troubleshooting.md)
2. Start the path: [00 Setup + Quickstart](./00-setup.md)
3. Back to map: [Learning Path Map](./)
