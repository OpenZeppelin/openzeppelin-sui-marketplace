/**
 * Runs Move unit tests for a specific package using network-aware defaults.
 * The script resolves package paths against the repo move root and delegates to the Sui CLI.
 */
import path from "node:path"
import yargs from "yargs"

import {
  logKeyValueBlue,
  logSimpleBlue,
  logSimpleGreen,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  buildMoveTestArguments,
  type MoveTestFlagOptions,
  resolveFullPackagePath,
  runMoveTest,
  syncLocalnetMoveEnvironmentChainId
} from "@sui-oracle-market/tooling-node/move"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type MoveTestScriptArguments = {
  packagePath: string
}

type ResolvedMoveTestOptions = MoveTestFlagOptions

const deriveMoveTestOptions = (
  networkName: string
): ResolvedMoveTestOptions => ({
  environmentName: networkName
})

const logMoveTestPlan = (
  packagePath: string,
  options: ResolvedMoveTestOptions
) => {
  logSimpleBlue("Running Move tests")
  logKeyValueBlue("package")(packagePath)
  logKeyValueBlue("environment")(options.environmentName ?? "default")
  console.log("")
}

type MoveTestTooling = Pick<Tooling, "suiClient" | "suiConfig">

const syncMoveEnvironmentForTests = async (tooling: MoveTestTooling) => {
  const { network, paths } = tooling.suiConfig
  const { chainId, updatedFiles, didAttempt } =
    await syncLocalnetMoveEnvironmentChainId({
      moveRootPath: path.resolve(paths.move),
      environmentName: network.networkName,
      suiClient: tooling.suiClient
    })

  if (didAttempt && !chainId) {
    logWarning(
      "Unable to resolve localnet chain id; Move.toml environments were not updated."
    )
  }

  if (updatedFiles.length) {
    logKeyValueBlue("Move.toml")(
      `updated ${updatedFiles.length} localnet environment entries`
    )
  }
}

const runMoveTestsForPackage = async (
  packagePath: string,
  options: ResolvedMoveTestOptions
) => {
  const cliArguments = buildMoveTestArguments({
    packagePath,
    ...options
  })
  const { stdout, stderr, exitCode } = await runMoveTest(cliArguments)

  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)

  if (exitCode && exitCode !== 0) {
    throw new Error(`sui move test exited with code ${exitCode}.`)
  }
}

runSuiScript(
  async (tooling, cliArguments: MoveTestScriptArguments) => {
    const { network, paths } = tooling.suiConfig
    await syncMoveEnvironmentForTests(tooling)
    const fullPackagePath = resolveFullPackagePath(
      path.resolve(paths.move),
      cliArguments.packagePath
    )
    const resolvedOptions = deriveMoveTestOptions(network.networkName)

    logMoveTestPlan(fullPackagePath, resolvedOptions)

    await runMoveTestsForPackage(fullPackagePath, resolvedOptions)

    logSimpleGreen("Move tests completed")
  },
  yargs()
    .option("packagePath", {
      alias: "package-path",
      type: "string",
      description: "The path of the package to test in the move directory",
      demandOption: true
    })
    .strict()
)
