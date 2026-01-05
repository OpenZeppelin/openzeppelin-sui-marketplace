/**
 * Stops a locally running `sui start` process by scanning the process table and terminating it.
 * If the parent `sui start` process is gone, it falls back to localnet service processes.
 * Sui localnet is a full validator + RPC stack, similar to running an EVM devnet like Anvil or Hardhat node.
 * If you come from EVM, this is the equivalent of shutting down your local chain, not just one app process.
 * No on-chain transaction is involved; it only manages your local OS process.
 */
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"

import fkill from "fkill"

import {
  deriveFaucetUrl,
  resolveLocalnetConfigDir
} from "@sui-oracle-market/tooling-node/localnet"
import {
  logKeyValueGreen,
  logKeyValueYellow,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { getSuiCliEnvironmentRpc } from "@sui-oracle-market/tooling-node/suiCli"

process.env.SUI_NETWORK = "localnet"

const execFile = promisify(execFileCallback)

type ProcessInfo = {
  pid: number
  tty: string
  args: string
}

/**
 * Parses a single line from `ps` into a structured `ProcessInfo`, or undefined if
 * the line does not conform to the expected format.
 */
const parseProcessLine = (line: string): ProcessInfo | undefined => {
  const trimmedLine = line.trim()
  if (!trimmedLine) return undefined

  const match = trimmedLine.match(/^(\d+)\s+(\S+)\s+(.*)$/)
  if (!match) return undefined

  const [, pidLiteral, ttyLiteral, argumentsLiteral] = match
  const pid = Number(pidLiteral)

  if (Number.isNaN(pid)) return undefined

  return {
    pid,
    tty: ttyLiteral,
    args: argumentsLiteral
  }
}

const matchesSuiStartCommand = (argumentsLiteral: string) =>
  /(?:^|\s)(?:\S*\/)?sui\s+start(?:\s|$)/.test(argumentsLiteral)

const matchesSuiServiceCommand = (argumentsLiteral: string) =>
  /(?:^|\s)(?:\S*\/)?sui-(?:node|faucet)(?:\s|$)/.test(argumentsLiteral)

const matchesLocalnetConfigPath = (
  argumentsLiteral: string,
  configDir: string
) => argumentsLiteral.includes(configDir)

const normalizePort = (value: string | number | undefined) => {
  if (value === undefined) return undefined
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535)
    return undefined
  return parsed
}

const parsePortFromUrl = (rpcUrl: string | undefined) => {
  if (!rpcUrl) return undefined
  try {
    const parsed = new URL(rpcUrl)
    return normalizePort(parsed.port)
  } catch {
    return undefined
  }
}

/**
 * Reads the current process table via `ps` and returns structured entries.
 */
const buildProcessList = async (): Promise<ProcessInfo[]> => {
  try {
    const { stdout: processListOutput } = await execFile("ps", [
      "-axo",
      "pid,tty,args"
    ])
    const rawProcessLines = processListOutput.toString().split("\n").slice(1)

    return rawProcessLines
      .map(parseProcessLine)
      .filter((parsed): parsed is ProcessInfo => Boolean(parsed))
  } catch {
    return []
  }
}

/**
 * Filters the supplied process list for `sui start` entries.
 */
const selectSuiStartProcesses = (processList: ProcessInfo[]): ProcessInfo[] =>
  processList.filter((processInfo) => matchesSuiStartCommand(processInfo.args))

/**
 * Filters the supplied process list for localnet service processes
 * (`sui-node`, `sui-faucet`) that include the localnet config directory.
 */
const selectLocalnetServiceProcesses = (
  processList: ProcessInfo[],
  configDir: string
): ProcessInfo[] =>
  processList.filter(
    (processInfo) =>
      matchesSuiServiceCommand(processInfo.args) &&
      matchesLocalnetConfigPath(processInfo.args, configDir)
  )

const buildPortTargets = (ports: Array<number | undefined>) =>
  ports
    .filter((port): port is number => typeof port === "number")
    .map((port) => `:${port}`)

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

const killWithFkill = async (targets: string[]) => {
  if (!targets.length) return false
  let didKill = false

  for (const target of targets) {
    try {
      await fkill(target, { force: true, silent: true })
      didKill = true
    } catch (error) {
      if (isFkillMissingProcessError(error)) continue
      logWarning(
        `Failed to stop ${target}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return didKill
}

const resolveLocalnetRpcUrl = async (fallbackUrl?: string) => {
  const cliUrl = await getSuiCliEnvironmentRpc("localnet")
  return cliUrl ?? fallbackUrl
}

/**
 * Attempts to terminate localnet processes detected in the running process table.
 */
const terminateLocalnetProcesses = async (rpcUrl?: string) => {
  const processList = await buildProcessList()
  const localnetConfigDir = resolveLocalnetConfigDir()
  const suiProcesses = selectSuiStartProcesses(processList)
  const fallbackProcesses = selectLocalnetServiceProcesses(
    processList,
    localnetConfigDir
  )

  if (suiProcesses.length || fallbackProcesses.length) {
    const processesToStop =
      suiProcesses.length > 0 ? suiProcesses : fallbackProcesses
    await Promise.all(
      processesToStop.map(async (processInfo) => {
        try {
          process.kill(processInfo.pid, "SIGTERM")
          logKeyValueGreen("Stop")(
            `Killed pid ${processInfo.pid} ${processInfo.args.trim()}`
          )
        } catch (error) {
          logWarning(
            `Failed to stop pid ${processInfo.pid}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      })
    )
    return
  }

  const resolvedRpcUrl = await resolveLocalnetRpcUrl(rpcUrl)
  const rpcPort = parsePortFromUrl(resolvedRpcUrl)
  const faucetPort = parsePortFromUrl(
    resolvedRpcUrl ? deriveFaucetUrl(resolvedRpcUrl) : undefined
  )
  const portTargets = buildPortTargets([rpcPort, faucetPort])
  if (await killWithFkill(portTargets)) {
    logKeyValueGreen("Stop")(
      `Killed processes bound to ${portTargets.join(", ")}`
    )
    return
  }

  if (await killWithFkill(["sui-node", "sui-faucet"])) {
    logKeyValueGreen("Stop")("Killed sui-node/sui-faucet by name")
    return
  }

  logKeyValueYellow("Stop")("No localnet process found")
}

runSuiScript(async (tooling) => {
  await terminateLocalnetProcesses(tooling.network.url)
})
