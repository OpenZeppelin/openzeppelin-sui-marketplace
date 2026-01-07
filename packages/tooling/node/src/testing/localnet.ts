import {
  execFile as execFileCallback,
  spawn,
  type ChildProcess,
  type ExecException
} from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { createWriteStream } from "node:fs"
import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type {
  SuiClient,
  SuiEvent,
  SuiTransactionBlockResponse
} from "@mysten/sui/client"
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { Transaction } from "@mysten/sui/transactions"

import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import type {
  BuildOutput,
  PublishArtifact
} from "@sui-oracle-market/tooling-core/types"
import { pickRootNonDependencyArtifact } from "../artifacts.ts"
import { DEFAULT_TX_GAS_BUDGET } from "../constants.ts"
import type { SuiResolvedConfig } from "../config.ts"
import { createSuiClient } from "../describe-object.ts"
import { loadKeypair } from "../keypair.ts"
import { probeRpcHealth } from "../localnet.ts"
import { buildMovePackage, clearPublishedEntryForNetwork } from "../move.ts"
import { publishPackageWithLog } from "../publish.ts"
import { signAndExecute } from "../transactions.ts"

export type LocalnetStartOptions = {
  testId: string
  withFaucet?: boolean
  keepTemp?: boolean
  rpcWaitTimeoutMs?: number
}

type LocalnetPorts = {
  rpcPort: number
  websocketPort: number
  faucetPort?: number
}

export type LocalnetInstance = {
  rpcUrl: string
  configDir: string
  logsDir: string
  tempDir: string
  process: ChildProcess
  suiClient: SuiClient
  treasuryAccount?: TestAccount
  faucetHost?: string
  stop: () => Promise<void>
}

export type TestAccount = {
  label: string
  keypair: Ed25519Keypair
  address: string
}

export type TestContext = {
  testId: string
  localnet: LocalnetInstance
  tempDir: string
  moveRootPath: string
  artifactsDir: string
  suiClient: SuiClient
  suiConfig: SuiResolvedConfig
  createAccount: (label: string) => TestAccount
  fundAccount: (
    account: TestAccount,
    options?: {
      minimumBalance?: bigint
      minimumCoinObjects?: number
      minimumGasCoinBalance?: bigint
    }
  ) => Promise<void>
  buildMovePackage: (packageRelativePath: string) => Promise<BuildOutput>
  publishPackage: (
    packageRelativePath: string,
    account: TestAccount,
    options?: {
      gasBudget?: number
      withUnpublishedDependencies?: boolean
    }
  ) => Promise<PublishArtifact[]>
  signAndExecuteTransaction: (
    transaction: Transaction,
    account: TestAccount,
    options?: { requestType?: "WaitForEffectsCert" | "WaitForLocalExecution" }
  ) => Promise<SuiTransactionBlockResponse>
  waitForFinality: (
    digest: string,
    options?: { timeoutMs?: number; intervalMs?: number }
  ) => Promise<SuiTransactionBlockResponse>
  queryEventsByTransaction: (digest: string) => Promise<SuiEvent[]>
  queryEventsByType: (eventType: string) => Promise<SuiEvent[]>
  cleanup: () => Promise<void>
}

const DEFAULT_RPC_PORT = 9000
const DEFAULT_WEBSOCKET_PORT = 9001
const DEFAULT_FAUCET_PORT = 9123
const DEFAULT_MINIMUM_COIN_OBJECTS = 2
const DEFAULT_MINIMUM_GAS_COIN_BALANCE = 500_000_000n
const DEFAULT_FAUCET_REQUEST_ATTEMPTS = 3
const DEFAULT_FAUCET_REQUEST_DELAY_MS = 500

const createTempDir = async (prefix = "tooling-test-") =>
  mkdtemp(path.join(os.tmpdir(), prefix))

const withEnv = async <T>(
  updates: Record<string, string | undefined>,
  action: () => Promise<T> | T
): Promise<T> => {
  const previous = new Map<string, string | undefined>()

  Object.entries(updates).forEach(([key, value]) => {
    previous.set(key, process.env[key])
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  })

  try {
    return await action()
  } finally {
    previous.forEach((value, key) => {
      if (value === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    })
  }
}

const execFile = promisify(execFileCallback)

const sanitizeLabel = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9-_]/g, "-")

const buildTempPrefix = (label: string) => `sui-it-${sanitizeLabel(label)}-`

const LOCALNET_SKIP_ENV_KEYS = ["SUI_IT_SKIP_LOCALNET", "SKIP_LOCALNET"]

const parseBooleanEnv = (value: string | undefined) => {
  if (!value) return false
  return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}

const shouldUseRandomPorts = () =>
  parseBooleanEnv(process.env.SUI_IT_RANDOM_PORTS) ||
  parseBooleanEnv(process.env.CI)

const resolveSkipLocalnetEnvKey = () =>
  LOCALNET_SKIP_ENV_KEYS.find((key) => parseBooleanEnv(process.env[key]))

const assertLocalnetEnabled = () => {
  const skipKey = resolveSkipLocalnetEnvKey()
  if (!skipKey) return
  throw new Error(
    `Localnet execution is disabled via ${skipKey}. Unset it to run localnet tests.`
  )
}

const resolveErrorCode = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined
  const code = (error as { code?: string }).code
  return typeof code === "string" ? code : undefined
}

const isPortPermissionError = (error: unknown) => {
  const code = resolveErrorCode(error)
  return code === "EPERM" || code === "EACCES"
}

const createLocalnetPortPermissionError = (action: string, error: unknown) => {
  const code = resolveErrorCode(error) ?? "unknown"
  return new Error(
    `Localnet could not ${action} a port on 127.0.0.1 (${code}). This environment may block localnet networking. Re-run with elevated permissions or set SUI_IT_SKIP_LOCALNET=1 to skip localnet tests.`
  )
}

const isPortAvailable = async (port: number): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", (error) => {
      if (isPortPermissionError(error)) {
        reject(createLocalnetPortPermissionError("bind", error))
        return
      }
      resolve(false)
    })
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true))
    })
  })

const getAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", (error) => {
      if (isPortPermissionError(error)) {
        reject(createLocalnetPortPermissionError("open", error))
        return
      }
      reject(error)
    })
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve local port")))
        return
      }
      server.close(() => resolve(address.port))
    })
  })

const resolveDistinctPort = async (usedPorts: Set<number>) => {
  let port = await getAvailablePort()
  while (usedPorts.has(port)) {
    port = await getAvailablePort()
  }
  usedPorts.add(port)
  return port
}

const resolveRandomPorts = async (
  withFaucet: boolean
): Promise<LocalnetPorts> => {
  const usedPorts = new Set<number>()
  const rpcPort = await resolveDistinctPort(usedPorts)
  const websocketPort = await resolveDistinctPort(usedPorts)
  const faucetPort = withFaucet
    ? await resolveDistinctPort(usedPorts)
    : undefined

  return faucetPort !== undefined
    ? { rpcPort, websocketPort, faucetPort }
    : { rpcPort, websocketPort }
}

const resolveLocalnetPorts = async (
  withFaucet: boolean
): Promise<LocalnetPorts> => {
  if (shouldUseRandomPorts()) {
    return resolveRandomPorts(withFaucet)
  }

  const defaultRpcFree = await isPortAvailable(DEFAULT_RPC_PORT)
  const defaultWebsocketFree = await isPortAvailable(DEFAULT_WEBSOCKET_PORT)

  const rpcPort = defaultRpcFree ? DEFAULT_RPC_PORT : await getAvailablePort()
  let websocketPort = defaultWebsocketFree
    ? DEFAULT_WEBSOCKET_PORT
    : await getAvailablePort()
  while (websocketPort === rpcPort) {
    websocketPort = await getAvailablePort()
  }

  if (!withFaucet) {
    return { rpcPort, websocketPort }
  }

  const defaultFaucetFree = await isPortAvailable(DEFAULT_FAUCET_PORT)
  let faucetPort = defaultFaucetFree
    ? DEFAULT_FAUCET_PORT
    : await getAvailablePort()
  while (faucetPort === rpcPort || faucetPort === websocketPort) {
    faucetPort = await getAvailablePort()
  }

  return { rpcPort, websocketPort, faucetPort }
}

const listYamlFiles = async (rootDir: string): Promise<string[]> => {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files: string[] = []

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await listYamlFiles(fullPath)))
      } else if (entry.isFile() && entry.name.endsWith(".yaml")) {
        files.push(fullPath)
      }
    })
  )

  return files
}

const pathExists = async (candidatePath: string) => {
  try {
    await stat(candidatePath)
    return true
  } catch {
    return false
  }
}

const listKeystoreFiles = async (rootDir: string): Promise<string[]> => {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files: string[] = []

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await listKeystoreFiles(fullPath)))
      } else if (entry.isFile() && entry.name.endsWith(".keystore")) {
        files.push(fullPath)
      }
    })
  )

  return files
}

const readKeystoreEntries = async (keystorePath: string): Promise<string[]> => {
  const contents = await readFile(keystorePath, "utf8")
  const parsed = JSON.parse(contents)

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Unexpected keystore format at ${keystorePath}; expected JSON array.`
    )
  }

  return parsed
}

const parseOptionalNumber = (value: string | undefined) => {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

const buildTreasuryIndexCandidates = (entryCount: number) => {
  const indices = Array.from({ length: entryCount }, (_, index) => index)
  const overrideIndex = parseOptionalNumber(process.env.SUI_IT_TREASURY_INDEX)
  if (overrideIndex === undefined) return indices

  return [overrideIndex, ...indices.filter((index) => index !== overrideIndex)]
}

const resolveLocalnetKeystorePath = async (configDir: string) => {
  const candidates = [
    path.join(configDir, "sui.keystore"),
    path.join(configDir, "sui_config", "sui.keystore")
  ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  const keystoreFiles = await listKeystoreFiles(configDir)
  const match = keystoreFiles.find((filePath) =>
    filePath.endsWith("sui.keystore")
  )
  if (match) return match

  throw new Error(`Unable to locate a localnet keystore under ${configDir}.`)
}

const loadTreasuryAccount = async (
  configDir: string,
  suiClient: SuiClient
): Promise<TestAccount> => {
  const keystorePath = await resolveLocalnetKeystorePath(configDir)
  const entries = await readKeystoreEntries(keystorePath)
  if (entries.length === 0) {
    throw new Error(`Localnet keystore at ${keystorePath} is empty.`)
  }

  const candidates = buildTreasuryIndexCandidates(entries.length)
  let lastError: unknown = undefined

  for (const index of candidates) {
    try {
      const keypair = await loadKeypair({ keystorePath, accountIndex: index })
      const address = keypair.toSuiAddress()
      const coins = await suiClient.getCoins({
        owner: address,
        coinType: "0x2::sui::SUI",
        limit: 1
      })
      const hasBalance = coins.data.some((coin) => BigInt(coin.balance) > 0n)
      if (!hasBalance) continue

      return {
        label: `treasury-${index}`,
        keypair,
        address
      }
    } catch (error) {
      lastError = error
    }
  }

  const overrideHint =
    parseOptionalNumber(process.env.SUI_IT_TREASURY_INDEX) === undefined
      ? " Set SUI_IT_TREASURY_INDEX to force a specific keystore entry."
      : ""

  throw new Error(
    `No funded localnet accounts found in ${keystorePath}.${overrideHint} Start with SUI_IT_WITH_FAUCET=1 to use the local faucet.\n${String(
      lastError ?? ""
    ).trim()}`
  )
}

const replacePortInYaml = (
  contents: string,
  port: number,
  nextPort: number,
  faucetPort?: number
) => {
  const withRpcPort = contents.replace(
    /(localhost|127\.0\.0\.1|0\.0\.0\.0):9000\b/g,
    `$1:${port}`
  )
  const withWebsocketPort = withRpcPort.replace(
    /(localhost|127\.0\.0\.1|0\.0\.0\.0):9001\b/g,
    `$1:${nextPort}`
  )
  if (!faucetPort) return withWebsocketPort

  const withFaucetHost = withWebsocketPort.replace(
    /(localhost|127\.0\.0\.1|0\.0\.0\.0):9123\b/g,
    `$1:${faucetPort}`
  )
  return withFaucetHost.replace(/(port:\s*)(9123)\b/g, `$1${faucetPort}`)
}

const patchLocalnetConfigPorts = async (
  configDir: string,
  ports: LocalnetPorts
) => {
  if (
    ports.rpcPort === DEFAULT_RPC_PORT &&
    ports.websocketPort === DEFAULT_WEBSOCKET_PORT &&
    (ports.faucetPort === undefined || ports.faucetPort === DEFAULT_FAUCET_PORT)
  ) {
    return
  }

  const yamlFiles = await listYamlFiles(configDir)

  await Promise.all(
    yamlFiles.map(async (filePath) => {
      const contents = await readFile(filePath, "utf8")
      const updated = replacePortInYaml(
        contents,
        ports.rpcPort,
        ports.websocketPort,
        ports.faucetPort
      )
      if (updated !== contents) {
        await writeFile(filePath, updated, "utf8")
      }
    })
  )
}

const runSuiCommand = async (args: string[], env?: NodeJS.ProcessEnv) => {
  try {
    const result = await execFile("sui", args, {
      encoding: "utf8",
      env: { ...process.env, ...env }
    })

    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? ""
    }
  } catch (error) {
    const executionError = error as ExecException
    const stdout = executionError?.stdout?.toString()?.trim()
    const stderr = executionError?.stderr?.toString()?.trim()
    const message = executionError?.message?.trim()
    const details = [stdout, stderr, message].filter(Boolean).join("\n")
    throw new Error(
      `sui ${args.join(" ")} failed${details ? `:\n${details}` : ""}`
    )
  }
}

const ensureDirectory = async (dir: string) => {
  await mkdir(dir, { recursive: true })
}

const waitForRpcReady = async (
  rpcUrl: string,
  timeoutMs: number,
  intervalMs: number
) => {
  const start = Date.now()
  let lastError = "RPC probe failed"

  while (Date.now() - start < timeoutMs) {
    const probe = await probeRpcHealth(rpcUrl)
    if (probe.status === "running") {
      return probe.snapshot
    }
    lastError = probe.error
    await delay(intervalMs)
  }

  throw new Error(
    `Localnet RPC did not become ready within ${timeoutMs}ms at ${rpcUrl}: ${lastError}`
  )
}

const waitForPortInUse = async (
  port: number,
  timeoutMs: number,
  intervalMs: number
) => {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const isAvailable = await isPortAvailable(port)
    if (!isAvailable) return
    await delay(intervalMs)
  }

  throw new Error(
    `Localnet port ${port} did not become ready within ${timeoutMs}ms.`
  )
}

const startLocalnetProcess = async ({
  testId,
  withFaucet = false,
  keepTemp = false,
  rpcWaitTimeoutMs = 30_000
}: LocalnetStartOptions): Promise<LocalnetInstance> => {
  assertLocalnetEnabled()
  const tempDir = await createTempDir(buildTempPrefix(testId))
  const configDir = path.join(tempDir, "localnet-config")
  const logsDir = path.join(tempDir, "logs")
  await ensureDirectory(logsDir)
  await ensureDirectory(configDir)

  const ports = await resolveLocalnetPorts(withFaucet)
  const logPath = path.join(logsDir, "localnet.log")
  const logStream = createWriteStream(logPath, { flags: "a" })
  let processHandle: ChildProcess | undefined

  try {
    await runSuiCommand([
      "genesis",
      "--working-dir",
      configDir,
      ...(withFaucet ? ["--with-faucet"] : [])
    ])

    await patchLocalnetConfigPorts(configDir, ports)

    const args = ["start", "--network.config", configDir]
    if (withFaucet) args.push("--with-faucet")

    processHandle = spawn("sui", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SUI_CONFIG_DIR: configDir
      }
    })

    processHandle.stdout?.pipe(logStream)
    processHandle.stderr?.pipe(logStream)

    const rpcUrl = `http://127.0.0.1:${ports.rpcPort}`
    await waitForRpcReady(rpcUrl, rpcWaitTimeoutMs, 250)
    if (withFaucet && ports.faucetPort !== undefined) {
      await waitForPortInUse(ports.faucetPort, rpcWaitTimeoutMs, 250)
    }

    const suiClient = createSuiClient(rpcUrl)
    const faucetHost = withFaucet
      ? `http://127.0.0.1:${ports.faucetPort ?? DEFAULT_FAUCET_PORT}`
      : undefined
    let treasuryAccount: TestAccount | undefined

    try {
      treasuryAccount = await loadTreasuryAccount(configDir, suiClient)
    } catch (error) {
      if (!withFaucet) {
        throw error
      }
    }

    const stop = async () => {
      if (processHandle && processHandle.exitCode === null) {
        processHandle.kill("SIGTERM")
      }

      if (processHandle) {
        const exitPromise = once(processHandle, "exit")
        const timeout = delay(10_000).then(() => {
          if (processHandle && processHandle.exitCode === null) {
            processHandle.kill("SIGKILL")
          }
        })

        await Promise.race([exitPromise, timeout])
      }

      if (!keepTemp) {
        await rm(tempDir, { recursive: true, force: true })
      }
    }

    return {
      rpcUrl,
      configDir,
      logsDir,
      tempDir,
      process: processHandle,
      suiClient,
      treasuryAccount,
      faucetHost,
      stop
    }
  } catch (error) {
    if (processHandle && processHandle.exitCode === null) {
      processHandle.kill("SIGKILL")
    }
    if (!keepTemp) {
      await rm(tempDir, { recursive: true, force: true })
    }
    throw error
  }
}

const createAccountSeed = (testId: string, label: string) =>
  createHash("sha256").update(`${testId}:${label}`).digest()

const buildSuiConfig = ({
  rpcUrl,
  moveRootPath,
  artifactsDir
}: {
  rpcUrl: string
  moveRootPath: string
  artifactsDir: string
}): SuiResolvedConfig => ({
  defaultNetwork: "localnet",
  currentNetwork: "localnet",
  networks: {
    localnet: {
      networkName: "localnet",
      url: rpcUrl,
      gasBudget: DEFAULT_TX_GAS_BUDGET,
      account: {}
    }
  },
  paths: {
    move: moveRootPath,
    deployments: artifactsDir,
    artifacts: artifactsDir,
    objects: artifactsDir
  },
  network: {
    networkName: "localnet",
    url: rpcUrl,
    gasBudget: DEFAULT_TX_GAS_BUDGET,
    account: {}
  }
})

const copyMoveSources = async (destinationRoot: string) => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    ".."
  )
  const sourceRoot = path.join(repoRoot, "packages", "dapp", "move")
  await cp(sourceRoot, destinationRoot, { recursive: true })
  await removeMoveBuildArtifacts(destinationRoot)
}

const removeMoveBuildArtifacts = async (rootDir: string) => {
  const entries = await readdir(rootDir, { withFileTypes: true })

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "build") {
          await rm(fullPath, { recursive: true, force: true })
          return
        }
        await removeMoveBuildArtifacts(fullPath)
      }
    })
  )
}

const resolvePackagePath = (moveRootPath: string, packagePath: string) =>
  path.isAbsolute(packagePath)
    ? packagePath
    : path.join(moveRootPath, packagePath)

const withArtifactsDir = async <T>(
  artifactsDir: string,
  action: () => Promise<T>
) => withEnv({ SUI_ARTIFACTS_DIR: artifactsDir }, action)

const waitForTransactionFinality = async (
  suiClient: SuiClient,
  digest: string,
  timeoutMs: number,
  intervalMs: number
) => {
  const start = Date.now()
  let lastError = "Transaction not found"

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await suiClient.getTransactionBlock({
        digest,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
          showBalanceChanges: true,
          showInput: true
        }
      })
      if (response.effects) return response
      lastError = "Transaction missing effects"
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(intervalMs)
  }

  throw new Error(`Transaction ${digest} not finalized: ${lastError}`)
}

const waitForPackageAvailability = async ({
  suiClient,
  packageId,
  timeoutMs,
  intervalMs
}: {
  suiClient: SuiClient
  packageId: string
  timeoutMs: number
  intervalMs: number
}) => {
  const start = Date.now()
  let lastError = "package not found"

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await suiClient.getObject({
        id: packageId,
        options: { showContent: true, showType: true }
      })
      const content = response.data?.content
      if (content?.dataType === "package") return
      lastError = "package content not available"
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(intervalMs)
  }

  throw new Error(
    `Package ${packageId} not available on-chain within ${timeoutMs}ms: ${lastError}`
  )
}

const divideAndRoundUp = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator

const resolveFundingRequirements = (options?: {
  minimumBalance?: bigint
  minimumCoinObjects?: number
  minimumGasCoinBalance?: bigint
}) => {
  const minimumCoinObjects =
    options?.minimumCoinObjects ?? DEFAULT_MINIMUM_COIN_OBJECTS
  const minimumGasCoinBalance =
    options?.minimumGasCoinBalance ?? DEFAULT_MINIMUM_GAS_COIN_BALANCE
  const minimumBalance =
    options?.minimumBalance ??
    minimumGasCoinBalance * BigInt(minimumCoinObjects)

  return {
    minimumBalance,
    minimumCoinObjects,
    minimumGasCoinBalance
  }
}

const getAccountFundingSnapshot = async (
  suiClient: SuiClient,
  address: string,
  minimumGasCoinBalance: bigint
) => {
  const coins = await suiClient.getCoins({
    owner: address,
    coinType: "0x2::sui::SUI",
    limit: 50
  })
  const balances = coins.data.map((coin) => BigInt(coin.balance))
  const totalBalance = balances.reduce((sum, balance) => sum + balance, 0n)
  const hasSufficientGasCoin = balances.some(
    (balance) => balance >= minimumGasCoinBalance
  )

  return {
    coinCount: coins.data.length,
    totalBalance,
    hasSufficientGasCoin
  }
}

const fundAccountFromTreasury = async ({
  suiClient,
  suiConfig,
  treasuryAccount,
  recipientAddress,
  requirements
}: {
  suiClient: SuiClient
  suiConfig: SuiResolvedConfig
  treasuryAccount: TestAccount
  recipientAddress: string
  requirements: ReturnType<typeof resolveFundingRequirements>
}) => {
  const snapshot = await getAccountFundingSnapshot(
    suiClient,
    recipientAddress,
    requirements.minimumGasCoinBalance
  )
  const hasEnoughCoins = snapshot.coinCount >= requirements.minimumCoinObjects
  const hasEnoughBalance = snapshot.totalBalance >= requirements.minimumBalance
  const hasSufficientGasCoin = snapshot.hasSufficientGasCoin

  if (hasEnoughCoins && hasEnoughBalance && hasSufficientGasCoin) return

  const coinCount = Math.max(1, requirements.minimumCoinObjects)
  const perCoinAmount = divideAndRoundUp(
    requirements.minimumBalance,
    BigInt(coinCount)
  )
  const fundingAmount =
    perCoinAmount >= requirements.minimumGasCoinBalance
      ? perCoinAmount
      : requirements.minimumGasCoinBalance

  const transaction = newTransaction()
  transaction.setSender(treasuryAccount.address)

  const splitAmounts = Array.from({ length: coinCount }, () =>
    transaction.pure.u64(fundingAmount)
  )
  const splitCoins = transaction.splitCoins(transaction.gas, splitAmounts)
  const coins = Array.isArray(splitCoins) ? splitCoins : [splitCoins]

  coins.forEach((coin) => {
    transaction.transferObjects(
      [coin],
      transaction.pure.address(recipientAddress)
    )
  })

  await signAndExecute(
    { transaction, signer: treasuryAccount.keypair },
    { suiClient, suiConfig }
  )
}

const isFundingSufficient = (
  snapshot: Awaited<ReturnType<typeof getAccountFundingSnapshot>>,
  requirements: ReturnType<typeof resolveFundingRequirements>
) =>
  snapshot.coinCount >= requirements.minimumCoinObjects &&
  snapshot.totalBalance >= requirements.minimumBalance &&
  snapshot.hasSufficientGasCoin

const waitForFundingReady = async ({
  suiClient,
  recipientAddress,
  requirements,
  timeoutMs,
  intervalMs
}: {
  suiClient: SuiClient
  recipientAddress: string
  requirements: ReturnType<typeof resolveFundingRequirements>
  timeoutMs: number
  intervalMs: number
}) => {
  const start = Date.now()
  let snapshot = await getAccountFundingSnapshot(
    suiClient,
    recipientAddress,
    requirements.minimumGasCoinBalance
  )

  while (Date.now() - start < timeoutMs) {
    if (isFundingSufficient(snapshot, requirements)) {
      return { ready: true, snapshot }
    }
    await delay(intervalMs)
    snapshot = await getAccountFundingSnapshot(
      suiClient,
      recipientAddress,
      requirements.minimumGasCoinBalance
    )
  }

  return { ready: false, snapshot }
}

const formatFaucetErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const requestFaucetFundingWithRetry = async ({
  faucetHost,
  recipientAddress,
  attempts = DEFAULT_FAUCET_REQUEST_ATTEMPTS,
  delayMs = DEFAULT_FAUCET_REQUEST_DELAY_MS
}: {
  faucetHost: string
  recipientAddress: string
  attempts?: number
  delayMs?: number
}) => {
  let lastError: unknown

  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    try {
      await requestSuiFromFaucetV2({
        host: faucetHost,
        recipient: recipientAddress
      })
      return
    } catch (error) {
      lastError = error
      if (attemptIndex < attempts - 1) {
        await delay(delayMs)
      }
    }
  }

  throw new Error(
    `Faucet request failed after ${attempts} attempts: ${formatFaucetErrorMessage(
      lastError
    )}`
  )
}

const fundAccountWithFaucet = async ({
  suiClient,
  recipientAddress,
  requirements,
  faucetHost
}: {
  suiClient: SuiClient
  recipientAddress: string
  requirements: ReturnType<typeof resolveFundingRequirements>
  faucetHost: string
}) => {
  const existing = await getAccountFundingSnapshot(
    suiClient,
    recipientAddress,
    requirements.minimumGasCoinBalance
  )

  if (isFundingSufficient(existing, requirements)) return

  let lastSnapshot = existing
  let attempts = 0
  let lastError: unknown

  while (attempts < 5) {
    const missingCoins = Math.max(
      1,
      requirements.minimumCoinObjects - lastSnapshot.coinCount
    )

    try {
      for (let i = 0; i < missingCoins; i += 1) {
        await requestFaucetFundingWithRetry({
          faucetHost,
          recipientAddress
        })
      }
    } catch (error) {
      lastError = error
      attempts += 1
      await delay(DEFAULT_FAUCET_REQUEST_DELAY_MS)
      continue
    }

    const result = await waitForFundingReady({
      suiClient,
      recipientAddress,
      requirements,
      timeoutMs: 10_000,
      intervalMs: 250
    })

    if (result.ready) return

    lastSnapshot = result.snapshot
    attempts += 1
  }

  const errorDetails = lastError
    ? ` ${formatFaucetErrorMessage(lastError)}`
    : ""

  throw new Error(
    `Failed to fund ${recipientAddress} from local faucet at ${faucetHost}.${errorDetails}`
  )
}

export const createLocalnetHarness = () => {
  let instance: LocalnetInstance | undefined

  const start = async (options: LocalnetStartOptions) => {
    if (!instance) {
      instance = await startLocalnetProcess(options)
    }
    return instance
  }

  const get = () => {
    if (!instance) throw new Error("Localnet has not been started")
    return instance
  }

  const stop = async () => {
    if (instance) {
      await instance.stop()
      instance = undefined
    }
  }

  return { start, get, stop }
}

export const createTestContext = async (
  localnet: LocalnetInstance,
  testId: string
): Promise<TestContext> => {
  const tempDir = await createTempDir(buildTempPrefix(testId))
  const moveRootPath = path.join(tempDir, "move")
  const artifactsDir = path.join(tempDir, "artifacts")

  await ensureDirectory(artifactsDir)
  await copyMoveSources(moveRootPath)

  const suiConfig = buildSuiConfig({
    rpcUrl: localnet.rpcUrl,
    moveRootPath,
    artifactsDir
  })

  const createAccount = (label: string): TestAccount => {
    const seed = createAccountSeed(testId, label)
    const keypair = Ed25519Keypair.fromSecretKey(seed)
    return {
      label,
      keypair,
      address: keypair.toSuiAddress()
    }
  }

  const fundAccount = async (
    account: TestAccount,
    options?: {
      minimumBalance?: bigint
      minimumCoinObjects?: number
      minimumGasCoinBalance?: bigint
    }
  ) => {
    const requirements = resolveFundingRequirements(options)

    return withArtifactsDir(artifactsDir, () => {
      if (localnet.treasuryAccount) {
        return fundAccountFromTreasury({
          suiClient: localnet.suiClient,
          suiConfig,
          treasuryAccount: localnet.treasuryAccount,
          recipientAddress: account.address,
          requirements
        })
      }

      if (localnet.faucetHost) {
        return fundAccountWithFaucet({
          suiClient: localnet.suiClient,
          recipientAddress: account.address,
          requirements,
          faucetHost: localnet.faucetHost
        })
      }

      throw new Error(
        "Localnet funding unavailable. Start with SUI_IT_WITH_FAUCET=1 or set SUI_IT_TREASURY_INDEX."
      )
    })
  }

  const buildPackage = async (packageRelativePath: string) =>
    buildMovePackage(resolvePackagePath(moveRootPath, packageRelativePath))

  const publishPackage = async (
    packageRelativePath: string,
    account: TestAccount,
    options?: { gasBudget?: number; withUnpublishedDependencies?: boolean }
  ) =>
    withArtifactsDir(artifactsDir, () =>
      (async () => {
        const packagePath = resolvePackagePath(
          moveRootPath,
          packageRelativePath
        )
        await clearPublishedEntryForNetwork({
          packagePath,
          networkName: suiConfig.network.networkName
        })

        const artifacts = await publishPackageWithLog(
          {
            packagePath,
            keypair: account.keypair,
            gasBudget: options?.gasBudget,
            withUnpublishedDependencies:
              options?.withUnpublishedDependencies ?? true,
            useCliPublish: false,
            allowAutoUnpublishedDependencies: true
          },
          { suiClient: localnet.suiClient, suiConfig }
        )

        const rootArtifact = pickRootNonDependencyArtifact(artifacts)
        await waitForPackageAvailability({
          suiClient: localnet.suiClient,
          packageId: rootArtifact.packageId,
          timeoutMs: 20_000,
          intervalMs: 250
        })

        return artifacts
      })()
    )

  const signAndExecuteTransaction = async (
    transaction: Transaction,
    account: TestAccount,
    options?: { requestType?: "WaitForEffectsCert" | "WaitForLocalExecution" }
  ) =>
    withArtifactsDir(artifactsDir, async () => {
      transaction.setSender(account.address)
      const result = await signAndExecute(
        {
          transaction,
          signer: account.keypair,
          requestType: options?.requestType
        },
        { suiClient: localnet.suiClient, suiConfig }
      )
      return result.transactionResult
    })

  const waitForFinality = async (
    digest: string,
    options?: { timeoutMs?: number; intervalMs?: number }
  ) =>
    waitForTransactionFinality(
      localnet.suiClient,
      digest,
      options?.timeoutMs ?? 30_000,
      options?.intervalMs ?? 250
    )

  const queryEventsByTransaction = async (digest: string) => {
    const response = await localnet.suiClient.queryEvents({
      query: { Transaction: digest }
    })
    return response.data ?? []
  }

  const queryEventsByType = async (eventType: string) => {
    const response = await localnet.suiClient.queryEvents({
      query: { MoveEventType: eventType }
    })
    return response.data ?? []
  }

  const cleanup = async () => {
    await rm(tempDir, { recursive: true, force: true })
  }

  return {
    testId,
    localnet,
    tempDir,
    moveRootPath,
    artifactsDir,
    suiClient: localnet.suiClient,
    suiConfig,
    createAccount,
    fundAccount,
    buildMovePackage: buildPackage,
    publishPackage,
    signAndExecuteTransaction,
    waitForFinality,
    queryEventsByTransaction,
    queryEventsByType,
    cleanup
  }
}

export const withTestContext = async <T>(
  localnet: LocalnetInstance,
  testId: string,
  action: (context: TestContext) => Promise<T>
): Promise<T> => {
  const context = await createTestContext(localnet, testId)
  try {
    return await action(context)
  } finally {
    await context.cleanup()
  }
}
