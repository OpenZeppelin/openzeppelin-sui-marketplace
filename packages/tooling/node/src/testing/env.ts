import type {
  LocalnetStartOptions,
  TestContext,
  TestContextOptions
} from "./localnet.ts"
import {
  createLocalnetHarness,
  createTestContext as createLocalnetTestContext,
  withTestContext as withLocalnetTestContext
} from "./localnet.ts"
import { parsePositiveInteger } from "./numbers.ts"

export type SuiLocalnetTestEnvMode = "suite" | "test"

export type SuiLocalnetTestEnvOptions = {
  mode?: SuiLocalnetTestEnvMode
  withFaucet?: boolean
  keepTemp?: boolean
  rpcWaitTimeoutMs?: number
  moveSourceRootPath?: string
}

export type SuiLocalnetTestEnv = {
  mode: SuiLocalnetTestEnvMode
  startSuite: (suiteId: string) => Promise<void>
  stopSuite: () => Promise<void>
  createTestContext: (testId: string) => Promise<TestContext>
  withTestContext: <T>(
    testId: string,
    action: (context: TestContext) => Promise<T>
  ) => Promise<T>
}

const resolveKeepTemp = (explicit?: boolean) =>
  explicit ?? process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = (explicit?: boolean) =>
  explicit ?? process.env.SUI_IT_WITH_FAUCET !== "0"

const resolveTestContextOptions = (
  options?: SuiLocalnetTestEnvOptions
): TestContextOptions | undefined => {
  if (!options?.moveSourceRootPath) return undefined
  return { moveSourceRootPath: options.moveSourceRootPath }
}

const resolveRpcWaitTimeoutMs = (explicit?: number) => {
  if (
    typeof explicit === "number" &&
    Number.isFinite(explicit) &&
    explicit > 0
  ) {
    return explicit
  }

  const override = parsePositiveInteger(process.env.SUI_IT_RPC_WAIT_TIMEOUT_MS)
  if (override !== undefined) return override

  if (process.env.CI) return 120_000

  return undefined
}

const resolveStartOptions = (
  testId: string,
  options?: SuiLocalnetTestEnvOptions
): LocalnetStartOptions => ({
  testId,
  keepTemp: resolveKeepTemp(options?.keepTemp),
  withFaucet: resolveWithFaucet(options?.withFaucet),
  rpcWaitTimeoutMs: resolveRpcWaitTimeoutMs(options?.rpcWaitTimeoutMs)
})

const buildScopedTestId = (suiteId: string | undefined, testId: string) => {
  const trimmedSuiteId = suiteId?.trim()
  const trimmedTestId = testId.trim()
  if (!trimmedSuiteId) return trimmedTestId
  return `${trimmedSuiteId}--${trimmedTestId}`
}

const createSuiteRunner = (
  options?: SuiLocalnetTestEnvOptions
): SuiLocalnetTestEnv => {
  const harness = createLocalnetHarness()
  let suiteId: string | undefined

  const ensureSuiteStarted = () => {
    if (!suiteId)
      throw new Error(
        "Suite localnet is not started. Call startSuite(suiteId) first."
      )
  }

  const startSuite = async (nextSuiteId: string) => {
    suiteId = nextSuiteId
    await harness.start(resolveStartOptions(nextSuiteId, options))
  }

  const stopSuite = async () => {
    suiteId = undefined
    await harness.stop()
  }

  const createTestContext = async (testId: string) => {
    ensureSuiteStarted()
    return createLocalnetTestContext(
      harness.get(),
      buildScopedTestId(suiteId, testId),
      resolveTestContextOptions(options)
    )
  }

  const withTestContext = async <T>(
    testId: string,
    action: (context: TestContext) => Promise<T>
  ) => {
    ensureSuiteStarted()
    return withLocalnetTestContext(
      harness.get(),
      buildScopedTestId(suiteId, testId),
      action,
      resolveTestContextOptions(options)
    )
  }

  return {
    mode: "suite",
    startSuite,
    stopSuite,
    createTestContext,
    withTestContext
  }
}

const createIsolatedRunner = (
  options?: SuiLocalnetTestEnvOptions
): SuiLocalnetTestEnv => {
  const startSuite = async () => {
    throw new Error("startSuite is not available in test mode.")
  }

  const stopSuite = async () => {
    return
  }

  const createTestContext = async (testId: string) => {
    const harness = createLocalnetHarness()
    await harness.start(resolveStartOptions(testId, options))
    const context = await createLocalnetTestContext(
      harness.get(),
      testId,
      resolveTestContextOptions(options)
    )
    const cleanup = async () => {
      await context.cleanup()
      await harness.stop()
    }

    return {
      ...context,
      cleanup
    }
  }

  const withTestContext = async <T>(
    testId: string,
    action: (context: TestContext) => Promise<T>
  ) => {
    const harness = createLocalnetHarness()
    await harness.start(resolveStartOptions(testId, options))
    const context = await createLocalnetTestContext(
      harness.get(),
      testId,
      resolveTestContextOptions(options)
    )

    try {
      return await action(context)
    } finally {
      await context.cleanup()
      await harness.stop()
    }
  }

  return {
    mode: "test",
    startSuite,
    stopSuite,
    createTestContext,
    withTestContext
  }
}

export const createSuiLocalnetTestEnv = (
  options?: SuiLocalnetTestEnvOptions
): SuiLocalnetTestEnv => {
  const mode = options?.mode ?? "test"
  if (mode === "suite") return createSuiteRunner(options)
  return createIsolatedRunner(options)
}
