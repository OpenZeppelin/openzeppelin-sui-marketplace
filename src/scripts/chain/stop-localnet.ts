import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"

import {
  logKeyValueGreen,
  logKeyValueYellow,
  logWarning
} from "../utils/log.ts"

const execFile = promisify(execFileCallback)

type ProcessInfo = {
  pid: number
  tty: string
  args: string
}

/**
 * Parses a single line from `ps` into a structured `ProcessInfo`, or null if
 * the line does not conform to the expected format.
 */
const parseProcessLine = (line: string): ProcessInfo | null => {
  const trimmedLine = line.trim()
  if (!trimmedLine) return null

  const match = trimmedLine.match(/^(\d+)\s+(\S+)\s+(.*)$/)
  if (!match) return null

  const [, pidLiteral, ttyLiteral, argumentsLiteral] = match
  const pid = Number(pidLiteral)

  if (Number.isNaN(pid)) return null

  return {
    pid,
    tty: ttyLiteral,
    args: argumentsLiteral
  }
}

const isBackgroundProcess = (ttyValue: string) =>
  ttyValue === "?" || ttyValue === "??" || ttyValue === "-" || ttyValue === ""

const matchesSuiStartCommand = (argumentsLiteral: string) =>
  /(?:^|\s)sui\s+start(?:\s|$)/.test(argumentsLiteral)

/**
 * Reads the current process table via `ps` and returns structured entries.
 */
const buildProcessList = async (): Promise<ProcessInfo[]> => {
  const { stdout: processListOutput } = await execFile("ps", [
    "-axo",
    "pid,tty,args"
  ])
  const rawProcessLines = processListOutput.split("\n").slice(1)

  return rawProcessLines
    .map(parseProcessLine)
    .filter((parsed): parsed is ProcessInfo => Boolean(parsed))
}

/**
 * Filters the supplied process list for detached `sui start` entries.
 */
const selectBackgroundSuiStartProcesses = (
  processList: ProcessInfo[]
): ProcessInfo[] =>
  processList.filter(
    (processInfo) =>
      isBackgroundProcess(processInfo.tty) &&
      matchesSuiStartCommand(processInfo.args)
  )

/**
 * Attempts to terminate every background `sui start` process detected in the
 * running process table.
 */
const terminateBackgroundLocalnetProcesses = async () => {
  const processList = await buildProcessList()
  const backgroundSuiProcesses = selectBackgroundSuiStartProcesses(processList)

  if (!backgroundSuiProcesses.length) {
    logKeyValueYellow("Stop")("No background `sui start` process found")
    return
  }

  await Promise.all(
    backgroundSuiProcesses.map(async (processInfo) => {
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
}

/**
 * Entrypoint for the stop-localnet script.
 */
const main = async () => {
  try {
    await terminateBackgroundLocalnetProcesses()
  } catch (error) {
    logWarning(
      `Unable to stop background localnet: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    process.exitCode = 1
  }
}

main()
