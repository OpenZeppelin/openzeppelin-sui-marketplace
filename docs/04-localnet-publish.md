# 04 - Localnet + Publish

**Path:** [Learning Path](./) > 04 Localnet + Publish

This chapter gets a local chain running, seeds mocks, and publishes the Move package.

## 1. Learning goals
1. Start a localnet with faucet and stable state.
2. Seed mock Pyth + coin packages for local development.
3. Publish `sui_oracle_market` and understand artifacts.

## 2. Prerequisites
1. Sui CLI installed and on PATH.
2. A funded local address in the Sui CLI keystore.

## 3. Run it
```bash
pnpm script chain:localnet:start --with-faucet
pnpm script mock:setup --buyer-address <0x...> --network localnet
pnpm script move:publish --package-path oracle-market
```

## 4. EVM -> Sui translation
1. **Hardhat local node -> Sui localnet**: localnet is a full chain with shared objects and versions, not a global in-memory state. See `packages/dapp/src/scripts/chain/localnet-start.ts`.
2. **Mock contracts -> mock packages**: on Sui, mocks are real packages with real objects. See `packages/dapp/contracts/pyth-mock` and `packages/dapp/contracts/coin-mock`.
3. **Deploy -> publish**: publish creates a package object; your stateful instance comes later via `create_shop`. See `packages/dapp/src/scripts/move/publish.ts`.

## 5. Concept deep dive: packages and publish flow
- **Packages are objects**: publishing creates an immutable package object plus an `UpgradeCap`.
  Unlike Solidity, there is no mutable code slot. New versions are new package IDs, and callers
  must opt into the new ID explicitly.
  Code: `packages/dapp/src/scripts/move/publish.ts`
- **UpgradeCap + artifacts**: the publish script writes `deployment.<network>.json` with the
  package ID, `UpgradeCap`, and `Publisher` IDs. Treat the `UpgradeCap` like admin authority.
  Code: `packages/dapp/deployments/deployment.localnet.json`
- **Module initializer and Publisher**: this module claims the Publisher object at publish time using
  an init witness. This is a publish-time side effect, not a runtime admin check, and it demonstrates
  how publish-time data can be anchored to the package.
  Code: `packages/dapp/contracts/oracle-market/sources/shop.move` (`init`, `package::claim_and_keep`)
- **Localnet dep replacements**: the Move.toml `dep-replacements.test-publish` swaps Pyth to the mock
  package so localnet runs without real oracles.
  Code: `packages/dapp/contracts/oracle-market/Move.toml`
- **Localnet regenesis**: localnet state (and object IDs) are tied to its config dir and CLI
  version. If you regenesis (`--force-regenesis`), all IDs change and artifacts are cleared.
  Code: `packages/dapp/src/scripts/chain/localnet-start.ts`

## 6. Code references
1. `packages/dapp/src/scripts/chain/localnet-start.ts` (localnet lifecycle)
2. `packages/dapp/src/scripts/mock/setup.ts` (mock Pyth + coins)
3. `packages/dapp/src/scripts/move/publish.ts` (publish and artifacts)
4. `packages/dapp/contracts/oracle-market/Move.toml` (dep-replacements.test-publish)

**Code spotlight: localnet lifecycle guardrails**
`packages/dapp/src/scripts/chain/localnet-start.ts`
```ts
if (probeResult.status === "running") {
  if (forceRegenesis) {
    throw new Error(
      "Localnet is already running. Stop it before using --force-regenesis (pnpm script chain:localnet:stop)."
    )
  }

  logSimpleGreen("Localnet running")
  logRpcSnapshot(probeResult.snapshot, withFaucet)
  await maybeFundAfterRegenesis({
    forceRegenesis: false,
    withFaucet,
    tooling
  })
  return
}
```

**Code spotlight: publish flow entry**
`packages/dapp/src/scripts/move/publish.ts`
```ts
const fullPackagePath = resolveFullPackagePath(
  path.resolve(tooling.suiConfig.paths.move),
  cliArguments.packagePath
)

const deploymentArtifacts = await loadDeploymentArtifacts(
  tooling.suiConfig.network.networkName
)

if (
  await shouldSkipPublish(
    tooling,
    cliArguments.rePublish,
    deploymentArtifacts,
    fullPackagePath
  )
) {
  logSkippedPublish(tooling.suiConfig.network.networkName, fullPackagePath)
  return
}

await publishPackageToNetwork(
  tooling,
  fullPackagePath,
  derivePublishOptions(tooling.suiConfig.network.networkName, cliArguments)
)
```

**Code spotlight: publish-time init + Publisher**
`packages/dapp/contracts/oracle-market/sources/shop.move`
```move
public struct SHOP has drop {}

fun init(publisher_witness: SHOP, ctx: &mut TxContext) {
  package::claim_and_keep<SHOP>(publisher_witness, ctx);
}
```

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
1. Previous: [16 Object Ownership + Versioning](./16-object-ownership.md)
2. Next: [05 Localnet workflow (end-to-end)](./05-localnet-workflow.md)
3. Back to map: [Learning Path Map](./)
