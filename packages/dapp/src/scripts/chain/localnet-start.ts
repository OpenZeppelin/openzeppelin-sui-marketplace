/**
 * Starts or checks a Sui localnet, optionally with faucet and regenesis.
 * Localnet persists state in a config dir; regenesis wipes state and changes object IDs.
 * Logs RPC readiness and funds the default account if needed.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import fkill from "fkill"
import yargs from "yargs"

import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  deriveFaucetUrl,
  isFaucetSupportedNetwork,
  probeRpcHealth,
  resolveLocalnetConfigDir,
  type RpcSnapshot
} from "@sui-oracle-market/tooling-node/localnet"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow,
  logSimpleGreen,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { runSuiCli } from "@sui-oracle-market/tooling-node/suiCli"

process.env.SUI_NETWORK = "localnet"

const LEGACY_SUI_CLI_VERSION_FILE = "sui-cli-version.txt"
const SUI_CLI_VERSION_FILE_PREFIX = "sui-cli-version-"
const SUI_CLI_VERSION_FILE_SUFFIX = ".txt"
const FAUCET_READINESS_WAIT_SECONDS = 10
const runSuiCliVersion = runSuiCli([])

runSuiScript<{
  checkOnly: boolean
  waitSeconds: number
  withFaucet: boolean
  forceRegenesis: boolean
  configDir: string
}>(
  async (
    tooling,
    { withFaucet, checkOnly, waitSeconds, forceRegenesis, configDir }
  ) => {
    if (tooling.network.networkName !== "localnet") {
      throw new Error(
        `chain:localnet:start is localnet-only. Remove --network or use --network localnet (received ${tooling.network.networkName}).`
      )
    }

    const localnetConfigDir = resolveLocalnetConfigDir(configDir)
    const configDirManagedByScript = isConfigDirManagedByScript()
    const probeResult = await probeRpcHealth(tooling.network.url)
    const suiCliVersion = await getSuiCliVersion()

    if (checkOnly) {
      if (probeResult.status === "running") {
        logSimpleGreen("Localnet running")
        logRpcSnapshot(probeResult.snapshot, withFaucet)
        return
      }

      throw new Error(
        `Localnet RPC unavailable at ${tooling.network.url}: ${probeResult.error}`
      )
    }

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

    let shouldRegenesis = forceRegenesis
    if (!forceRegenesis) {
      const versionCheck = await detectSuiCliVersionMismatch({
        configDir: localnetConfigDir,
        currentVersion: suiCliVersion
      })

      if (versionCheck.mismatch) {
        if (configDirManagedByScript) {
          const newMarkerFile = suiCliVersion
            ? buildSuiCliVersionFileName(suiCliVersion)
            : undefined
          logWarning(
            [
              "Sui CLI version changed for the default localnet config.",
              `Markers: ${formatSuiCliMarkers(versionCheck.markers)}`,
              newMarkerFile
                ? `New marker: ${newMarkerFile}.`
                : "New marker: unavailable.",
              `Creating fresh localnet state at ${localnetConfigDir}.`
            ].join(" ")
          )
          shouldRegenesis = true
        } else {
          throw new Error(
            `Localnet config at ${localnetConfigDir} was created with a different Sui CLI version (${formatSuiCliMarkers(
              versionCheck.markers
            )}). Regenesis with --force-regenesis or use --config-dir to create a fresh localnet.`
          )
        }
      }
    }

    if (shouldRegenesis) {
      await deleteLocalnetDeployments(tooling.suiConfig.paths.deployments)
      await resetLocalnetConfig({ configDir: localnetConfigDir, withFaucet })
    } else {
      await ensureLocalnetConfig({ configDir: localnetConfigDir, withFaucet })
    }

    await recordSuiCliVersion(localnetConfigDir, suiCliVersion)

    const localnetProcess = startLocalnetProcess({
      withFaucet,
      configDir: localnetConfigDir,
      rpcUrl: tooling.network.url
    })

    const readySnapshot = await waitForRpcReadiness({
      rpcUrl: tooling.network.url,
      waitSeconds: waitSeconds
    })

    logRpcSnapshot(readySnapshot, withFaucet)

    await maybeFundAfterRegenesis({
      forceRegenesis: shouldRegenesis,
      withFaucet,
      tooling
    })

    await logProcessExit(localnetProcess)
  },
  yargs()
    .option("checkOnly", {
      alias: "check-only",
      type: "boolean",
      description: "Only validate the RPC without starting a new localnet",
      default: false
    })
    .option("waitSeconds", {
      alias: "wait-seconds",
      type: "number",
      description: "How long to wait for RPC readiness after starting",
      default: 25
    })
    .option("withFaucet", {
      alias: "with-faucet",
      type: "boolean",
      description: "Start the faucet alongside the local node",
      default: true
    })
    .option("forceRegenesis", {
      alias: "force-regenesis",
      type: "boolean",
      description:
        "Force localnet regenesis (clears localnet deployments and rebuilds the localnet config dir)",
      default: false
    })
    .option("configDir", {
      alias: ["config-dir", "network-config"],
      type: "string",
      description:
        "Localnet config directory for sui start --network.config (persists state across restarts)",
      default: resolveLocalnetConfigDir()
    })
    .strict()
)

const waitForRpcReadiness = async ({
  rpcUrl,
  waitSeconds
}: {
  rpcUrl: string
  waitSeconds: number
}): Promise<RpcSnapshot> => {
  const deadline = Date.now() + waitSeconds * 1000

  while (Date.now() <= deadline) {
    const probe = await probeRpcHealth(rpcUrl)

    if (probe.status === "running") {
      logKeyValueGreen("Localnet")("Ready")
      return probe.snapshot
    }

    logKeyValueYellow("Waiting")(
      `for RPC at ${rpcUrl} (timeout ${waitSeconds}s)`
    )

    await delay(1_000)
  }

  throw new Error(
    `Localnet RPC did not become reachable within ${waitSeconds}s at ${rpcUrl}`
  )
}

const startLocalnetProcess = ({
  withFaucet,
  configDir,
  rpcUrl
}: {
  withFaucet: boolean
  configDir: string
  rpcUrl: string
}): ChildProcess => {
  const args = buildStartArguments(withFaucet, configDir)
  const processHandle = spawn("sui", args, {
    stdio: ["inherit", "pipe", "pipe"]
  })

  registerLocalnetProcessCleanup(processHandle, { rpcUrl, withFaucet })
  streamLocalnetLogs(processHandle)

  processHandle.once("error", (error) => {
    logWarning(
      `Failed to start localnet via "sui ${args.join(" ")}": ${error.message}`
    )
  })

  logKeyValueYellow("Starting")(`sui ${args.join(" ")}`)

  return processHandle
}

const parsePortFromUrl = (rpcUrl: string | undefined) => {
  if (!rpcUrl) return undefined
  try {
    const parsed = new URL(rpcUrl)
    if (!parsed.port) return undefined
    const port = Number(parsed.port)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined
    return port
  } catch {
    return undefined
  }
}

const parseHostPortFromUrl = (
  rawUrl: string
): { host: string; port: number } | undefined => {
  try {
    const parsed = new URL(rawUrl)
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined
    return { host: parsed.hostname, port }
  } catch {
    return undefined
  }
}

const canConnectToHost = async ({
  host,
  port
}: {
  host: string
  port: number
}) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port })
    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.once("connect", () => {
      cleanup()
      resolve(true)
    })
    socket.once("error", () => {
      cleanup()
      resolve(false)
    })
  })

const waitForFaucetReadiness = async ({
  faucetUrl,
  waitSeconds
}: {
  faucetUrl: string
  waitSeconds: number
}) => {
  const target = parseHostPortFromUrl(faucetUrl)
  if (!target) return false

  const deadline = Date.now() + waitSeconds * 1000
  while (Date.now() <= deadline) {
    if (await canConnectToHost(target)) return true
    await delay(250)
  }

  return false
}

const buildPortTargets = (rpcUrl: string, withFaucet: boolean) => {
  const rpcPort = parsePortFromUrl(rpcUrl)
  const faucetPort = withFaucet
    ? parsePortFromUrl(deriveFaucetUrl(rpcUrl))
    : undefined

  return [rpcPort, faucetPort]
    .filter((port): port is number => typeof port === "number")
    .map((port) => `:${port}`)
}

const isFkillMissingProcessError = (error: unknown) => {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("process doesn't exist") ||
    message.includes("no matching process") ||
    message.includes("no process found") ||
    message.includes("not found")
  )
}

const killTargets = async (targets: string[]) => {
  for (const target of targets) {
    try {
      await fkill(target, { force: true, silent: true, tree: true })
    } catch (error) {
      if (isFkillMissingProcessError(error)) continue
      // Cleanup is best-effort; avoid noisy logs on shutdown.
    }
  }
}

const registerLocalnetProcessCleanup = (
  processHandle: ChildProcess,
  { rpcUrl, withFaucet }: { rpcUrl: string; withFaucet: boolean }
) => {
  let didCleanup = false
  const portTargets = buildPortTargets(rpcUrl, withFaucet)

  const cleanupSync = () => {
    if (didCleanup) return
    didCleanup = true
    if (processHandle.exitCode !== null) return
    try {
      processHandle.kill("SIGTERM")
    } catch {
      // Ignore cleanup failures; the process may have already exited.
    }
  }

  const cleanupAsync = async () => {
    if (didCleanup) return
    cleanupSync()
    if (!portTargets.length) return
    await killTargets(portTargets)
    await killTargets(["sui-node", "sui-faucet"])
  }

  const registerSignal = (signal: NodeJS.Signals, exitCode: number) => {
    process.once(signal, () => {
      void cleanupAsync().finally(() => process.exit(exitCode))
    })
  }

  process.once("exit", cleanupSync)
  registerSignal("SIGINT", 130)
  registerSignal("SIGTERM", 143)

  if (process.platform !== "win32") {
    registerSignal("SIGHUP", 129)
    registerSignal("SIGQUIT", 131)
  } else {
    registerSignal("SIGBREAK", 21)
  }

  processHandle.once("exit", () => {
    void cleanupAsync()
  })
}

const buildStartArguments = (withFaucet: boolean, configDir: string) => {
  const args = ["start", "--network.config", configDir]
  if (withFaucet) args.push("--with-faucet")
  return args
}

const streamLocalnetLogs = (processHandle: ChildProcess) => {
  processHandle.stdout?.setEncoding("utf-8")
  processHandle.stdout?.on("data", (chunk) => process.stdout.write(chunk))

  processHandle.stderr?.setEncoding("utf-8")
  processHandle.stderr?.on("data", (chunk) => process.stderr.write(chunk))
}

const logRpcSnapshot = (snapshot: RpcSnapshot, withFaucet: boolean) => {
  logKeyValueBlue("RPC")(snapshot.rpcUrl)
  logKeyValueBlue("Epoch")(snapshot.epoch)
  logKeyValueBlue("Checkpoint")(snapshot.latestCheckpoint)
  logKeyValueBlue("Protocol")(snapshot.protocolVersion)
  logKeyValueBlue("Validators")(snapshot.validatorCount)
  logKeyValueBlue("Gas price")(formatGasPrice(snapshot.referenceGasPrice))
  if (withFaucet) logKeyValueBlue("Faucet")(deriveFaucetUrl(snapshot.rpcUrl))
  if (snapshot.epochStartTimestampMs)
    logKeyValueBlue("Epoch start")(
      formatTimestamp(Number(snapshot.epochStartTimestampMs))
    )
}

const logProcessExit = async (processHandle: ChildProcess) => {
  const [code, signal] = (await once(processHandle, "exit")) as [
    number | null,
    NodeJS.Signals | null
  ]
  const description =
    code !== null
      ? `exited with code ${code}`
      : `terminated via signal ${signal}`
  logKeyValueYellow("Localnet")(description)
}

const maybeFundAfterRegenesis = async ({
  forceRegenesis,
  withFaucet,
  tooling
}: {
  forceRegenesis: boolean
  withFaucet: boolean
  tooling: Tooling
}) => {
  if (!forceRegenesis) return
  if (!withFaucet) {
    logKeyValueYellow("Faucet")(
      "Skipping auto-funding; faucet not started (--with-faucet=false)"
    )
    return
  }

  const faucetUrl = deriveFaucetUrl(tooling.network.url)
  const faucetReady = await waitForFaucetReadiness({
    faucetUrl,
    waitSeconds: FAUCET_READINESS_WAIT_SECONDS
  })
  if (!faucetReady) {
    logWarning(
      `Skipping faucet funding; faucet not reachable at ${faucetUrl} yet.`
    )
    return
  }

  await fundConfiguredAddressIfPossible(tooling)
}

const deriveFundingTarget = async (
  tooling: Tooling
): Promise<
  | {
      signerAddress: string
      signer?: Ed25519Keypair
    }
  | undefined
> => {
  try {
    return {
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      signer: tooling.loadedEd25519KeyPair
    }
  } catch (error) {
    if (tooling.network.account.accountAddress)
      return { signerAddress: tooling.network.account.accountAddress }

    logWarning(
      `Skipping faucet funding; unable to derive signer address: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return
  }
}

const fundConfiguredAddressIfPossible = async (tooling: Tooling) => {
  if (!isFaucetSupportedNetwork(tooling.network.networkName)) {
    logWarning(
      `Skipping faucet funding; faucet unsupported for ${tooling.network.networkName}`
    )
    return
  }

  const fundingTarget = await deriveFundingTarget(tooling)
  if (!fundingTarget) return

  try {
    await tooling.ensureFoundedAddress({
      signerAddress: fundingTarget.signerAddress,
      signer: fundingTarget.signer
    })

    logKeyValueGreen("Faucet")(
      `Funded ${fundingTarget.signerAddress} after regenesis`
    )
  } catch (error) {
    logWarning(
      `Faucet funding failed for ${fundingTarget.signerAddress}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

const formatGasPrice = (referenceGasPrice: bigint) => {
  const mist = referenceGasPrice.toString()
  return `${mist} MIST (${formatSui(referenceGasPrice)} SUI)`
}

const formatSui = (mist: bigint) => {
  const whole = mist / 1_000_000_000n
  const fractional = mist % 1_000_000_000n
  const fractionalStr = fractional
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "")
  return fractionalStr ? `${whole}.${fractionalStr}` : whole.toString()
}

const formatTimestamp = (timestampMs: number) =>
  new Date(timestampMs).toISOString()

const pathExists = async (targetPath: string) => {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

const ensureLocalnetConfig = async ({
  configDir,
  withFaucet
}: {
  configDir: string
  withFaucet: boolean
}) => {
  if (await pathExists(configDir)) {
    const existing = await stat(configDir)
    if (!existing.isDirectory()) {
      throw new Error(
        `Localnet config path exists but is not a directory: ${configDir}`
      )
    }

    return
  }

  logKeyValueYellow("Localnet config")(
    `Missing; creating via sui genesis at ${configDir}`
  )

  await mkdir(configDir, { recursive: true })

  const args = ["--working-dir", configDir]
  if (withFaucet) args.push("--with-faucet")

  const { exitCode, stderr, stdout } = await runSuiCli(["genesis"])(args)
  if (exitCode === 0) return

  const details = String(stderr || stdout || "unknown error").trim()
  throw new Error(`sui genesis failed for ${configDir}: ${details}`)
}

const resetLocalnetConfig = async ({
  configDir,
  withFaucet
}: {
  configDir: string
  withFaucet: boolean
}) => {
  await removeLocalnetConfigDir(configDir)
  await ensureLocalnetConfig({ configDir, withFaucet })
}

const removeLocalnetConfigDir = async (configDir: string) => {
  if (!(await pathExists(configDir))) return

  const root = path.parse(configDir).root
  if (configDir === root) {
    throw new Error(
      `Refusing to delete localnet config at root path: ${configDir}`
    )
  }

  await rm(configDir, { recursive: true, force: true })
  logKeyValueYellow("Localnet config")(`Removed ${configDir}`)
}

const deleteLocalnetDeployments = async (deploymentsPath: string) => {
  try {
    const entries = await readdir(deploymentsPath, { withFileTypes: true })
    const localnetFiles = entries.filter(
      (entry) => entry.isFile() && /\.localnet(\.|$)/.test(entry.name)
    )

    if (!localnetFiles.length) return

    await Promise.all(
      localnetFiles.map((entry) =>
        unlink(path.join(deploymentsPath, entry.name))
      )
    )

    logKeyValueYellow("Deployments")(
      `Removed localnet artifacts: ${localnetFiles
        .map((entry) => entry.name)
        .join(", ")}`
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return

    throw new Error(
      `Failed to delete localnet deployment files in ${deploymentsPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

const getSuiCliVersion = async (): Promise<string | undefined> => {
  try {
    const { stdout, exitCode } = await runSuiCliVersion(["--version"])
    if (exitCode && exitCode !== 0) return undefined
    return parseSuiCliVersionOutput(stdout.toString())
  } catch {
    return undefined
  }
}

const parseSuiCliVersionOutput = (stdout: string): string | undefined => {
  if (!stdout?.trim()) return undefined
  const firstLine = stdout.trim().split(/\r?\n/)[0] ?? ""
  const versionMatch = firstLine.match(/sui\s+([^\s]+)/i)
  return (versionMatch?.[1] ?? firstLine) || undefined
}

type RecordedSuiCliMarker = {
  normalizedVersion: string
  fileName: string
}

const readRecordedSuiCliMarkers = async (
  configDir: string
): Promise<RecordedSuiCliMarker[]> => {
  try {
    const entries = await readdir(configDir, { withFileTypes: true })
    const markers: RecordedSuiCliMarker[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue

      if (
        entry.name.startsWith(SUI_CLI_VERSION_FILE_PREFIX) &&
        entry.name.endsWith(SUI_CLI_VERSION_FILE_SUFFIX)
      ) {
        const version = entry.name.slice(
          SUI_CLI_VERSION_FILE_PREFIX.length,
          -SUI_CLI_VERSION_FILE_SUFFIX.length
        )
        if (version) {
          markers.push({
            normalizedVersion: version,
            fileName: entry.name
          })
        }
        continue
      }

      if (entry.name === LEGACY_SUI_CLI_VERSION_FILE) {
        const contents = await readFile(
          path.join(configDir, entry.name),
          "utf8"
        )
        const trimmed = contents.trim()
        if (trimmed.length) {
          markers.push({
            normalizedVersion: normalizeSuiCliVersion(trimmed),
            fileName: entry.name
          })
        }
      }
    }

    return markers
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

const recordSuiCliVersion = async (
  configDir: string,
  currentVersion?: string
) => {
  if (!currentVersion) return

  const markerFileName = buildSuiCliVersionFileName(currentVersion)
  if (!markerFileName) return

  const markerPath = path.join(configDir, markerFileName)
  if (await pathExists(markerPath)) return

  await writeFile(markerPath, `${currentVersion}\n`, "utf8")
}

const detectSuiCliVersionMismatch = async ({
  configDir,
  currentVersion
}: {
  configDir: string
  currentVersion?: string
}): Promise<{ mismatch: boolean; markers: RecordedSuiCliMarker[] }> => {
  if (!currentVersion) return { mismatch: false, markers: [] }

  const markers = (await readRecordedSuiCliMarkers(configDir)) ?? []
  if (!markers.length) return { mismatch: false, markers }

  const normalizedCurrent = normalizeSuiCliVersion(currentVersion)
  const hasMatch = markers.some(
    (marker) => marker.normalizedVersion === normalizedCurrent
  )
  return { mismatch: !hasMatch, markers }
}

const normalizeSuiCliVersion = (version: string) =>
  version.replace(/[^a-zA-Z0-9._-]/g, "_")

const buildSuiCliVersionFileName = (version: string) => {
  const normalized = normalizeSuiCliVersion(version)
  return normalized.length
    ? `${SUI_CLI_VERSION_FILE_PREFIX}${normalized}${SUI_CLI_VERSION_FILE_SUFFIX}`
    : undefined
}

const formatSuiCliMarkers = (markers: RecordedSuiCliMarker[]) => {
  if (!markers.length) return "none"
  return markers.map((marker) => marker.fileName).join(", ")
}

const isConfigDirManagedByScript = () => {
  const args = process.argv.slice(2)
  const flags = [
    "--config-dir",
    "--network-config",
    "--configDir",
    "--networkConfig"
  ]
  const hasFlag = flags.some((flag) =>
    args.some((arg) => arg === flag || arg.startsWith(`${flag}=`))
  )
  const hasEnv =
    Boolean(process.env.SUI_LOCALNET_CONFIG_DIR) ||
    Boolean(process.env.SUI_CONFIG_DIR)

  return !hasFlag && !hasEnv
}
