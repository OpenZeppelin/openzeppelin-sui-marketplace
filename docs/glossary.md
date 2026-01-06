# Glossary: Quick Reference

**Path:** [Learning Path](./) > Glossary

1. **Object**: On-chain data with an ID. Objects can be owned or shared. See `packages/dapp/move/oracle-market/sources/shop.move`.
2. **Owned object**: An object tied to an address; transfers are explicit. Example: `ShopOwnerCap`.
3. **Shared object**: Mutable by anyone through consensus. Example: `Shop` and `ItemListing`.
4. **Capability**: An owned object that proves authority. Example: `ShopOwnerCap`.
5. **Dynamic field**: A key-value table attached to an object. Used to index listings and currencies under `Shop`.
6. **PTB (Programmable Transaction Block)**: A multi-call transaction that sequences Move calls. See `packages/domain/core/src/flows/buy.ts`.
7. **Coin<T>**: A Move resource representing fungible tokens. No allowances; the coin object is passed into transactions.
8. **PriceInfoObject**: Pyth's on-chain price object. Identifies a feed + price data.
9. **Guardrail**: On-chain validation rule for oracle freshness, confidence, or status.
10. **TypeInfo / type tag**: On-chain representation of a Move type used for typed listings and coin types.
11. **Ability**: A keyword that describes how a type can be stored and moved (`key`, `store`, `copy`, `drop`).
12. **TxContext**: Transaction context passed to entry functions for object creation and coin splits.
13. **Entry function**: A Move function callable by a transaction that can mutate state.
14. **View function**: A read-only Move function (often via `#[ext(view)]`) used with dev-inspect.
15. **Publisher**: A publish-time object created by `init` that identifies the package publisher.
16. **Address-owned object**: An object owned by a specific address; only that address can use it in a transaction.
17. **Object-owned object**: An object owned by another object (common for dynamic-field children).
18. **Immutable object**: An object with no mutable owner; it can be read by anyone but cannot be mutated.
19. **UpgradeCap**: An owned object that authorizes package upgrades.
20. **Object version**: The version number recorded on an object after each mutation; used to verify freshness.
21. **Storage rebate**: A refund of storage fees when an object is deleted (e.g., `coin::destroy_zero`).
22. **Party object**: An object owned by a defined party and versioned by consensus.
23. **Fastpath**: The low-latency execution path used by address-owned or immutable objects when no consensus objects are involved.
24. **Consensus object**: A shared or party-owned object that must be sequenced by consensus.

## Navigation
1. Start the path: [01 Mental Model Shift](./01-intro.md)
2. Back to map: [Learning Path Map](./)
