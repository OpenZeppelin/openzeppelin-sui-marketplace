# 03 - EVM → Sui Cheatsheet (and shared networks)

**Path:** [Learning Path](./) > 03 EVM → Sui Cheatsheet

This is a compact reference for common EVM-to-Sui translation points, plus a checklist for moving from localnet to shared networks.

## 1. Sui concepts for EVM developers

- **Packages are immutable objects**: publishing creates a package object; upgrades publish a new package + `UpgradeCap`.
- **Capabilities instead of `msg.sender`**: auth is proved by owning capability objects (e.g., `ShopOwnerCap`).
- **Objects, not contract storage**: state lives in owned/shared objects and dynamic fields.
- **Ownership types are explicit**: address-owned, shared, object-owned, and immutable objects are first-class.
- **Typed coins**: `Coin<T>` replaces ERC-20 approvals; you pass coin objects into the PTB.
- **Oracles as objects**: Pyth prices arrive as `PriceInfoObject` + clock checks.
- **No inheritance; use modules + generics**: Move composition replaces inheritance.
- **PTBs for runtime composition**: you compose workflows client-side into a single atomic transaction.
- **Localnet vs testnet/mainnet**: localnet can use unpublished deps and dep replacements; shared networks require real dependency package IDs.

## 2. Deep dive: how it maps to EVM mental models

| Topic | EVM | Sui |
| --- | --- | --- |
| Package/contract | Immutable bytecode at an address, often proxied | Immutable package object; upgrades publish new package + `UpgradeCap` |
| Auth | `msg.sender` + modifiers | Capability objects (e.g., `ShopOwnerCap`) must be presented |
| State | Contract storage slots | Owned/shared objects + dynamic fields |
| Tokens | ERC-20 approvals | `Coin<T>` types; no approvals |
| Oracles | Chainlink contracts queried by address | Pyth `PriceInfoObject` passed into tx + clock guardrails |
| Local dev | Hardhat/Anvil | `sui start` localnet + mocks as packages |
| Migrations | Scripts calling contracts | Publish + seed scripts that create objects |
| Inheritance | Multiple inheritance + polymorphism | Modules + generics |
| Composition | On-chain router contracts | Client-side PTBs chain calls atomically |

## 3. Further reading
- https://docs.sui.io
- https://docs.sui.io/concepts/sui-move-concepts
- https://docs.sui.io/guides/developer/objects/object-model
- https://docs.sui.io/references/framework/sui_sui/coin_registry
- https://docs.sui.io/guides/developer/app-examples/oracle
- https://docs.sui.io/concepts/sui-for-ethereum

## 4. Navigation
1. Previous: [02 Mental Model Shift](./02-mental-model-shift.md)
2. Next: [16 Object Ownership + Versioning](./16-object-ownership.md)
3. Back to map: [Learning Path Map](./)
