import { spawn } from "node:child_process"
import { access, writeFile } from "node:fs/promises"
import path from "node:path"

import { parseJsonFromOutput } from "../json.ts"
import { toKebabCase } from "../utils/string.ts"
import type { TestAccount, TestContext } from "./localnet.ts"
import {
  resolveDappConfigPath,
  resolveDappRoot,
  resolveTsNodeEsmPath
} from "./paths.ts"

export type ScriptRunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type ScriptArgumentValue =
  | string
  | number
  | bigint
  | boolean
  | (string | number | bigint)[]
  | undefined

export type ScriptArgumentMap = Record<string, ScriptArgumentValue>

export type ScriptRunOptions = {
  args?: string[] | ScriptArgumentMap
  account?: TestAccount
  allowFailure?: boolean
  env?: Record<string, string | undefined>
  cwd?: string
  configPath?: string
  timeoutMs?: number
}

export type SuiScriptRunner = {
  runScript: (
    scriptPath: string,
    options?: ScriptRunOptions
  ) => Promise<ScriptRunResult>
  runBuyerScript: (
    scriptName: string,
    options?: ScriptRunOptions
  ) => Promise<ScriptRunResult>
  runOwnerScript: (
    scriptName: string,
    options?: ScriptRunOptions
  ) => Promise<ScriptRunResult>
}

const normalizeScriptName = (scriptName: string) =>
  scriptName.endsWith(".ts") ? scriptName : `${scriptName}.ts`

const resolveScriptPath = (segments: string[]) =>
  path.join(resolveDappRoot(), "src", "scripts", ...segments)

export const resolveBuyerScriptPath = (scriptName: string) =>
  resolveScriptPath(["buyer", normalizeScriptName(scriptName)])

export const resolveOwnerScriptPath = (scriptName: string) =>
  resolveScriptPath(["owner", normalizeScriptName(scriptName)])

const buildArgumentEntries = (key: string, value: ScriptArgumentValue) => {
  if (value === undefined) return []

  const normalizedKey = toKebabCase(key, { replaceUnderscores: true })
  const flag = `--${normalizedKey}`

  if (value === true) return [flag]
  if (value === false) return [`--no-${normalizedKey}`]

  if (Array.isArray(value)) {
    return value.flatMap((entry) => [flag, String(entry)])
  }

  return [flag, String(value)]
}

export const buildScriptArguments = (args: ScriptArgumentMap = {}) =>
  Object.entries(args).flatMap(([key, value]) =>
    buildArgumentEntries(key, value)
  )

export const parseJsonFromScriptOutput = <T = unknown>(
  stdout: string,
  label = "script output"
): T => {
  const trimmed = stdout.trim()
  if (!trimmed)
    throw new Error(`Expected ${label} to contain JSON output, but got none.`)

  const parsed = parseJsonFromOutput<T>(trimmed)
  if (parsed !== undefined) return parsed

  throw new Error(`Unable to parse JSON from ${label}.`)
}

const normalizeScriptArguments = (args?: string[] | ScriptArgumentMap) => {
  if (!args) return []
  return Array.isArray(args) ? args : buildScriptArguments(args)
}

const resolveBaseEnvironment = ({
  context,
  account,
  configPath,
  env
}: {
  context: TestContext
  account?: TestAccount
  configPath?: string
  env?: Record<string, string | undefined>
}) => {
  const baseEnvironment: Record<string, string | undefined> = {
    ...process.env,
    SUI_CONFIG_PATH: configPath ?? resolveDappConfigPath(),
    SUI_NETWORK: "localnet",
    SUI_RPC_URL: context.localnet.rpcUrl,
    SUI_ARTIFACTS_DIR: context.artifactsDir,
    SUI_CONFIG_DIR: context.localnet.configDir,
    SUI_LOCALNET_CONFIG_DIR: context.localnet.configDir,
    SUI_SKIP_MOVE_CHAIN_ID_SYNC: "1",
    TS_NODE_SKIP_IGNORE: "1",
    NODE_OPTIONS: "--no-warnings"
  }

  if (account) {
    baseEnvironment.SUI_ACCOUNT_PRIVATE_KEY = account.keypair.getSecretKey()
    baseEnvironment.SUI_ACCOUNT_ADDRESS = account.address
  }

  return {
    ...baseEnvironment,
    ...env
  }
}

const resolveWorkingDirectory = (candidate?: string) =>
  candidate ?? resolveDappRoot()

const ensureTestSuiConfigPath = async (context: TestContext) => {
  const configPath = path.join(context.tempDir, "sui.config.ts")

  try {
    await access(configPath)
    return configPath
  } catch {
    // Fall through to create the config.
  }

  const gasBudget = context.suiConfig.network.gasBudget
  if (!gasBudget)
    throw new Error(
      "Test context is missing a configured network gas budget; unable to generate sui.config.ts for script runner."
    )

  const content = `export default {
  defaultNetwork: "localnet",
  networks: {
    localnet: {
      url: ${JSON.stringify(context.localnet.rpcUrl)},
      gasBudget: ${gasBudget},
      account: {}
    }
  },
  paths: {
    move: ${JSON.stringify(context.moveRootPath)},
    deployments: ${JSON.stringify(context.artifactsDir)},
    objects: ${JSON.stringify(context.artifactsDir)},
    artifacts: ${JSON.stringify(context.artifactsDir)}
  }
}
`

  await writeFile(configPath, content)
  return configPath
}

const collectOutput = (stream?: NodeJS.ReadableStream) =>
  new Promise<string>((resolve) => {
    if (!stream) return resolve("")

    let buffer = ""
    stream.setEncoding("utf8")
    stream.on("data", (chunk) => {
      buffer += chunk
    })
    stream.on("end", () => resolve(buffer))
    stream.on("close", () => resolve(buffer))
  })

const runCommand = async ({
  command,
  args,
  cwd,
  env,
  timeoutMs,
  allowFailure
}: {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
  allowFailure?: boolean
}): Promise<ScriptRunResult> => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  })

  const stdoutPromise = collectOutput(child.stdout)
  const stderrPromise = collectOutput(child.stderr)

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout =
      timeoutMs && Number.isFinite(timeoutMs)
        ? setTimeout(() => {
            child.kill("SIGTERM")
          }, timeoutMs)
        : undefined

    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout)
      reject(error)
    })

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout)
      resolve(code ?? 1)
    })
  })

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  const result = { exitCode, stdout, stderr }

  if (exitCode !== 0 && !allowFailure) {
    const outputSummary = [stdout.trim(), stderr.trim()]
      .filter(Boolean)
      .join("\n")
    const message = outputSummary
      ? `Script failed with exit code ${exitCode}:\n${outputSummary}`
      : `Script failed with exit code ${exitCode}.`
    throw new Error(message)
  }

  return result
}

export const createSuiScriptRunner = (
  context: TestContext
): SuiScriptRunner => {
  const defaultConfigPathPromise = ensureTestSuiConfigPath(context)

  const runScript = async (scriptPath: string, options?: ScriptRunOptions) => {
    const resolvedConfigPath =
      options?.configPath ?? (await defaultConfigPathPromise)
    const scriptArguments = normalizeScriptArguments(options?.args)
    const command = resolveTsNodeEsmPath()
    const args = ["--transpile-only", scriptPath, ...scriptArguments]
    const env = resolveBaseEnvironment({
      context,
      account: options?.account,
      configPath: resolvedConfigPath,
      env: options?.env
    }) as NodeJS.ProcessEnv
    const cwd = resolveWorkingDirectory(options?.cwd)

    return runCommand({
      command,
      args,
      cwd,
      env,
      timeoutMs: options?.timeoutMs,
      allowFailure: options?.allowFailure
    })
  }

  const runBuyerScript = async (
    scriptName: string,
    options?: ScriptRunOptions
  ) => runScript(resolveBuyerScriptPath(scriptName), options)

  const runOwnerScript = async (
    scriptName: string,
    options?: ScriptRunOptions
  ) => runScript(resolveOwnerScriptPath(scriptName), options)

  return {
    runScript,
    runBuyerScript,
    runOwnerScript
  }
}
