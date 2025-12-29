/**
 * Runs Move unit tests for a specific package using network-aware defaults.
 * The script resolves package paths against the repo move root and delegates to the Sui CLI.
 */
import fs from "node:fs/promises"
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
  buildMoveTestPublishArguments,
  resolveFullPackagePath,
  runClientTestPublish,
  runMoveTest,
  syncLocalnetMoveEnvironmentChainId,
  type MoveTestFlagOptions,
  type MoveTestPublishOptions
} from "@sui-oracle-market/tooling-node/move"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type MoveTestScriptArguments = {
  packagePath: string
}

type ResolvedMoveTestOptions = MoveTestFlagOptions
type LocalnetTestPublishOptions = Required<
  Pick<MoveTestPublishOptions, "buildEnvironmentName" | "publicationFilePath">
> & {
  publicationFileExists: boolean
  hasPublishedAddresses: boolean
  withUnpublishedDependencies: boolean
}

const LOCALNET_ENVIRONMENT_NAME = "localnet"

const deriveMoveTestOptions = (
  networkName: string
): ResolvedMoveTestOptions => ({
  environmentName: networkName
})

const isLocalnetNetwork = (networkName: string) =>
  networkName === LOCALNET_ENVIRONMENT_NAME

const resolvePublicationFilePath = (
  packagePath: string,
  environmentName: string
) => path.join(packagePath, `Pub.${environmentName}.toml`)

const readPublicationFileContents = async (
  filePath: string
): Promise<string | undefined> => {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return undefined
  }
}

const hasPublishedAddresses = (contents: string) =>
  /\b0x[0-9a-fA-F]+\b/.test(contents)

const hasPublishedDependencyEntries = (contents: string) =>
  /\broot\s*=\s*false\b/.test(contents)

const deriveLocalnetTestPublishOptions = async (
  packagePath: string
): Promise<LocalnetTestPublishOptions> => {
  const publicationFilePath = resolvePublicationFilePath(
    packagePath,
    LOCALNET_ENVIRONMENT_NAME
  )
  const publicationFileContents =
    await readPublicationFileContents(publicationFilePath)
  const publicationFileExists = publicationFileContents !== undefined
  const publicationFileHasAddresses = publicationFileContents
    ? hasPublishedAddresses(publicationFileContents)
    : false
  const publicationFileHasDependencyEntries = publicationFileContents
    ? hasPublishedDependencyEntries(publicationFileContents)
    : false
  const withUnpublishedDependencies =
    !publicationFileExists ||
    !publicationFileHasAddresses ||
    !publicationFileHasDependencyEntries

  return {
    buildEnvironmentName: LOCALNET_ENVIRONMENT_NAME,
    publicationFilePath,
    publicationFileExists,
    hasPublishedAddresses: publicationFileHasAddresses,
    withUnpublishedDependencies
  }
}

const formatUnpublishedDependencyMode = (
  options: LocalnetTestPublishOptions
) => {
  if (!options.publicationFileExists) return "enabled (pubfile missing)"
  if (!options.hasPublishedAddresses)
    return "enabled (pubfile has no published addresses)"
  return "disabled (pubfile has published addresses)"
}

const logMoveTestPlan = (
  packagePath: string,
  options: ResolvedMoveTestOptions
) => {
  logSimpleBlue("Running Move tests")
  logKeyValueBlue("package")(packagePath)
  logKeyValueBlue("environment")(options.environmentName ?? "default")
  console.log("")
}

const logLocalnetTestPublishPlan = (
  packagePath: string,
  options: LocalnetTestPublishOptions
) => {
  logSimpleBlue("Running localnet test-publish")
  logKeyValueBlue("package")(packagePath)
  logKeyValueBlue("buildEnv")(options.buildEnvironmentName)
  logKeyValueBlue("pubfile")(options.publicationFilePath)
  logKeyValueBlue("withUnpublishedDeps")(
    formatUnpublishedDependencyMode(options)
  )
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

const runLocalnetTestPublish = async (
  packagePath: string,
  options: LocalnetTestPublishOptions
) => {
  const cliArguments = buildMoveTestPublishArguments({
    packagePath,
    buildEnvironmentName: options.buildEnvironmentName,
    publicationFilePath: options.publicationFilePath,
    withUnpublishedDependencies: options.withUnpublishedDependencies
  })
  const { stdout, stderr, exitCode } = await runClientTestPublish(cliArguments)

  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)

  if (exitCode && exitCode !== 0) {
    throw new Error(`sui client test-publish exited with code ${exitCode}.`)
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

    if (isLocalnetNetwork(network.networkName)) {
      const localnetTestPublishOptions =
        await deriveLocalnetTestPublishOptions(fullPackagePath)

      logLocalnetTestPublishPlan(fullPackagePath, localnetTestPublishOptions)
      await runLocalnetTestPublish(fullPackagePath, localnetTestPublishOptions)
    }

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
