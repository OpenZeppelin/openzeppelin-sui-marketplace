import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { readdir, unlink } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { SuiClient } from "@mysten/sui/client"
import { getFaucetHost } from "@mysten/sui/faucet"
import yargs from "yargs"

import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow,
  logSimpleGreen,
  logWarning
} from "../utils/log.ts"
import { runSuiScript } from "../utils/process.ts"

type RpcSnapshot = {
  rpcUrl: string
  epoch: string
  protocolVersion: string
  latestCheckpoint: string
  validatorCount: number
  referenceGasPrice: bigint
  epochStartTimestampMs?: string | number | null
}

type ProbeResult =
  | { status: "running"; snapshot: RpcSnapshot }
  | { status: "offline"; error: string }

type StartLocalnetCliArgs = {
  checkOnly: boolean
  waitSeconds: number
  withFaucet: boolean
  forceRegenesis: boolean
}

runSuiScript<StartLocalnetCliArgs>(
  async (
    { network: { url: rpcUrl }, paths },
    { withFaucet, checkOnly, waitSeconds, forceRegenesis }
  ) => {
    const probeResult = await probeRpcHealth(rpcUrl)

    if (checkOnly) {
      if (probeResult.status === "running") {
        logSimpleGreen("Localnet running 🚀")
        logRpcSnapshot(probeResult.snapshot, withFaucet)
        return
      }

      throw new Error(
        `Localnet RPC unavailable at ${rpcUrl}: ${probeResult.error}`
      )
    }

    if (forceRegenesis) await deleteLocalnetDeployments(paths.deployments)

    if (probeResult.status === "running") {
      logSimpleGreen("Localnet running")
      logRpcSnapshot(probeResult.snapshot, withFaucet)
      return
    }

    const localnetProcess = startLocalnetProcess({
      withFaucet: withFaucet,
      forceRegenesis
    })

    const readySnapshot = await waitForRpcReadiness({
      rpcUrl,
      waitSeconds: waitSeconds
    })

    logRpcSnapshot(readySnapshot, withFaucet)

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
        "Force localnet regenesis (clears localnet deployments and passes --force-regenesis to sui start)",
      default: false
    })
    .strict()
)

const probeRpcHealth = async (rpcUrl: string): Promise<ProbeResult> => {
  try {
    return { status: "running", snapshot: await fetchRpcSnapshot(rpcUrl) }
  } catch (error) {
    return {
      status: "offline",
      error:
        error instanceof Error ? error.message : "Unable to reach localnet RPC"
    }
  }
}

const fetchRpcSnapshot = async (rpcUrl: string): Promise<RpcSnapshot> => {
  const client = buildSuiClient(rpcUrl)

  const [systemState, latestCheckpoint, referenceGasPrice] = await Promise.all([
    client.getLatestSuiSystemState(),
    client.getLatestCheckpointSequenceNumber(),
    client.getReferenceGasPrice()
  ])

  return {
    rpcUrl,
    epoch: systemState.epoch,
    protocolVersion: String(systemState.protocolVersion),
    latestCheckpoint,
    validatorCount: systemState.activeValidators?.length ?? 0,
    referenceGasPrice,
    epochStartTimestampMs: systemState.epochStartTimestampMs
  }
}

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
  forceRegenesis
}: {
  withFaucet: boolean
  forceRegenesis: boolean
}): ChildProcess => {
  const args = buildStartArguments(withFaucet, forceRegenesis)
  const processHandle = spawn("sui", args, {
    stdio: "inherit"
  })

  processHandle.once("error", (error) => {
    logWarning(
      `Failed to start localnet via "sui ${args.join(" ")}": ${error.message}`
    )
  })

  logKeyValueYellow("Starting")(`sui ${args.join(" ")}`)

  return processHandle
}

const buildStartArguments = (withFaucet: boolean, forceRegenesis: boolean) => {
  const args = ["start"]
  if (withFaucet) args.push("--with-faucet")
  if (forceRegenesis) args.push("--force-regenesis")
  return args
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

const buildSuiClient = (rpcUrl: string) => new SuiClient({ url: rpcUrl })

const deriveFaucetUrl = (rpcUrl: string) => {
  try {
    const faucetHost = getFaucetHost("localnet")
    const faucetUrl = new URL(faucetHost)
    const rpcHost = new URL(rpcUrl)
    faucetUrl.hostname = rpcHost.hostname
    faucetUrl.pathname = "/v2/gas"
    return faucetUrl.toString()
  } catch {
    return "http://127.0.0.1:9123/v2/gas"
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
