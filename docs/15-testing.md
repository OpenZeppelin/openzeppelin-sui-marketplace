# 15 - Testing (integration + unit + script framework)

**Path:** [Learning Path](./) > 15 Testing

This chapter is the detailed testing reference (commands, env toggles, and the script testing framework).

## 1. Integration tests (localnet)
```bash
pnpm test:integration
```

Optional toggles:
- `SUI_IT_KEEP_TEMP=1` keeps temp dirs + logs for debugging.
- `SUI_IT_WITH_FAUCET=0` disables the local faucet (default on; tests fund via the local faucet unless a funded treasury account is available).
- `SUI_IT_TREASURY_INDEX=<n>` forces which localnet keystore entry to use for funding.
- `SUI_IT_RPC_WAIT_TIMEOUT_MS=<ms>` adjusts localnet RPC/faucet readiness timeout (default `10000`, CI default `120000`).
- `SUI_IT_RANDOM_PORTS=0` opts out of random ports (default on) when you want to bind to the standard localnet ports.
- `SUI_IT_SINGLE_THREAD=0` enables parallel Vitest workers (default single-thread to avoid localnet port conflicts).

Note: integration tests run single-threaded to avoid localnet port conflicts.
Localnet used by tests is isolated in a temp dir and does not reuse `~/.sui` or any running localnet.

## 2. Unit tests (domain + UI)
```bash
pnpm --filter @sui-oracle-market/domain-core test:unit
pnpm ui test:unit
```

### 2.1 Pyth mock helper for Move unit tests
Use `new_price_info_object_for_test` from the Pyth mock to build a `PriceInfoObject` that behaves
like the real oracle object but is safe for tests. This keeps oracle guardrail tests deterministic
without requiring on-chain Pyth state.

`packages/dapp/move/oracle-market/tests/shop_tests.move`
```move
let price_info = pyth_price_info::new_price_info(
  attestation_time,
  arrival_time,
  price_feed,
);
let price_info_object = pyth_price_info::new_price_info_object_for_test(
  price_info,
  ctx,
);
let price_info_id = pyth_price_info::uid_to_inner(&price_info_object);
```

`packages/dapp/move/pyth-mock/sources/price_info.move`
```move
#[test_only]
public fun new_price_info_object_for_test(
  price_info: PriceInfo,
  ctx: &mut tx::TxContext,
): PriceInfoObject {
  new_price_info_object(price_info, ctx)
}
```

Note: clean up test objects to keep unit tests tidy and avoid accidental leaks:

`packages/dapp/move/pyth-mock/sources/price_info.move`
```move
#[test_only]
public fun destroy(price_info: PriceInfoObject) {
  let PriceInfoObject { id, price_info: _ } = price_info;
  obj::delete(id);
}
```

## 3. Script testing framework
This repo ships a reusable testing layer in `@sui-oracle-market/tooling-node/testing` designed for scripts built on `runSuiScript`.

The goal is to keep script tests fast, deterministic, and production-grade while exercising the same code paths as real users.

### 3.1 What you get
- **Localnet harness** with deterministic ports, temp dirs, and cleanup.
- **Script runner** that executes buyer/owner scripts with `ts-node` and a fully wired environment.
- **JSON output parsing** for stable assertions.
- **Assertions and wait helpers** for effects, events, object ownership, and object state.
- **Observability utilities** to capture logs and inspect failures without ad-hoc console hacks.

### 3.2 Directory layout (dapp)
- `packages/dapp/src/scripts/owner/test-integration/` → owner script integration tests and helpers.
- `packages/dapp/src/scripts/buyer/test-integration/` → buyer script integration tests and helpers.
- `packages/dapp/src/utils/test/helpers/helpers.ts` → shared test utilities and fixtures used by both owner/buyer suites.
- `packages/dapp/src/scripts/utils/test/` → unit tests for script utilities.

### 3.2.1 Code spotlight: buyer script integration test
`packages/dapp/src/scripts/buyer/test-integration/buyer-scripts.test.ts`
```ts
it("lists item listings created by owner scripts", async () => {
  await testEnv.withTestContext("buyer-item-listings", async (context) => {
    const { publisher, scriptRunner, shopId, itemExamplesPackageId } =
      await createShopWithItemExamplesFixture(context, {
        shopName: "Buyer Integration Shop"
      })

    const itemType = resolveItemType(itemExamplesPackageId, "Car")

    const listing = await createItemListingFixture({
      scriptRunner,
      publisher,
      shopId,
      name: "Roadster",
      price: "1250",
      stock: "4",
      itemType
    })

    const listPayload = await runBuyerScriptJson<ItemListingListOutput>(
      scriptRunner,
      "item-listing-list",
      { account: publisher, args: { shopId } }
    )

    const listedIds = (listPayload.itemListings ?? []).map(
      (listing) => listing.itemListingId
    )
    expect(listedIds).toContain(listing.itemListingId)
  })
})
```
### 3.3 Vitest configuration
Use the tooling Vitest plugin to keep test defaults consistent across packages. Example config:
```ts
import { defineConfig } from "vitest/config"
import { toolingVitestPlugin } from "@sui-oracle-market/tooling-node/testing/vitest-plugin"

export default defineConfig({
	plugins: [toolingVitestPlugin()],
	test: {
		include: ["src/scripts/**/test-integration/**/*.test.ts"],
		testTimeout: 180_000,
		hookTimeout: 180_000,
		pool: "threads",
		poolOptions: { threads: { singleThread: true } }
	}
})
```

### 3.4 Localnet lifecycle (suite mode)
Use a single localnet per test file for speed, but isolate test state via new accounts and artifacts per test:
```ts
import { afterAll, beforeAll, it } from "vitest"
import { createDappIntegrationTestEnv } from "packages/dapp/src/utils/test/helpers/helpers"

const testEnv = createDappIntegrationTestEnv()

beforeAll(async () => {
	await testEnv.startSuite("owner-scripts")
})

afterAll(async () => {
	await testEnv.stopSuite()
})

it("runs a script with a clean context", async () => {
	await testEnv.withTestContext("example", async (context) => {
		const account = context.createAccount("publisher")
		await context.fundAccount(account, { minimumCoinObjects: 2 })
		// run script...
	})
})
```

### 3.5 Running scripts from tests
Use the script runner to execute scripts exactly as a user would, but with stable inputs:
```ts
import {
	createScriptRunner,
	publishMovePackage,
	runScriptJson
} from "packages/dapp/src/utils/test/helpers/helpers"

const scriptRunner = createScriptRunner(context)
const oracleMarketArtifact = await publishMovePackage(
	context,
	publisher,
	"oracle-market"
)

const result = await runScriptJson<{
	shopOverview?: { shopId?: string }
}>(
	(name, options) => scriptRunner.runOwnerScript(name, options),
	"shop-create",
	{
		account: publisher,
		args: {
			shopPackageId: oracleMarketArtifact.packageId,
			name: "Integration Shop"
		}
	}
)
```

### 3.6 Dapp integration fixtures (recommended)
Use dapp-scoped fixtures to keep setup DRY and consistent across tests:
```ts
import {
	createShopWithItemExamplesFixture,
	resolveItemType,
	seedShopWithListingAndDiscount,
	runBuyerScriptJson
} from "packages/dapp/src/utils/test/helpers/helpers"

const { publisher, scriptRunner, shopId, itemExamplesPackageId } =
	await createShopWithItemExamplesFixture(context, {
		shopName: "Shop View Integration"
	})

const itemType = resolveItemType(itemExamplesPackageId, "Car")
await seedShopWithListingAndDiscount({
	scriptRunner,
	publisher,
	shopId,
	itemType,
	listingName: "Roadster",
	price: "1250",
	stock: "4",
	ruleKind: "percent",
	value: "10"
})

const viewPayload = await runBuyerScriptJson(scriptRunner, "shop-view", {
	account: publisher,
	args: { shopId }
})
```

Key points:
- Use the **args map** format; it is converted to kebab-case flags.
- Always pass `json: true` (handled by `runScriptJson`) for deterministic output parsing.
- Prefer `createShopFixture`/`createShopWithItemExamplesFixture` to keep base setup consistent and isolated.

### 3.7 Assertions and deterministic waits
Use tooling helpers for clean, deterministic checks:
```ts
import {
	assertTransactionSucceeded,
	assertMoveAbort,
	assertEventByDigest,
	assertObjectOwnerById
} from "@sui-oracle-market/tooling-node/testing/assert"
import { waitForObjectState } from "@sui-oracle-market/tooling-node/testing/objects"

// Example: wait for object state instead of sleeping.
const object = await waitForObjectState({
	suiClient: context.suiClient,
	objectId,
	predicate: (response) => response.data?.owner !== undefined
})

assertObjectOwnerById({
	suiClient: context.suiClient,
	objectId,
	expectedOwner: account.address
})
```

### 3.8 Observability
Capture logs in tests without global console overrides:
```ts
import { withCapturedConsole } from "@sui-oracle-market/tooling-node/testing/observability"

const { records } = await withCapturedConsole(async () => {
	// run script and assertions
})

expect(records.warn.join(" ")).toContain("warning")
```

### 3.9 Environment toggles for localnet tests
- `SUI_IT_KEEP_TEMP=1` keep temp dirs/logs for debugging.
- `SUI_IT_WITH_FAUCET=0` disable local faucet.
- `SUI_IT_TREASURY_INDEX=<n>` choose the keystore entry used for funding.
- `SUI_IT_RPC_WAIT_TIMEOUT_MS=<ms>` override localnet RPC/faucet readiness timeout.
- `SUI_IT_RANDOM_PORTS=0` opt out of random ports.
- `SUI_IT_SINGLE_THREAD=0` allow parallel Vitest workers.
- `SUI_IT_SKIP_LOCALNET=1` or `SKIP_LOCALNET=1` skip localnet tests entirely (localnet guard).

### 3.10 Best practices checklist
- Use `createSuiLocalnetTestEnv` for deterministic lifecycle and cleanup.
- Avoid shared mutable state; create new accounts per test.
- Prefer JSON output and stable parsing over log scraping.
- Replace sleeps with bounded polling (`waitForObjectState`, `waitForFinality`).
- Assert on effects, ownership, and events rather than only digests.

## 4. Navigation
1. Previous: [14 Advanced (execution model + upgrades)](./14-advanced.md)
2. Next: [18 Data Access + Indexing](./18-data-access.md)
3. Back to map: [Learning Path Map](./)
