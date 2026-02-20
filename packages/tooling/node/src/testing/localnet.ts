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
  mkdir,
  mkdtemp,
  open,
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
import { promisify } from "node:util"

import type {
  SuiClient,
  SuiEvent,
  SuiTransactionBlockResponse
} from "@mysten/sui/client"
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { Transaction } from "@mysten/sui/transactions"

import {
  newTransaction,
  resolveSplitCoinResult
} from "@sui-oracle-market/tooling-core/transactions"
import type {
  BuildOutput,
  PublishArtifact
} from "@sui-oracle-market/tooling-core/types"
import { formatErrorMessage } from "@sui-oracle-market/tooling-core/utils/errors"
import { withArtifactsRoot } from "../artifacts.ts"
import type { SuiResolvedConfig } from "../config.ts"
import { loadSuiConfig } from "../config.ts"
import { DEFAULT_TX_GAS_BUDGET, SUI_COIN_TYPE } from "../constants.ts"
import {
  buildKeystoreEntry,
  loadKeypair,
  readKeystoreEntries
} from "../keypair.ts"
import { probeRpcHealth } from "../localnet.ts"
import { resolveChainIdentifier } from "../move-toml.ts"
import {
  buildMoveEnvironmentFlags,
  buildMovePackage,
  clearPublishedEntryForNetwork,
  resolveMoveCliEnvironmentName
} from "../move.ts"
import { pickRootNonDependencyArtifact } from "../package.ts"
import { publishPackageWithLog } from "../publish.ts"
import { createSuiClient } from "../sui-client.ts"
import { signAndExecute } from "../transactions.ts"
import { getErrnoCode } from "../utils/fs.ts"
import { parseBooleanEnv } from "./booleans.ts"
import { parseNonNegativeInteger, parsePositiveInteger } from "./numbers.ts"
import { pollWithTimeout } from "./poll.ts"

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

export type TestContextOptions = {
  moveSourceRootPath?: string
}

const DEFAULT_RPC_PORT = 9000
const DEFAULT_WEBSOCKET_PORT = 9001
const DEFAULT_FAUCET_PORT = 9123
const DEFAULT_MINIMUM_COIN_OBJECTS = 2
const DEFAULT_MINIMUM_GAS_COIN_BALANCE = 500_000_000n
const DEFAULT_FAUCET_REQUEST_ATTEMPTS = 1
const DEFAULT_FAUCET_REQUEST_DELAY_MS = 50

const createTempDir = async (prefix = "tooling-test-") =>
  mkdtemp(path.join(os.tmpdir(), prefix))

type EnvOverrideEntry = {
  token: symbol
  value: string | undefined
}

type EnvOverrideState = {
  baseline: string | undefined
  overrides: EnvOverrideEntry[]
}

const envOverrideStacks = new Map<string, EnvOverrideState>()

const setEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete process.env[key]
    return
  }
  process.env[key] = value
}

const applyEnvOverride = (key: string, value: string | undefined) => {
  const token = Symbol(key)
  const existing = envOverrideStacks.get(key)
  if (!existing) {
    envOverrideStacks.set(key, {
      baseline: process.env[key],
      overrides: [{ token, value }]
    })
  } else {
    existing.overrides.push({ token, value })
  }

  setEnvValue(key, value)
  return token
}

const releaseEnvOverride = (key: string, token: symbol) => {
  const state = envOverrideStacks.get(key)
  if (!state) return

  const index = state.overrides.findIndex((entry) => entry.token === token)
  if (index === -1) return

  state.overrides.splice(index, 1)

  const next = state.overrides[state.overrides.length - 1]
  if (next) {
    setEnvValue(key, next.value)
    return
  }

  envOverrideStacks.delete(key)
  setEnvValue(key, state.baseline)
}

const withEnv = async <T>(
  updates: Record<string, string | undefined>,
  action: () => Promise<T> | T
): Promise<T> => {
  const applied = Object.entries(updates).map(([key, value]) => ({
    key,
    token: applyEnvOverride(key, value)
  }))

  try {
    return await action()
  } finally {
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const entry = applied[index]
      releaseEnvOverride(entry.key, entry.token)
    }
  }
}

const execFile = promisify(execFileCallback)

const sanitizeLabel = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9-_]/g, "-")

const buildTempPrefix = (label: string) => `sui-it-${sanitizeLabel(label)}-`

const LOCALNET_SKIP_ENV_KEYS = ["SUI_IT_SKIP_LOCALNET", "SKIP_LOCALNET"]

const shouldUseRandomPorts = () => {
  if (process.env.SUI_IT_RANDOM_PORTS !== undefined) {
    return parseBooleanEnv(process.env.SUI_IT_RANDOM_PORTS)
  }
  return true
}

const resolveSkipLocalnetEnvKey = () =>
  LOCALNET_SKIP_ENV_KEYS.find((key) => parseBooleanEnv(process.env[key]))

const shouldDebugMove = () => parseBooleanEnv(process.env.SUI_IT_DEBUG_MOVE)

const logMoveDebug = (message: string) => {
  if (!shouldDebugMove()) return

  console.warn(`[move-debug] ${message}`)
}

const extractMoveEnvironmentBlock = (contents: string) => {
  const lines = contents.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    /^\s*\[environments\]\s*(#.*)?$/.test(line)
  )

  if (headerIndex < 0) return "missing [environments] section"

  const blockLines: string[] = []
  for (let index = headerIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (index !== headerIndex && /^\s*\[[^\]]+\]\s*(#.*)?$/.test(line)) {
      break
    }
    blockLines.push(line)
  }

  return blockLines.join("\n")
}

const logMovePackageDebug = async (label: string, packagePath: string) => {
  if (!shouldDebugMove()) return

  const moveTomlPath = path.join(packagePath, "Move.toml")
  const moveLockPath = path.join(packagePath, "Move.lock")

  logMoveDebug(`${label} packagePath=${packagePath}`)

  try {
    const moveTomlContents = await readFile(moveTomlPath, "utf8")
    const environmentBlock = extractMoveEnvironmentBlock(moveTomlContents)
    const hasLocalnetEnvironment = /^\s*localnet\s*=\s*"[^"]*"/m.test(
      moveTomlContents
    )
    logMoveDebug(`${label} Move.toml environments:\n${environmentBlock}`)
    logMoveDebug(
      `${label} Move.toml localnet entry=${hasLocalnetEnvironment ? "present" : "missing"}`
    )
  } catch (error) {
    logMoveDebug(
      `${label} Move.toml read failed (${formatErrorMessage(error)})`
    )
  }

  try {
    const moveLockContents = await readFile(moveLockPath, "utf8")
    const hasLocalnetPinned = /\[pinned\.localnet\./.test(moveLockContents)
    logMoveDebug(
      `${label} Move.lock localnet pinned sections=${hasLocalnetPinned ? "present" : "missing"}`
    )
  } catch (error) {
    logMoveDebug(
      `${label} Move.lock read failed (${formatErrorMessage(error)})`
    )
  }
}

const assertLocalnetEnabled = () => {
  const skipKey = resolveSkipLocalnetEnvKey()
  if (!skipKey) return
  throw new Error(
    `Localnet execution is disabled via ${skipKey}. Unset it to run localnet tests.`
  )
}

const isPortPermissionError = (error: unknown) => {
  const code = getErrnoCode(error)
  return code === "EPERM" || code === "EACCES"
}

const createLocalnetPortPermissionError = (action: string, error: unknown) => {
  const code = getErrnoCode(error) ?? "unknown"
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

const resolveAvailablePortExcluding = async (allocatedPorts: Set<number>) => {
  let port = await getAvailablePort()
  while (allocatedPorts.has(port)) {
    port = await getAvailablePort()
  }
  allocatedPorts.add(port)
  return port
}

const collectMatchedPorts = (contents: string, pattern: RegExp) => {
  const ports = new Set<number>()
  for (const match of contents.matchAll(pattern)) {
    const port = Number.parseInt(match[1] ?? "", 10)
    if (Number.isInteger(port)) ports.add(port)
  }
  return ports
}

const collectPortsFromYamlContents = (contents: string) => {
  const ports = new Set<number>()
  const hostPortPattern = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/g
  const tcpPattern = /\/tcp\/(\d{2,5})\b/g
  const udpPattern = /\/udp\/(\d{2,5})\b/g
  const portFieldPattern =
    /(?:^|\s)(?:port|[A-Za-z0-9_-]+(?:_|-)port)\s*:\s*(\d{2,5})\b/gm

  collectMatchedPorts(contents, hostPortPattern).forEach((port) =>
    ports.add(port)
  )
  collectMatchedPorts(contents, tcpPattern).forEach((port) => ports.add(port))
  collectMatchedPorts(contents, udpPattern).forEach((port) => ports.add(port))
  collectMatchedPorts(contents, portFieldPattern).forEach((port) =>
    ports.add(port)
  )

  return ports
}

const buildPortRemap = async ({
  yamlFileContents,
  ports
}: {
  yamlFileContents: string[]
  ports: LocalnetPorts
}) => {
  const portRemap = new Map<number, number>()
  const allocatedPorts = new Set<number>()

  const registerPortMapping = (originalPort: number, mappedPort: number) => {
    portRemap.set(originalPort, mappedPort)
    allocatedPorts.add(mappedPort)
  }

  registerPortMapping(DEFAULT_RPC_PORT, ports.rpcPort)
  registerPortMapping(DEFAULT_WEBSOCKET_PORT, ports.websocketPort)
  if (ports.faucetPort !== undefined) {
    registerPortMapping(DEFAULT_FAUCET_PORT, ports.faucetPort)
  }

  const discoveredPortsInConfig = new Set<number>()
  yamlFileContents.forEach((contents) => {
    collectPortsFromYamlContents(contents).forEach((port) =>
      discoveredPortsInConfig.add(port)
    )
  })

  for (const port of discoveredPortsInConfig) {
    if (portRemap.has(port)) continue
    const mappedPort = await resolveAvailablePortExcluding(allocatedPorts)
    registerPortMapping(port, mappedPort)
  }

  return portRemap
}

const buildDefaultPortRemap = (ports: LocalnetPorts) => {
  const entries: Array<[number, number]> = [
    [DEFAULT_RPC_PORT, ports.rpcPort],
    [DEFAULT_WEBSOCKET_PORT, ports.websocketPort]
  ]

  if (ports.faucetPort !== undefined) {
    entries.push([DEFAULT_FAUCET_PORT, ports.faucetPort])
  }

  return new Map<number, number>(entries)
}

const resolveRemappedPort = (portRemap: Map<number, number>, port: string) => {
  const originalPort = Number.parseInt(port, 10)
  if (!Number.isInteger(originalPort)) return port
  return String(portRemap.get(originalPort) ?? originalPort)
}

const replacePortsInYamlContents = (
  contents: string,
  portRemap: Map<number, number>
) => {
  const hostPortPattern = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/g
  const tcpPattern = /\/tcp\/(\d{2,5})\b/g
  const udpPattern = /\/udp\/(\d{2,5})\b/g
  const portFieldPattern =
    /(^|\s)(port|[A-Za-z0-9_-]+(?:_|-)port)(\s*:\s*)(\d{2,5})\b/gm

  let updated = contents.replace(hostPortPattern, (match, port) =>
    match.replace(port, resolveRemappedPort(portRemap, port))
  )
  updated = updated.replace(tcpPattern, (match, port) =>
    match.replace(port, resolveRemappedPort(portRemap, port))
  )
  updated = updated.replace(udpPattern, (match, port) =>
    match.replace(port, resolveRemappedPort(portRemap, port))
  )
  updated = updated.replace(
    portFieldPattern,
    (match, leadingSpace, key, spacing, port) =>
      `${leadingSpace}${key}${spacing}${resolveRemappedPort(portRemap, port)}`
  )

  return updated
}

const resolveRandomPorts = async (
  withFaucet: boolean
): Promise<LocalnetPorts> => {
  const allocatedPorts = new Set<number>()
  const rpcPort = await resolveAvailablePortExcluding(allocatedPorts)
  const websocketPort = await resolveAvailablePortExcluding(allocatedPorts)
  const faucetPort = withFaucet
    ? await resolveAvailablePortExcluding(allocatedPorts)
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

const resolveLocalnetStartLockPath = () =>
  path.join(os.tmpdir(), "sui-it-localnet-start.lock")

const resolveLocalnetStartLockTimeoutMs = () =>
  parsePositiveInteger(process.env.SUI_IT_LOCALNET_START_LOCK_TIMEOUT_MS) ??
  120_000

const resolveLocalnetStartLockIntervalMs = () =>
  parsePositiveInteger(process.env.SUI_IT_LOCALNET_START_LOCK_INTERVAL_MS) ??
  250

const shouldSerializeLocalnetStart = () => {
  if (process.env.SUI_IT_SERIALIZE_LOCALNET_START !== undefined) {
    return parseBooleanEnv(process.env.SUI_IT_SERIALIZE_LOCALNET_START)
  }
  return parseBooleanEnv(process.env.CI)
}

const resolveLocalnetStartLockOwnerPid = async (lockPath: string) => {
  try {
    const contents = await readFile(lockPath, "utf8")
    const parsed = Number.parseInt(contents.trim(), 10)
    if (!Number.isInteger(parsed) || parsed <= 0) return undefined
    return parsed
  } catch {
    return undefined
  }
}

const isProcessRunning = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return getErrnoCode(error) !== "ESRCH"
  }
}

const tryReleaseStaleLocalnetStartLock = async (lockPath: string) => {
  const pid = await resolveLocalnetStartLockOwnerPid(lockPath)
  if (!pid) return
  if (isProcessRunning(pid)) return
  await rm(lockPath, { force: true })
}

const tryAcquireLocalnetStartLock = async (lockPath: string) => {
  try {
    const handle = await open(lockPath, "wx")
    await handle.writeFile(`${process.pid}\n`)
    return handle
  } catch (error) {
    if (getErrnoCode(error) === "EEXIST") return undefined
    throw error
  }
}

const withLocalnetStartLock = async <T>(action: () => Promise<T>) => {
  if (!shouldSerializeLocalnetStart()) return action()

  const lockPath = resolveLocalnetStartLockPath()
  const timeoutMs = resolveLocalnetStartLockTimeoutMs()
  const intervalMs = resolveLocalnetStartLockIntervalMs()
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const handle = await tryAcquireLocalnetStartLock(lockPath)
    if (handle) {
      try {
        return await action()
      } finally {
        await handle.close()
        await rm(lockPath, { force: true })
      }
    }

    await tryReleaseStaleLocalnetStartLock(lockPath)
    await delay(intervalMs)
  }

  throw new Error(
    `Timed out while waiting for the localnet start lock at ${lockPath}.`
  )
}

const buildTreasuryIndexCandidates = (entryCount: number) => {
  const indices = Array.from({ length: entryCount }, (_, index) => index)
  const overrideIndex = parseNonNegativeInteger(
    process.env.SUI_IT_TREASURY_INDEX
  )
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
        coinType: SUI_COIN_TYPE,
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
    parseNonNegativeInteger(process.env.SUI_IT_TREASURY_INDEX) === undefined
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

const patchLocalnetPortsInYamlFiles = async (
  yamlFilePaths: string[],
  ports: LocalnetPorts
) => {
  if (yamlFilePaths.length === 0) return
  const hasCustomRpcPort = ports.rpcPort !== DEFAULT_RPC_PORT
  const hasCustomWebsocketPort = ports.websocketPort !== DEFAULT_WEBSOCKET_PORT
  const hasCustomFaucetPort =
    ports.faucetPort !== undefined && ports.faucetPort !== DEFAULT_FAUCET_PORT
  const shouldPatchAllPorts =
    shouldUseRandomPorts() ||
    hasCustomRpcPort ||
    hasCustomWebsocketPort ||
    hasCustomFaucetPort

  if (!shouldPatchAllPorts) {
    if (
      ports.rpcPort === DEFAULT_RPC_PORT &&
      ports.websocketPort === DEFAULT_WEBSOCKET_PORT &&
      (ports.faucetPort === undefined ||
        ports.faucetPort === DEFAULT_FAUCET_PORT)
    ) {
      return
    }
  }

  const yamlFileContents = await Promise.all(
    yamlFilePaths.map((filePath) => readFile(filePath, "utf8"))
  )

  const portRemap = shouldPatchAllPorts
    ? await buildPortRemap({ yamlFileContents, ports })
    : buildDefaultPortRemap(ports)

  await Promise.all(
    yamlFilePaths.map(async (filePath, index) => {
      const contents = yamlFileContents[index] ?? ""
      const updated = shouldPatchAllPorts
        ? replacePortsInYamlContents(contents, portRemap)
        : replacePortInYaml(
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

const buildIsolatedSuiEnv = (configDir: string) => ({
  ...process.env,
  SUI_CONFIG_DIR: configDir,
  SUI_LOCALNET_CONFIG_DIR: configDir
})

const ensureDirectory = async (dir: string) => {
  await mkdir(dir, { recursive: true })
}

const readLogTail = async (logPath?: string, maxLines = 200) => {
  if (!logPath) return ""

  try {
    const contents = await readFile(logPath, "utf8")
    if (!contents) return ""
    const lines = contents.trimEnd().split(/\r?\n/)
    return lines.slice(-maxLines).join("\n")
  } catch {
    return ""
  }
}

const ensureProcessRunning = async (
  processHandle?: ChildProcess,
  logPath?: string
) => {
  if (!processHandle) return

  const exitCode = processHandle.exitCode
  const signalCode = processHandle.signalCode
  if (exitCode === null && !signalCode) return

  const logTail = await readLogTail(logPath)
  const exitSummary = [
    exitCode !== null ? `code ${exitCode}` : null,
    signalCode ? `signal ${signalCode}` : null
  ]
    .filter(Boolean)
    .join(", ")

  throw new Error(
    [
      `Localnet process exited (${exitSummary || "unknown exit"}).`,
      logTail ? `Localnet log tail:\n${logTail}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  )
}

const waitForRpcReady = async (
  rpcUrl: string,
  timeoutMs: number,
  intervalMs: number,
  options?: { processHandle?: ChildProcess; logPath?: string }
) => {
  const defaultError = "RPC probe failed"
  const pollResult = await pollWithTimeout({
    timeoutMs,
    intervalMs,
    shouldAbortOnError: () => true,
    attempt: async () => {
      await ensureProcessRunning(options?.processHandle, options?.logPath)

      const probe = await probeRpcHealth(rpcUrl)
      if (probe.status === "running") {
        return { done: true, result: probe.snapshot }
      }

      return { done: false, errorMessage: probe.error }
    }
  })

  if (!pollResult.timedOut && pollResult.result) {
    return pollResult.result
  }

  const logTail = await readLogTail(options?.logPath)
  const lastError = pollResult.errorMessage ?? defaultError
  throw new Error(
    [
      `Localnet RPC did not become ready within ${timeoutMs}ms at ${rpcUrl}: ${lastError}`,
      logTail ? `Localnet log tail:\n${logTail}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  )
}

const waitForPortInUse = async (
  port: number,
  timeoutMs: number,
  intervalMs: number,
  options?: { processHandle?: ChildProcess; logPath?: string }
) => {
  const pollResult = await pollWithTimeout({
    timeoutMs,
    intervalMs,
    shouldAbortOnError: () => true,
    attempt: async () => {
      await ensureProcessRunning(options?.processHandle, options?.logPath)

      const isAvailable = await isPortAvailable(port)
      if (!isAvailable) return { done: true }

      return { done: false }
    }
  })

  if (!pollResult.timedOut) return

  const logTail = await readLogTail(options?.logPath)
  throw new Error(
    [
      `Localnet port ${port} did not become ready within ${timeoutMs}ms.`,
      logTail ? `Localnet log tail:\n${logTail}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  )
}

const buildFaucetHostPort = (ports: LocalnetPorts) => {
  if (ports.faucetPort === undefined) return undefined
  return `127.0.0.1:${ports.faucetPort}`
}

const buildLocalnetStartArgs = (
  configDir: string,
  ports: LocalnetPorts,
  withFaucet: boolean
) => {
  const args = [
    "start",
    "--network.config",
    configDir,
    "--fullnode-rpc-port",
    String(ports.rpcPort)
  ]
  if (withFaucet) {
    const faucetHostPort = buildFaucetHostPort(ports)
    if (faucetHostPort) {
      args.push(`--with-faucet=${faucetHostPort}`)
    } else {
      args.push("--with-faucet")
    }
  }

  return args
}

const startLocalnetProcess = async ({
  testId,
  withFaucet = false,
  keepTemp = false,
  rpcWaitTimeoutMs = 10_000
}: LocalnetStartOptions): Promise<LocalnetInstance> => {
  assertLocalnetEnabled()
  return withLocalnetStartLock(async () => {
    const tempDir = await createTempDir(buildTempPrefix(testId))
    const configDir = path.join(tempDir, "localnet-config")
    const logsDir = path.join(tempDir, "logs")
    const configSeedPath = path.join(tempDir, "genesis-config.yaml")
    const localnetEnv = buildIsolatedSuiEnv(configDir)
    await ensureDirectory(logsDir)
    await ensureDirectory(configDir)

    const ports = await resolveLocalnetPorts(withFaucet)
    const logPath = path.join(logsDir, "localnet.log")
    const logStream = createWriteStream(logPath, { flags: "a" })
    let processHandle: ChildProcess | undefined

    try {
      logStream.write(
        `[tooling] localnet ports rpc=${ports.rpcPort} ws=${ports.websocketPort} faucet=${ports.faucetPort ?? "disabled"}\n`
      )

      await runSuiCommand(
        [
          "genesis",
          "--write-config",
          configSeedPath,
          ...(withFaucet ? ["--with-faucet"] : [])
        ],
        localnetEnv
      )

      await patchLocalnetPortsInYamlFiles([configSeedPath], ports)

      await runSuiCommand(
        [
          "genesis",
          "--from-config",
          configSeedPath,
          "--working-dir",
          configDir
        ],
        localnetEnv
      )

      const args = buildLocalnetStartArgs(configDir, ports, withFaucet)

      processHandle = spawn("sui", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: localnetEnv
      })

      processHandle.stdout?.pipe(logStream)
      processHandle.stderr?.pipe(logStream)

      const rpcUrl = `http://127.0.0.1:${ports.rpcPort}`
      await waitForRpcReady(rpcUrl, rpcWaitTimeoutMs, 250, {
        processHandle,
        logPath
      })
      if (withFaucet && ports.faucetPort !== undefined) {
        await waitForPortInUse(ports.faucetPort, rpcWaitTimeoutMs, 250, {
          processHandle,
          logPath
        })
      }

      const suiClient = createSuiClient(rpcUrl)
      const faucetHostPort = buildFaucetHostPort(ports)
      const faucetHost =
        withFaucet && faucetHostPort ? `http://${faucetHostPort}` : undefined
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
  })
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

const buildAccountKeystorePath = (artifactsDir: string, account: TestAccount) =>
  path.join(
    artifactsDir,
    "keystore",
    `${sanitizeLabel(account.label)}.keystore`
  )

const ensureAccountKeystore = async (
  artifactsDir: string,
  account: TestAccount
) => {
  const keystoreDir = path.join(artifactsDir, "keystore")
  await ensureDirectory(keystoreDir)
  const keystorePath = buildAccountKeystorePath(artifactsDir, account)
  const entry = buildKeystoreEntry(account.keypair)
  await writeFile(keystorePath, JSON.stringify([entry], undefined, 2))
  return { keystorePath, entry }
}

const ensureAccountRegisteredInLocalnetKeystore = async (
  configDir: string,
  entry: string
) => {
  const keystorePath = await resolveLocalnetKeystorePath(configDir)
  const entries = await readKeystoreEntries(keystorePath)
  if (entries.includes(entry)) return keystorePath

  await writeFile(
    keystorePath,
    JSON.stringify([...entries, entry], undefined, 2)
  )

  return keystorePath
}

const withKeystoreConfig = (
  suiConfig: SuiResolvedConfig,
  keystorePath: string
): SuiResolvedConfig => {
  const networkName = suiConfig.network.networkName
  const baseNetwork = suiConfig.networks[networkName] ?? suiConfig.network
  const networkWithKeystore = {
    ...baseNetwork,
    account: {
      ...(baseNetwork.account ?? {}),
      keystorePath
    }
  }

  return {
    ...suiConfig,
    network: {
      ...suiConfig.network,
      account: {
        ...(suiConfig.network.account ?? {}),
        keystorePath
      }
    },
    networks: {
      ...suiConfig.networks,
      [networkName]: networkWithKeystore
    }
  }
}

const resolveMoveSourceRootPath = async (sourceRoot?: string) => {
  if (sourceRoot) return sourceRoot
  const suiConfig = await loadSuiConfig()
  return suiConfig.paths.move
}

const copyMoveSources = async (
  destinationRoot: string,
  sourceRoot?: string
) => {
  const resolvedSourceRoot = await resolveMoveSourceRootPath(sourceRoot)
  await cp(resolvedSourceRoot, destinationRoot, { recursive: true })
  await removeMoveBuildArtifacts(destinationRoot)
}

const listMoveTomlFiles = async (rootDir: string): Promise<string[]> => {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files: string[] = []

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await listMoveTomlFiles(fullPath)))
      } else if (entry.isFile() && entry.name === "Move.toml") {
        files.push(fullPath)
      }
    })
  )

  return files
}

const resolveLocalnetMoveEnvironmentName = () =>
  resolveMoveCliEnvironmentName("localnet") ?? "test-publish"

const buildEnvironmentEntryLine = (environmentName: string, chainId: string) =>
  `${environmentName} = "${chainId}"`

const buildEnvironmentEntryRegex = (environmentName: string) =>
  new RegExp(`^\\s*${environmentName}\\s*=\\s*"[^"]*"`, "m")

const ensureMoveTomlEnvironmentEntry = async ({
  moveTomlPath,
  environmentName,
  chainId
}: {
  moveTomlPath: string
  environmentName: string
  chainId: string
}) => {
  const contents = await readFile(moveTomlPath, "utf8")
  const entryRegex = buildEnvironmentEntryRegex(environmentName)
  if (entryRegex.test(contents)) return

  const entryLine = buildEnvironmentEntryLine(environmentName, chainId)

  if (/^\s*\[environments\]\s*$/m.test(contents)) {
    const updated = contents.replace(
      /^\s*\[environments\]\s*$/m,
      `[environments]\n${entryLine}`
    )
    if (updated !== contents) {
      await writeFile(moveTomlPath, updated, "utf8")
    }
    return
  }

  const suffix = contents.endsWith("\n") ? "" : "\n"
  const updated = `${contents}${suffix}\n[environments]\n${entryLine}\n`
  await writeFile(moveTomlPath, updated, "utf8")
}

const ensureLocalnetEnvironmentEntry = async (
  moveRootPath: string,
  chainId: string
) => {
  const moveEnvironmentName = resolveLocalnetMoveEnvironmentName()
  const moveTomlFiles = await listMoveTomlFiles(moveRootPath)

  await Promise.all(
    moveTomlFiles.map(async (moveTomlPath) => {
      await ensureMoveTomlEnvironmentEntry({
        moveTomlPath,
        environmentName: moveEnvironmentName,
        chainId
      })
    })
  )
}

const ensureLocalnetEnvironmentEntryForPackage = async (
  packagePath: string,
  chainId: string
) => {
  const moveEnvironmentName = resolveLocalnetMoveEnvironmentName()
  const moveTomlPath = path.join(packagePath, "Move.toml")
  await ensureMoveTomlEnvironmentEntry({
    moveTomlPath,
    environmentName: moveEnvironmentName,
    chainId
  })
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

const clearPublishedMetadataForNetwork = async (
  rootDir: string,
  networkName: string
) => {
  const entries = await readdir(rootDir, { withFileTypes: true })

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name)
      if (entry.isDirectory()) {
        await clearPublishedMetadataForNetwork(entryPath, networkName)
        return
      }

      if (!entry.isFile() || entry.name !== "Published.toml") return

      await clearPublishedEntryForNetwork({
        packagePath: path.dirname(entryPath),
        networkName
      })
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
) => withArtifactsRoot(artifactsDir, action)

const waitForTransactionFinality = async (
  suiClient: SuiClient,
  digest: string,
  timeoutMs: number,
  intervalMs: number
) => {
  const defaultError = "Transaction not found"
  const pollResult = await pollWithTimeout({
    timeoutMs,
    intervalMs,
    attempt: async () => {
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
      if (response.effects) return { done: true, result: response }
      return { done: false, errorMessage: "Transaction missing effects" }
    }
  })

  if (!pollResult.timedOut && pollResult.result) {
    return pollResult.result
  }

  const lastError = pollResult.errorMessage ?? defaultError
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
  const defaultError = "package not found"
  const pollResult = await pollWithTimeout({
    timeoutMs,
    intervalMs,
    attempt: async () => {
      const response = await suiClient.getObject({
        id: packageId,
        options: { showContent: true, showType: true }
      })
      const content = response.data?.content
      if (content?.dataType === "package") return { done: true }
      return { done: false, errorMessage: "package content not available" }
    }
  })

  if (!pollResult.timedOut) return

  const lastError = pollResult.errorMessage ?? defaultError
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
    coinType: SUI_COIN_TYPE,
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
  const coins = Array.from({ length: coinCount }, (_, index) =>
    resolveSplitCoinResult(splitCoins, index)
  )

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
  const initialSnapshot = await getAccountFundingSnapshot(
    suiClient,
    recipientAddress,
    requirements.minimumGasCoinBalance
  )

  if (isFundingSufficient(initialSnapshot, requirements)) {
    return { ready: true, snapshot: initialSnapshot }
  }

  const pollResult = await pollWithTimeout({
    timeoutMs,
    intervalMs,
    attempt: async () => {
      const snapshot = await getAccountFundingSnapshot(
        suiClient,
        recipientAddress,
        requirements.minimumGasCoinBalance
      )
      const ready = isFundingSufficient(snapshot, requirements)
      return { done: ready, result: snapshot }
    }
  })

  if (!pollResult.timedOut && pollResult.result) {
    return { ready: true, snapshot: pollResult.result }
  }

  return {
    ready: false,
    snapshot: pollResult.result ?? initialSnapshot
  }
}

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

  const errorMessage = lastError
    ? formatErrorMessage(lastError)
    : "Unknown error"
  throw new Error(
    `Faucet request failed after ${attempts} attempts: ${errorMessage}`
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

  const errorDetails = lastError ? ` ${formatErrorMessage(lastError)}` : ""

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
  testId: string,
  options?: TestContextOptions
): Promise<TestContext> => {
  const tempDir = await createTempDir(buildTempPrefix(testId))
  const moveRootPath = path.join(tempDir, "contracts")
  const artifactsDir = path.join(tempDir, "artifacts")

  await ensureDirectory(artifactsDir)
  await copyMoveSources(moveRootPath, options?.moveSourceRootPath)

  const suiConfig = buildSuiConfig({
    rpcUrl: localnet.rpcUrl,
    moveRootPath,
    artifactsDir
  })
  const buildEnvironmentFlags = buildMoveEnvironmentFlags({
    environmentName: suiConfig.network.networkName
  })

  const localnetChainId =
    (await resolveChainIdentifier(
      { environmentName: "localnet" },
      { suiClient: localnet.suiClient, suiConfig }
    )) ?? "00000000"
  await ensureLocalnetEnvironmentEntry(moveRootPath, localnetChainId)

  await clearPublishedMetadataForNetwork(
    moveRootPath,
    suiConfig.network.networkName
  )

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
    withEnv(
      {
        SUI_CONFIG_DIR: localnet.configDir,
        SUI_LOCALNET_CONFIG_DIR: localnet.configDir
      },
      async () => {
        const packagePath = resolvePackagePath(
          moveRootPath,
          packageRelativePath
        )
        await ensureLocalnetEnvironmentEntryForPackage(
          packagePath,
          localnetChainId
        )
        await logMovePackageDebug("build", packagePath)
        return buildMovePackage(packagePath, buildEnvironmentFlags)
      }
    )

  const publishPackage = async (
    packageRelativePath: string,
    account: TestAccount,
    options?: { gasBudget?: number; withUnpublishedDependencies?: boolean }
  ) =>
    withArtifactsDir(artifactsDir, async () => {
      const { keystorePath, entry } = await ensureAccountKeystore(
        artifactsDir,
        account
      )
      const cliKeystorePath = await ensureAccountRegisteredInLocalnetKeystore(
        localnet.configDir,
        entry
      )

      return withEnv(
        {
          SUI_CONFIG_DIR: localnet.configDir,
          SUI_LOCALNET_CONFIG_DIR: localnet.configDir,
          SUI_KEYSTORE_PATH: keystorePath
        },
        async () => {
          const packagePath = resolvePackagePath(
            moveRootPath,
            packageRelativePath
          )
          await ensureLocalnetEnvironmentEntryForPackage(
            packagePath,
            localnetChainId
          )
          await logMovePackageDebug("publish", packagePath)
          await clearPublishedEntryForNetwork({
            packagePath,
            networkName: suiConfig.network.networkName
          })
          const publishConfig = withKeystoreConfig(suiConfig, cliKeystorePath)

          const artifacts = await publishPackageWithLog(
            {
              packagePath,
              keypair: account.keypair,
              gasBudget: options?.gasBudget,
              withUnpublishedDependencies:
                options?.withUnpublishedDependencies ?? true,
              useCliPublish: true,
              allowAutoUnpublishedDependencies: true
            },
            { suiClient: localnet.suiClient, suiConfig: publishConfig }
          )

          const rootArtifact = pickRootNonDependencyArtifact(artifacts)
          await waitForPackageAvailability({
            suiClient: localnet.suiClient,
            packageId: rootArtifact.packageId,
            timeoutMs: 20_000,
            intervalMs: 250
          })

          return artifacts
        }
      )
    })

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
  action: (context: TestContext) => Promise<T>,
  options?: TestContextOptions
): Promise<T> => {
  const context = await createTestContext(localnet, testId, options)
  try {
    return await action(context)
  } finally {
    await context.cleanup()
  }
}
