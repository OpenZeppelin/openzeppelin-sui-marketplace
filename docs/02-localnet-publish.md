# 02 - Localnet + Publish

**Path:** [Learning Path](./) > 02 Localnet + Publish

This chapter gets a local chain running, seeds mocks, and publishes the Move package.

## 1. Learning goals
1. Start a localnet with faucet and stable state.
2. Seed mock Pyth + coin packages for local development.
3. Publish `sui_oracle_market` and understand artifacts.

## 2. Prereqs
1. Sui CLI installed and on PATH.
2. A funded local address in the Sui CLI keystore.

## 3. Run it
```bash
pnpm script chain:localnet:start --with-faucet
pnpm script mock:setup --buyer-address <0x...>
pnpm script move:publish --package-path oracle-market
```

## 4. EVM -> Sui translation
1. **Hardhat local node -> Sui localnet**: localnet is a full chain with shared objects and versions, not a global in-memory state. See `packages/dapp/src/scripts/chain/localnet-start.ts`.
2. **Mock contracts -> mock packages**: on Sui, mocks are real packages with real objects. See `packages/dapp/move/pyth-mock` and `packages/dapp/move/coin-mock`.
3. **Deploy -> publish**: publish creates a package object; your stateful instance comes later via `create_shop`. See `packages/dapp/src/scripts/move/publish.ts`.

## 5. Concept deep dive: packages and publish flow
- **Packages are objects**: publishing creates an immutable package object plus an `UpgradeCap`.
  Unlike Solidity, there is no mutable code slot. New versions are new package IDs, and callers
  must opt into the new ID explicitly.
  Code: `packages/dapp/src/scripts/move/publish.ts`
- **UpgradeCap + artifacts**: the publish script writes `deployment.<network>.json` with the
  package ID, `UpgradeCap`, and `Publisher` IDs. Treat the `UpgradeCap` like admin authority.
  Code: `packages/dapp/deployments/deployment.localnet.json`
- **Module initializer and Publisher**: this module claims a Publisher object at publish time using
  an init witness. This is a publish-time side effect, not a runtime admin check, and it demonstrates
  how publish-time data can be anchored to the package.
  Code: `packages/dapp/move/oracle-market/sources/shop.move` (`init`, `claim_publisher`)
- **Localnet dep replacements**: the Move.toml `dep-replacements.localnet` swaps Pyth to the mock
  package so localnet runs without real oracles.
  Code: `packages/dapp/move/oracle-market/Move.toml`
- **Localnet regenesis**: localnet state (and object IDs) are tied to its config dir and CLI
  version. If you regenesis (`--force-regenesis`), all IDs change and artifacts are cleared.
  Code: `packages/dapp/src/scripts/chain/localnet-start.ts`

## 6. Code references
1. `packages/dapp/src/scripts/chain/localnet-start.ts` (localnet lifecycle)
2. `packages/dapp/src/scripts/mock/setup.ts` (mock Pyth + coins)
3. `packages/dapp/src/scripts/move/publish.ts` (publish and artifacts)
4. `packages/dapp/move/oracle-market/Move.toml` (dep-replacements.localnet)

## 7. Exercises
1. Inspect `packages/dapp/deployments/deployment.localnet.json` and find the `packageId` for `sui_oracle_market`. Expected outcome: you can copy the package ID for later scripts.
2. Inspect `packages/dapp/deployments/mock.localnet.json` and find the `priceInfoObjectId`. Expected outcome: you can use it when registering accepted currencies.

## 8. Diagram: publish + artifacts
```
publish (Move package)
  -> packageId (immutable)
  -> upgradeCap
  -> deployment.<network>.json

create_shop (later)
  -> Shop (shared object)
  -> ShopOwnerCap (owned object)
```

## 9. Further reading (Sui docs)
- https://docs.sui.io/concepts/sui-move-concepts/packages
- https://docs.sui.io/concepts/sui-move-concepts/packages/upgrade
- https://docs.sui.io/concepts/sui-move-concepts

## 10. Navigation
1. Previous: [01 Mental Model Shift](./01-intro.md)
2. Next: [03 Shop Object + Capability Auth](./03-shop-capabilities.md)
3. Back to map: [Learning Path Map](./)
