/**
 * Runs Move unit tests for a package using the Sui CLI.
 * Resolves package paths relative to the repo Move root.
 */
import path from "node:path"
import yargs from "yargs"

import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  logKeyValueBlue,
  logSimpleBlue,
  logSimpleGreen,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import {
  buildMoveTestArguments,
  resolveFullPackagePath,
  runMoveTest,
  syncLocalnetMoveEnvironmentChainId,
  type MoveTestFlagOptions
} from "@sui-oracle-market/tooling-node/move"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

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

const syncMoveEnvironmentForTests = async (
  tooling: Pick<Tooling, "suiClient" | "suiConfig">
) => {
  const { chainId, updatedFiles, didAttempt } =
    await syncLocalnetMoveEnvironmentChainId({
      moveRootPath: path.resolve(tooling.suiConfig.paths.move),
      environmentName: tooling.suiConfig.network.networkName,
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
  async (tooling, cliArguments: { packagePath: string }) => {
    await syncMoveEnvironmentForTests(tooling)
    const fullPackagePath = resolveFullPackagePath(
      path.resolve(tooling.suiConfig.paths.move),
      cliArguments.packagePath
    )
    const resolvedOptions = deriveMoveTestOptions(
      tooling.suiConfig.network.networkName
    )

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
