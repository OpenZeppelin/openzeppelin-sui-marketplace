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
  buildMoveCoverageSummaryArguments,
  buildMoveTestArguments,
  resolveFullPackagePath,
  runMoveCoverageSummary,
  runMoveTest,
  type MoveTestFlagOptions
} from "@sui-oracle-market/tooling-node/move"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type ResolvedMoveTestOptions = MoveTestFlagOptions
type MoveTestExecutionOptions = {
  includeCoverage: boolean
  includeTrace: boolean
  testOnly: boolean
  includeCoverageSummary: boolean
}

const deriveMoveTestOptions = (
  networkName: string,
  suiCliVersion?: string
): ResolvedMoveTestOptions => ({
  environmentName: networkName,
  suiCliVersion
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
  tooling: Pick<Tooling, "syncLocalnetMoveEnvironmentChainId" | "suiConfig">
) => {
  const { chainId, updatedFiles, didAttempt } =
    await tooling.syncLocalnetMoveEnvironmentChainId({
      moveRootPath: path.resolve(tooling.suiConfig.paths.move),
      environmentName: tooling.suiConfig.network.networkName
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

const buildMoveTestExecutionFlags = ({
  includeCoverage,
  includeTrace,
  testOnly
}: Omit<MoveTestExecutionOptions, "includeCoverageSummary">) => [
  ...(includeCoverage ? ["--coverage"] : []),
  ...(includeTrace ? ["--trace"] : []),
  ...(testOnly ? ["--test"] : [])
]

const writeMoveCommandOutput = ({
  stdout,
  stderr
}: {
  stdout?: string | Buffer
  stderr?: string | Buffer
}) => {
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}

const assertMoveCommandSucceeded = ({
  commandName,
  exitCode
}: {
  commandName: string
  exitCode?: number
}) => {
  if (exitCode !== 0) {
    throw new Error(`${commandName} exited with code ${exitCode ?? "unknown"}.`)
  }
}

const assertCoverageSummaryOptions = ({
  coverage,
  coverageSummary
}: {
  coverage: boolean
  coverageSummary: boolean
}) => {
  if (coverageSummary && !coverage) {
    throw new Error("Invalid options: --coverage-summary requires --coverage.")
  }
}

const runMoveTestsForPackage = async (
  packagePath: string,
  options: ResolvedMoveTestOptions,
  executionOptions: MoveTestExecutionOptions
) => {
  const cliArguments = [
    ...buildMoveTestArguments({
      packagePath,
      ...options
    }),
    ...buildMoveTestExecutionFlags(executionOptions)
  ]
  const { stdout, stderr, exitCode } = await runMoveTest(cliArguments)
  writeMoveCommandOutput({ stdout, stderr })
  assertMoveCommandSucceeded({ commandName: "sui move test", exitCode })

  if (!executionOptions.includeCoverageSummary) return

  const coverageSummaryArguments = buildMoveCoverageSummaryArguments({
    packagePath,
    ...options,
    testOnly: executionOptions.testOnly
  })
  const coverageSummaryResult = await runMoveCoverageSummary(
    coverageSummaryArguments
  )
  writeMoveCommandOutput(coverageSummaryResult)
  assertMoveCommandSucceeded({
    commandName: "sui move coverage summary",
    exitCode: coverageSummaryResult.exitCode
  })
}

runSuiScript(
  async (
    tooling,
    cliArguments: {
      packagePath: string
      coverage: boolean
      trace: boolean
      test: boolean
      coverageSummary: boolean
    }
  ) => {
    assertCoverageSummaryOptions(cliArguments)
    await syncMoveEnvironmentForTests(tooling)
    const fullPackagePath = resolveFullPackagePath(
      path.resolve(tooling.suiConfig.paths.move),
      cliArguments.packagePath
    )
    const resolvedOptions = deriveMoveTestOptions(
      tooling.suiConfig.network.networkName,
      tooling.suiConfig.suiCliVersion
    )
    const executionOptions: MoveTestExecutionOptions = {
      includeCoverage: cliArguments.coverage,
      includeTrace: cliArguments.trace,
      testOnly: cliArguments.test,
      includeCoverageSummary: cliArguments.coverageSummary
    }

    logMoveTestPlan(fullPackagePath, resolvedOptions)

    await runMoveTestsForPackage(
      fullPackagePath,
      resolvedOptions,
      executionOptions
    )

    logSimpleGreen("Move tests completed")
  },
  yargs()
    .option("packagePath", {
      alias: "package-path",
      type: "string",
      description: "The path of the package to test in the move directory",
      demandOption: true
    })
    .option("coverage", {
      type: "boolean",
      description: "Run move tests with coverage enabled",
      default: false
    })
    .option("trace", {
      type: "boolean",
      description: "Run move tests with execution tracing",
      default: false
    })
    .option("test", {
      type: "boolean",
      description: "Run test-only coverage mode",
      default: false
    })
    .option("coverageSummary", {
      alias: "coverage-summary",
      type: "boolean",
      description: "Run `sui move coverage summary` after move tests",
      default: false
    })
    .strict()
)
