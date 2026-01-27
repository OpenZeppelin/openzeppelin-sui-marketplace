## 1. Document Purpose

This document defines the formal framework for testing and accepting the `sui_oracle_market` dApp. It ensures that the Move smart contracts, deployment orchestration, and frontend integration meet the architectural requirements for a production-ready demonstration of Sui's object-centric capabilities.

## 2. System Overview

The Sui  Marketplace illustrates a USD-pegged commerce model utilizing Pyth Network oracles. Key architectural features include:

- **Object-Centric Design:** State is stored in shared `Shop` objects and dynamic fields.
- **Capability-Based Security:** Administrative actions require the `ShopOwnerCap`.
- **Oracle Integration:** Price conversion via Pyth `PriceInfoObject`.
- **Linear Types:** Purchase receipts (`ShopItem`) ensuring "at-most-once" redemption logic.

## 3. Prerequisites for Testing

- **Environment:** Node.js v22.19+, pnpm, Rust toolchain.
- **Sui CLI:** Version 1.63.x or newer.
- **Localnet:** Active local node with faucet enabled.
- **Wallet:** Slush Wallet or Sui Wallet (for UI testing).

## 4. Test Suite 1: Infrastructure and Environment

| Test ID | Description | Procedure | Expected Result |
| --- | --- | --- | --- |
| INF-01 | Workspace Integrity | Run `pnpm install` at root. | All dependencies resolve; `packages/dapp` and `packages/ui` are linked. |
| INF-02 | Localnet Initialization | Run `pnpm script chain:localnet:start --with-faucet`. | RPC reaches readiness; local faucet funds the active signer. |
| INF-03 | Mock Environment Seeding | Run `pnpm script mock:setup --buyer-address <0x...>`. | `pyth-mock` and `coin-mock` published; artifacts written to `mock.localnet.json`. |

## 5. Test Suite 2: Smart Contract Deployment (Move)

| Test ID | Description | Procedure | Expected Result |
| --- | --- | --- | --- |
| MOV-01 | Package Publication | Run `pnpm script move:publish --package-path oracle-market`. | Package ID generated; `deployment.localnet.json` updated with correct bytecode. |
| MOV-02 | Immutability & Upgrades | Inspect `UpgradeCap` in artifacts. | `UpgradeCap` is held by the deployer, enabling future gated upgrades. |

## 6. Test Suite 3: Commerce Lifecycle (Owner Operations)

| Test ID | Description | Procedure | Expected Result |
| --- | --- | --- | --- |
| OWN-01 | Shop Creation | Run `pnpm script owner:shop:create`. | Shared `Shop` object created; `ShopOwnerCap` issued to signer. |
| OWN-02 | Currency Registration | Run `owner:currency:add` with a mock Pyth Feed ID. | `AcceptedCurrency` dynamic field added to `Shop`; oracle constraints (age, confidence) set. |
| OWN-03 | Inventory Management | Run `owner:item-listing:add` with a Move struct type. | `ItemListing` created; stock count and price (USD cents) verified on-chain. |
| OWN-04 | Discount Logic | Create and attach a `DiscountTemplate` to a listing. | Template linked; listing reflects the active discount spotlight. |

## 7. Test Suite 4: Oracle and Purchase (Buyer Operations)

| Test ID | Description | Procedure | Expected Result |
| --- | --- | --- | --- |
| BUY-01 | Price Freshness | Run `mock:update-prices`. | Mock Pyth `PriceInfoObject` timestamps updated to current epoch. |
| BUY-02 | Shop Discovery | Run `buyer:shop:view`. | Full snapshot of listings, prices, and accepted currencies retrieved. |
| BUY-03 | Atomic Checkout | Run `buyer:buy` for a listed item using mock SUI/USDC. | Transaction succeeds; `ShopItem` receipt minted to buyer; stock decremented. |
| BUY-04 | Security Constraint | Attempt `buyer:buy` with stale oracle price. | Transaction aborts with error code mapping to `EPriceTooStale`. |

## 8. Test Suite 5: Frontend Integration (UI)

| Test ID | Description | Procedure | Expected Result |
| --- | --- | --- | --- |
| UI-01 | Localnet Signing | Connect wallet to `pnpm ui dev` on Localnet. | App utilizes `signTransaction` + local RPC execution to avoid network mismatch. |
| UI-02 | Real-time Pricing | Select an item in the UI. | Price in native tokens updates dynamically based on the latest Pyth feed data. |

## 9. Security and Best Practices Verification

- **Capability Guarding:** Verify that only the holder of `ShopOwnerCap` can call `update_shop_owner` or `add_listing`.
- **Reentrancy Protection:** Sui's execution model inherently prevents EVM-style reentrancy; verify that the "Flash Loan" or "Receipt" pattern is used for complex interactions.
- **Arithmetic Safety:** Verify use of `sui::math` or fixed-point arithmetic for price conversions to prevent overflow/underflow.
- **Move Code Best Practices**: Code provided follows Move Code conventions as specified on the [Sui Documentation website](https://docs.sui.io/concepts/sui-move-concepts/conventions), code is written in a modular manner, and the [Code Quality Checklist](https://move-book.com/guides/code-quality-checklist/).
- **Architecture**: showcases best practices for using objects and collections on Sui.
- **Naming Conventions**: Uses Move 2024 syntax at the fullest, and uses existing naming conventions used in Sui/Move.
- **Dependencies**: On-chain dependencies, such as Pyth, are used directly on-chain, instead of being mocked, on testnet.
- **Testing**: App works on both testnet and mainnet.
- **Documentation**: Fully documented app, EVM to Sui documentation, with no contradictions with Sui/Move existing documentation.

## 10. Acceptance Criteria

1. All **INF** and **MOV** tests pass with zero errors.
2. The `ShopItem` receipt is successfully issued following a valid `buy` command.
3. Oracle guardrails correctly prevent purchases when price data is outside specified confidence intervals.
4. The UI correctly executes transactions on localnet using the custom RPC path defined in the developer guide.