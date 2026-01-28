# Tooling package

This package provides shared tooling for Sui Move development in this repository. It includes:

- **tooling-core**: environment-agnostic helpers (browser + Node) for building transactions, reading on-chain objects, and normalizing Sui data.
- **tooling-node**: Node-only helpers for Move builds, publishing, localnet orchestration, artifacts, and script execution.

The tooling is designed for:

- publishing Move packages with artifact capture across networks
- managing deployment/object changes with artifacts across networks
- executing scripts with a consistent CLI environment
- integrating with by environment flows in CI or integration tests

---

## Package layout

```
packages/tooling/
  core/ (Node + browser)
  node/ (Node only)
```

### When to use which package

- Use **tooling-core** in any shared logic, UI-safe utilities, or libraries that must run in both browser and Node environments.
- Use **tooling-node** for scripting, filesystem access, running the Sui CLI, Move package builds, publishing, and test harness utilities.

---

## Installation and usage

This repository is a PNPM workspace. Import from the workspace package names directly:

```ts
import { newTransaction } from "_root_package_/tooling-core/transactions"
import { publishPackageWithLog } from "_root_package_/tooling-node/publish"
```

---

## Configuration

Tooling reads configuration from `sui.config.*` in the current working directory and merges environment overrides.

### Config file shape

```ts
import { defineSuiConfig } from "_root_package_/tooling-node/config"

export default defineSuiConfig({
  defaultNetwork: "localnet",
  networks: {
    localnet: {
      url: "http://127.0.0.1:9000",
      gasBudget: 100000000,
      account: {
        // see account config below
      }
    }
  },
  paths: {
    move: "move",
    deployments: "deployments",
    objects: "deployments",
    artifacts: "deployments"
  }
})
```

### Environment overrides

- `SUI_CONFIG_PATH`: path to an explicit config file
- `SUI_NETWORK`: override the selected network
- `SUI_RPC_URL` or `SUI_NETWORK_URL`: override the RPC endpoint
- `SUI_KEYSTORE_PATH`: override keystore location
- `SUI_ACCOUNT_INDEX`: keystore account index to use
- `SUI_ACCOUNT_ADDRESS`: explicit account address
- `SUI_ACCOUNT_PRIVATE_KEY`: bech32 or base64 private key
- `SUI_ACCOUNT_MNEMONIC`: BIP-39 mnemonic
- `SUI_ARTIFACTS_DIR`: where artifacts are written (default: `deployments/`)
- `SUI_CONFIG_DIR` / `SUI_LOCALNET_CONFIG_DIR`: localnet config directory
- `SUI_SKIP_MOVE_CHAIN_ID_SYNC`: skip Move.toml localnet environment sync

### Account config

`SuiAccountConfig` allows the following sources for signer material:

- keystore (`keystorePath` + `accountIndex` or `accountAddress`)
- `accountPrivateKey` (bech32 or base64)
- `accountMnemonic`

The tooling resolves the effective signer in the following order:
1. explicit private key
2. mnemonic
3. keystore entry by address
4. keystore entry by index

---

## Core concepts

### Tooling context

Most APIs accept a context object to avoid global state:

- `ToolingCoreContext` (core) contains a `suiClient` and optional `networkName`/`rpcUrl`.
- `ToolingContext` (node) extends the above with `suiConfig` and a `SuiClient` instance.

`createTooling(...)` binds the context into a `Tooling` facade with helper methods so scripts can be written as “one-liners” without re-plumbing dependencies.

### Artifacts

The tooling persists artifacts to JSON files for reuse across scripts and tests:

- `deployment.<network>.json` → package IDs, UpgradeCaps, dependencies
- `objects.<network>.json` → created or updated objects from transactions

Artifacts are merged/deduped by `objectId`/`packageId` where possible. The root directory is resolved using:

1. `withArtifactsRoot(artifactsDir, ...)` when explicitly scoped
2. `SUI_ARTIFACTS_DIR` if set
3. `deployments/` in the current working directory (default)

### Move environment chain ID sync

For localnet, the tooling can keep `Move.toml` environments aligned to the current chain ID. This prevents `dep-replacements` drift or publish failures when localnet is reset.

- `syncLocalnetMoveEnvironmentChainId(...)` updates `Move.toml` if needed.
- `SUI_SKIP_MOVE_CHAIN_ID_SYNC=1` disables this behavior (useful in test harnesses).

### Publishing

Publishing is a multi-step flow:

1. `buildMovePackage(...)` compiles modules and resolves dependency addresses
2. `publishPackage(...)` executes the publish transaction
3. artifacts are persisted with module bytecode, dependencies, and explorer links

The publish flow enforces:

- **unpublished dependencies are allowed only on localnet**
- **Move.toml environments are the source of dependency linkage** for shared networks
- **automatic CLI fallback** when SDK publish exceeds size limits

### Transaction execution and object artifacts

`signAndExecute(...)` wraps Sui execution with:

- explicit gas budget enforcement
- fresh gas coin selection (avoid stale object errors)
- one retry for stale/locked gas objects
- object artifact persistence based on `objectChanges`

`executeTransactionWithSummary(...)` adds a readable summary (gas + object changes).

---

## Common workflows

### Execute a script with a standard CLI flow

```ts
import yargs from "yargs"
import { runSuiScript } from "_root_package__/tooling-node/process"

runSuiScript(async (tooling, args) => {
  // use tooling.signAndExecute, publishPackageWithLog, etc
}, yargs.option("json", { type: "boolean" }))
```

### Load the most recent deployment artifact

```ts
import { loadDeploymentArtifacts, getLatestArtifact } from "_root_package__/tooling-node/artifacts"

const artifacts = await loadDeploymentArtifacts("testnet")
const latest = getLatestArtifact(artifacts)
```

### Run transactions with summaries

```ts
import { newTransaction } from "_root_package__/tooling-core/transactions"
import { executeTransactionWithSummary } from "_root_package__/tooling-node/transactions-execution"

const tx = newTransaction()
// build PTB...
const result = await executeTransactionWithSummary({
  transaction: tx,
  signer: tooling.loadedEd25519KeyPair,
  summaryLabel: "Create pool"
}, tooling)
```

---

## Integration testing with tooling-node/testing

The testing helpers in `packages/tooling/node/src/testing` provide a consistent localnet harness, per-test isolation, and script execution utilities. They are designed to make integration tests deterministic and easy to reason about by:

- creating isolated localnet instances (or a shared suite instance)
- providing a `TestContext` with ready-to-use helpers
- wiring scripts to a controlled config and artifacts directory

### Key entry points

- `createSuiLocalnetTestEnv(...)` — high-level localnet environment factory
- `withTestContext(...)` / `createTestContext(...)` — per-test context with cleanup
- `createSuiScriptRunner(context)` — run TS scripts with a scoped config
- `parseJsonFromScriptOutput(stdout)` — parse JSON output from scripts

### Typical setup (Vitest)

```ts
import { describe, it, expect } from "vitest"
import { createSuiLocalnetTestEnv } from "_root_package__/tooling-node/testing/env"

const testEnv = createSuiLocalnetTestEnv({
  mode: "test", // or "suite" to reuse one localnet per test file
  withFaucet: true,
  keepTemp: false,
  moveSourceRootPath: "path/to/move/sources"
})

describe("integration flow", () => {
  it("builds and publishes a Move package", async () => {
    await testEnv.withTestContext("publish-simple-contract", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const buildOutput = await context.buildMovePackage("simple-contract")
      expect(buildOutput.modules.length).toBeGreaterThan(0)

      const artifacts = await context.publishPackage(
        "simple-contract",
        publisher,
        { withUnpublishedDependencies: true }
      )

      expect(artifacts.length).toBeGreaterThan(0)
    })
  })
})
```

### Running scripts inside tests

Use `createSuiScriptRunner(...)` to execute scripts from the `packages/dapp/src/scripts` tree against the localnet instance. The runner injects a temporary config file, RPC URL, and artifacts directory, so scripts behave the same way as when run manually.

```ts
import { describe, it, expect } from "vitest"
import { pickRootNonDependencyArtifact } from "_root_package__/tooling-node/artifacts"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "_root_package__/tooling-node/testing/scripts"
import { createSuiLocalnetTestEnv } from "_root_package__/tooling-node/testing/env"

const testEnv = createSuiLocalnetTestEnv({ mode: "test", withFaucet: true })

describe("owner scripts", () => {
  it("runs amm-create and parses JSON output", async () => {
    await testEnv.withTestContext("owner-amm-create", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const artifacts = await context.publishPackage(
        "prop_amm",
        publisher,
        { withUnpublishedDependencies: true }
      )
      const rootArtifact = pickRootNonDependencyArtifact(artifacts)

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runOwnerScript("amm-create", {
        account: publisher,
        args: {
          json: true,
          ammPackageId: rootArtifact.packageId,
          pythPriceFeedLabel: "MOCK_SUI_FEED"
        }
      })

      expect(result.exitCode).toBe(0)
      const parsed = parseJsonFromScriptOutput<{ ammConfig?: { configId?: string } }>(
        result.stdout,
        "amm-create output"
      )
      expect(parsed.ammConfig?.configId).toBeTruthy()
    })
  })
})
```

### What `TestContext` gives you

The context created by `withTestContext(...)` exposes helpers that simplify tests:

- `createAccount(label)` — create deterministic test accounts
- `fundAccount(account, options)` — request faucet funds or transfer from treasury
- `buildMovePackage(relativePath)` — build Move packages inside the test move root
- `publishPackage(relativePath, account, options)` — publish and record artifacts
- `signAndExecuteTransaction(tx, account, options)` — run a transaction block
- `waitForFinality(digest, options)` — await checkpoint finality
- `queryEventsByTransaction(digest)` / `queryEventsByType(eventType)` — event lookup

### Recommended patterns

- Use `mode: "suite"` when you want to reuse one localnet across many tests in the same file.
- Use `mode: "test"` (default) for maximum isolation and clean artifact directories.
- Prefer `withTestContext(...)` to guarantee cleanup even when tests fail.
- Always pass `withUnpublishedDependencies: true` when publishing localnet-only packages.

---

# API reference

This section documents the public API surface by module. Function signatures are simplified to keep the docs readable; refer to the TypeScript definitions for exact types.

## tooling-core

### address

- `parseAddressList({ rawAddresses, label }): string[]` — parse and normalize comma-delimited addresses.
- `getSuiBalance({ address }, context): Promise<bigint>` — fetch total SUI balance.
- `getCoinBalanceSummary({ address, coinType }, context): Promise<CoinBalanceSummary>` — get balance for a specific coin type.
- `getCoinBalances({ address }, context): Promise<CoinBalanceSummary[]>` — get all coin balances for an address.
- `asMinimumBalanceOf({ address, minimumBalance }, context): Promise<boolean>` — check minimum SUI balance.

### coin

- `buildCoinTransferTransaction({ coinObjectId, amount, recipientAddress }): Transaction` — build a PTB that splits a coin and transfers the split.
- `normalizeCoinType(coinType): string` — normalize `Coin<T>` type names.
- `resolveCoinOwnership({ coinObjectId }, context): Promise<CoinOwnershipSnapshot>` — resolve coin type and owner.
- `planSuiPaymentSplitTransaction(...)` — determine if a split is needed to pay and cover gas; may return a split transaction.

### coin-registry

- `deriveCurrencyObjectId(coinType, registryId): string` — deterministic registry object ID.
- `listCurrencyRegistryEntries({ registryId, includeMetadata, chunkSize }, context): Promise<CurrencyRegistryEntry[]>`
- `resolveCurrencyObjectId({ coinType, registryId, fallbackRegistryScan }, context): Promise<string | undefined>`

### context

- `createToolingCoreContext(context): ToolingCoreContext` — identity helper for context creation.

### dynamic-fields

- `getAllDynamicFields({ parentObjectId, objectTypeFilter }, context): Promise<DynamicFieldInfo[]>`
- `getAllDynamicFieldObjects({ parentObjectId, objectTypeFilter }, context): Promise<WrappedSuiDynamicFieldObject[]>`
- `getSuiDynamicFieldObject({ childObjectId, parentObjectId }, context): Promise<WrappedSuiDynamicFieldObject>`
- `getObjectWithDynamicFieldFallback({ objectId, parentObjectId, options }, context): Promise<SuiObjectData>`
- `getObjectIdFromDynamicFieldObject(object): string | undefined`
- `isDynamicFieldObject(objectType?): boolean`

### network

- `resolveCommonRpcUrl(network): string | undefined`
- `resolveRpcUrl(network, override?): string`
- `buildExplorerUrl(digest, network): string`
- `assertLocalnetNetwork(networkName): void`

### object

- `getSuiObject({ objectId, options }, context): Promise<{ object, owner?, error? }>`
- `getAllOwnedObjectsByFilter({ ownerAddress, filter, options }, context): Promise<SuiObjectData[]>`
- `buildSuiObjectRef(object): SuiObjectRef`
- `unwrapMoveObjectFields(object): TFields` — extract Move fields from `moveObject` content.
- `normalizeObjectArtifact(artifact): ObjectArtifact`
- `deriveRelevantPackageId(typeTag): string`
- `normalizeIdOrThrow(id, errorMessage): string`
- `normalizeOptionalIdFromValue(value): string | undefined`

### shared-object

- `extractInitialSharedVersion(created): string | undefined`
- `getSuiSharedObject({ objectId, mutable }, context): Promise<WrappedSuiSharedObject>`

### transactions

- `newTransaction(gasBudget?): Transaction` — create a PTB.
- `resolveSplitCoinResult(splitResult, index): TransactionObjectArgument`
- `assertTransactionSuccess(result): void`
- `isStaleObjectVersionError(error): boolean`
- `findCreatedObjectIds(result, typeSuffix): string[]`
- `findCreatedByType(result, matcher): string[]`
- `findObjectMatching(result, matcher): SuiObjectChange | undefined`
- `findCreatedObjectBySuffix(result, typeSuffix): SuiObjectChange | undefined`
- `ensureCreatedObject(objectToFind, result): SuiObjectChangeCreated`
- `summarizeObjectChanges(objectChanges): ObjectChangeDetail[]`
- `summarizeGasUsed(gasUsed): GasSummary | undefined`

### types

- `BuildOutput` — compiled module bytecode + dependency IDs.
- `PublishResult`, `PublishArtifact`, `PublishedPackage` — publish outputs and artifact shape.
- `NetworkName`, `ENetwork` — network identifiers.

---

## tooling-node

### account

- `resolveOwnerAddress(providedAddress, networkConfig): Promise<string>` — resolve address from input/config/keystore.

### artifacts

- `withArtifactsRoot(artifactsDir, action): Promise<T>` — scope artifact directory for nested operations.
- `writeDeploymentArtifact(filePath, artifacts): Promise<PublishArtifact[]>`
- `writeObjectArtifact(filePath, artifacts): Promise<ObjectArtifact[]>`
- `readArtifact(filePath, default?): Promise<T>`
- `loadDeploymentArtifacts(networkName): Promise<PublishArtifact[]>`
- `loadObjectArtifacts(networkName): Promise<ObjectArtifact[]>`
- `getDeploymentArtifactPath(networkName): string`
- `getObjectArtifactPath(networkName): string`
- `getLatestArtifact(artifacts): T | undefined`
- `getLatestDeploymentFromArtifact(packageName)(networkName): Promise<PublishArtifact | undefined>`
- `getLatestObjectFromArtifact(typeSuffix)(networkName): Promise<ObjectArtifact | undefined>`

### config

- `defineSuiConfig(config): config` — typed config helper.
- `loadSuiConfig(): Promise<SuiResolvedConfig>` — load/merge config + env overrides.
- `getNetworkConfig(networkName, config): SuiNetworkConfig`
- `getAccountConfig(networkConfig, accountName?): SuiAccountConfig`

### dev-inspect

- `maybeLogDevInspect({ transaction, enabled, senderAddress }, toolingContext)` — run `devInspectTransactionBlock` and log details.

### factory

- `createTooling({ suiClient, suiConfig }): Promise<Tooling>` — creates a script-friendly facade.

### json

- `emitJsonOutput(payload, enabled?): boolean` — optional JSON output
- `parseJsonFromOutput(output): T | undefined`
- `collectJsonCandidates(output): string[]`

### localnet

- `resolveLocalnetConfigDir(candidate?): string`
- `deriveFaucetUrl(rpcUrl): string`
- `probeRpcHealth(rpcUrl): Promise<ProbeResult>`
- `getRpcSnapshot(rpcUrl): Promise<RpcSnapshot>`

### move

- `buildMovePackage(packagePath, buildArgs?, { stripTestModules? }): Promise<BuildOutput>`
- `runMoveBuild(args, options?): Promise<{ stdout, stderr, exitCode }>`
- `buildMoveTestArguments({ packagePath, environmentName? }): string[]`
- `buildMoveTestPublishArguments({ packagePath, buildEnvironmentName?, publicationFilePath?, withUnpublishedDependencies? }): string[]`
- `runMoveTest(args, options?): Promise<{ stdout, stderr, exitCode }>`
- `runClientTestPublish(args, options?): Promise<{ stdout, stderr, exitCode }>`
- `syncLocalnetMoveEnvironmentChainId({ moveRootPath, environmentName, dryRun? }, toolingContext): Promise<MoveEnvironmentChainIdSyncResult>`
- `clearPublishedEntryForNetwork({ packagePath, networkName }): Promise<{ didUpdate: boolean }>`

### move-lock

- `extractSuiFrameworkRevisionsFromMoveLock({ lockContents, environmentName? }): Set<string>`
- `extractSuiFrameworkPinnedEntriesFromMoveLock({ lockContents, environmentName? }): SuiFrameworkPinnedEntry[]`
- `extractSingleSuiFrameworkRevisionFromMoveLock({ lockContents, environmentName? }): string | undefined`

### publish

- `publishPackageWithLog({ packagePath, keypair, gasBudget?, withUnpublishedDependencies?, useCliPublish?, allowAutoUnpublishedDependencies? }, context): Promise<PublishArtifact[]>`
- `publishPackage(publishPlan, context): Promise<PublishArtifact[]>`
- `doPublishPackage(publishPlan, buildOutput, context): Promise<PublishResult>`
- `runClientPublish(args, options?): Promise<{ stdout, stderr, exitCode }>`
- `publishMovePackageWithFunding({ packagePath, gasBudget?, withUnpublishedDependencies?, allowAutoUnpublishedDependencies?, useCliPublish?, clearPublishedEntry? }, context): Promise<PublishArtifact>`

### process

- `addBaseOptions(scriptName, yargs): Promise<CommonCliArgs & T>` — add `--network` and parse args.
- `runSuiScript(script, yargs?)` — standard CLI runner with logging, Sui CLI checks, and network selection.

### suiCli

- `ensureSuiCli(): Promise<void>`
- `runSuiCli(baseArgs)(args, options?): Promise<{ stdout, stderr, exitCode }>`
- `getSuiCliVersion(): Promise<string | undefined>`
- `getActiveSuiCliEnvironment(): Promise<string | undefined>`
- `listSuiCliEnvironments(): Promise<string[]>`
- `getSuiCliEnvironmentChainId(environmentName?): Promise<string | undefined>`
- `getSuiCliEnvironmentRpc(environmentName?): Promise<string | undefined>`

### sui-client

- `createSuiClient(rpcUrl): SuiClient`

### transactions

- `signAndExecute({ transaction, signer, requestType?, retryOnGasStale?, assertSuccess? }, context): Promise<{ transactionResult, objectArtifacts }>`
- `executeTransactionOnce({ transaction, signer, requestType, assertSuccess }, context)`
- `findCreatedArtifactBySuffix(createdArtifacts, suffix): ObjectArtifact | undefined`
- `findCreatedArtifactIdBySuffix(createdArtifacts, suffix): string | undefined`
- `requireCreatedArtifactIdBySuffix({ createdArtifacts, suffix, label }): string`

### transactions-execution

- `executeTransactionWithSummary({ transaction, signer, summaryLabel?, devInspect?, dryRun?, senderAddress? }, context)`

### transactions-summary

- `buildTransactionSummary(result, label?): TransactionSummary`
- `formatTransactionSummary(summary): string`
- `formatTransactionResult(result, label?): string`
- `resolveTransactionDigest(result): string | undefined`
- `requireTransactionDigest(result, label?): string`

### testing (node-only)

High-level helpers for localnet + scripts. These are used by the integration test harness and are safe to reuse:

- `createSuiLocalnetTestEnv(options?)` — start a localnet in suite or per-test mode
- `createSuiScriptRunner(context)` — run TS scripts against a localnet test context
- `parseJsonFromScriptOutput(stdout)` — parse JSON from script output
- `createLocalnetHarness()` / `createTestContext(...)` — lower-level localnet management
- `runOwnerScript(...)` / `runBuyerScript(...)` — run dapp scripts in tests
- `parseJsonFromScriptOutput(stdout)` — parse JSON from script output

---

## How the publishing flow works

1. **Build** — `buildMovePackage` calls the Sui CLI to compile the package. It parses JSON output or reads `build/` artifacts as a fallback and strips test modules when requested.
2. **Plan** — `publishPackageWithLog` creates a `PublishPlan` that decides whether unpublished dependencies are allowed (localnet only).
3. **Publish** — `publishPackage` uses SDK publish by default, falling back to CLI publish on transaction size errors.
4. **Persist** — deployment artifacts are stored under `deployments/deployment.<network>.json`.
5. **Log** — publish output includes explorer links and metadata like `suiCliVersion`.

---

## Error handling conventions

- Methods throw `Error` with context-rich messages.
- JSON parsing helpers tolerate noisy CLI output and scan for trailing JSON blocks.
- Transaction helpers normalize ID/owner formats to avoid cross-run diffs.

---


