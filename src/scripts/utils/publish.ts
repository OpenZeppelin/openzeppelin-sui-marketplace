import { SuiClient, type SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { Transaction } from "@mysten/sui/transactions"
import { writeDeploymentArtifact } from "./artifacts.ts"
import type { SuiNetworkConfig } from "./config.ts"
import { getDeploymentArtifactPath } from "./constants.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logSimpleBlue,
  logSimpleGreen,
  logWarning
} from "./log.ts"
import { buildMovePackage } from "./move.ts"
import { buildExplorerUrl } from "./network.ts"
import { runSuiCli } from "./suiCli.ts"
import type {
  BuildOutput,
  NetworkName,
  PublishArtifact,
  PublishResult
} from "./types.ts"

export const publishPackageWithLog = async (
  {
    network,
    fullNodeUrl,
    packagePath,
    keypair,
    gasBudget = 200_000_000,
    withUnpublishedDependencies = false
  }: {
    network: SuiNetworkConfig
    packagePath: string
    fullNodeUrl: string
    keypair: Ed25519Keypair
    gasBudget?: number
    withUnpublishedDependencies?: boolean
  },
  initiatedSuiClient?: SuiClient
) => {
  logSimpleBlue("Publishing package 💧")
  logKeyValueBlue("network")(`${network.networkName} / ${fullNodeUrl}`)
  logKeyValueBlue("package")(packagePath)
  logKeyValueBlue("publisher")(keypair.toSuiAddress())
  if (withUnpublishedDependencies)
    logKeyValueBlue("with unpublished deps")("enabled")

  const artifact = await publishPackage(
    {
      network,
      packagePath,
      fullNodeUrl,
      keypair,
      gasBudget,
      withUnpublishedDependencies
    },
    initiatedSuiClient
  )

  logSimpleGreen("Publish succeeded ✅")
  logKeyValueGreen("packageId")(artifact.packageId)
  if (artifact.upgradeCap) logKeyValueGreen("upgradeCap")(artifact.upgradeCap)

  logKeyValueGreen("digest")(artifact.digest)
  if (artifact.explorerUrl) logKeyValueGreen("explorer")(artifact.explorerUrl)

  return artifact
}

export const publishPackage = async (
  {
    network,
    fullNodeUrl,
    packagePath,
    gasBudget,
    keypair,
    withUnpublishedDependencies = false
  }: {
    network: SuiNetworkConfig
    packagePath: string
    fullNodeUrl: string
    keypair: Ed25519Keypair
    gasBudget: number
    withUnpublishedDependencies?: boolean
  },
  initiatedSuiClient?: SuiClient
): Promise<PublishArtifact> => {
  const buildOutput = await buildMovePackage(
    packagePath,
    withUnpublishedDependencies ? ["--with-unpublished-dependencies"] : []
  )

  const publishResult = await doPublishPackage(
    {
      fullNodeUrl,
      keypair,
      buildOutput,
      gasBudget
    },
    initiatedSuiClient
  )

  if (!publishResult.packageId)
    throw new Error("Publish succeeded but no packageId was returned.")

  const artifact: PublishArtifact = {
    network: network.networkName,
    rpcUrl: fullNodeUrl,
    packagePath: packagePath,
    packageId: publishResult.packageId,
    upgradeCap: publishResult.upgradeCap,
    sender: keypair.toSuiAddress(),
    digest: publishResult.digest,
    publishedAt: new Date().toISOString(),
    modules: buildOutput.modules,
    dependencies: buildOutput.dependencies,
    explorerUrl: buildExplorerUrl(
      publishResult.digest,
      network.networkName as NetworkName
    )
  }

  await writeDeploymentArtifact(
    getDeploymentArtifactPath(network.networkName),
    [artifact]
  )

  return artifact
}

export const doPublishPackage = async (
  {
    fullNodeUrl,
    buildOutput,
    gasBudget,
    keypair
  }: {
    fullNodeUrl: string
    keypair: Ed25519Keypair
    buildOutput: BuildOutput
    gasBudget: number
  },
  initiatedSuiClient?: SuiClient
) => {
  const suiClient = initiatedSuiClient || new SuiClient({ url: fullNodeUrl })

  const publishTransaction = new Transaction()

  publishTransaction.setSender(keypair.getPublicKey().toSuiAddress())
  publishTransaction.setGasBudget(gasBudget)

  const [upgrade_cap] = publishTransaction.publish(buildOutput)

  publishTransaction.transferObjects(
    [upgrade_cap],
    keypair.getPublicKey().toSuiAddress()
  )

  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: publishTransaction,
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showEvents: true,
      showInput: true,
      showObjectChanges: true,
      showRawInput: false
    }
  })

  if (result.effects?.status.status !== "success")
    throw new Error(
      `Publish failed: ${result.effects?.status.error ?? "unknown error"}`
    )

  const publishInfo = extractPublishResult(result)
  if (!publishInfo.packageId)
    throw new Error("Publish succeeded but no packageId was returned.")

  return publishInfo
}

export const runClientPublish = runSuiCli(["client", "publish"])

const _publishPackageWithCli = async (
  {
    packagePath,
    gasBudget,
    keystorePath
  }: {
    packagePath: string
    gasBudget: number
    keystorePath?: string
    rpcUrl: string
    signer: string
  },
  publishArguments: string[] = []
): Promise<PublishResult> => {
  if (!keystorePath) {
    throw new Error(
      "keystorePath is required when publishing with unpublished dependencies."
    )
  }

  const { stdout, stderr } = await runClientPublish([
    packagePath,
    "--json",
    "--gas-budget",
    gasBudget.toString(),
    ...publishArguments
  ])

  if (stderr?.trim()) logWarning(stderr.trim())

  const parsed = parseCliJson(stdout)

  return extractPublishResult(parsed as SuiTransactionBlockResponse)
}

const parseCliJson = (stdout: string) => {
  const lines = stdout.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    const candidate = line.trim()
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue
    try {
      return JSON.parse(candidate)
    } catch {
      /* keep scanning */
    }
  }

  throw new Error("Failed to parse JSON from Sui CLI publish output.")
}

const extractPublishResult = (
  result: SuiTransactionBlockResponse
): PublishResult => {
  const packageChange = result.objectChanges?.find(
    (change) => change.type === "published"
  ) as { packageId?: string } | undefined

  const upgradeCapChange = result.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      "objectType" in change &&
      typeof change.objectType === "string" &&
      change.objectType.endsWith("::package::UpgradeCap")
  ) as { objectId?: string } | undefined

  return {
    packageId: packageChange?.packageId,
    upgradeCap: upgradeCapChange?.objectId as string,
    digest: result.digest
  }
}
