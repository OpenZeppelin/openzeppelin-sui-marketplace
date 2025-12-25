/**
 * Creates a new Shop object from a published Move package and publisher capability.
 * On Sui, publishing a package yields a Publisher object; creating a Shop uses that capability.
 * If you come from EVM, this is closer to instantiating a contract with a factory plus a capability token.
 * The result is a shared Shop object plus an owner capability stored in artifacts.
 */
import yargs from "yargs"

import { getShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { buildCreateShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import {
  loadDeploymentArtifacts,
  loadObjectArtifacts
} from "@sui-oracle-market/tooling-node/artifacts"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logShopOverview } from "../../utils/log-summaries.ts"

type CreateShopArguments = {
  shopPackageId?: string
  publisherCapId?: string
}

runSuiScript(
  async (tooling, cliArguments: CreateShopArguments) => {
    const inputs = await resolveInputs(
      cliArguments,
      tooling.network.networkName
    )

    const createShopTransaction = buildCreateShopTransaction({
      packageId: inputs.shopPackageId,
      publisherCapId: inputs.publisherCapId
    })

    const {
      objectArtifacts: { created: createdObjects }
    } = await tooling.signAndExecute({
      transaction: createShopTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const createdShop = createdObjects.find((artifact) =>
      artifact.objectType.endsWith("::shop::Shop")
    )
    if (!createdShop)
      throw new Error(
        "Expected a Shop object to be created, but it was not found in transaction artifacts."
      )

    const shopOverview = await getShopOverview(
      createdShop.objectId,
      tooling.suiClient
    )
    logShopOverview(shopOverview)
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
      demandOption: false
    })
    .option("publisherCapId", {
      alias: ["publisher-cap-id", "publisher-id"],
      type: "string",
      description:
        "0x2::package::Publisher object ID for this module (not the UpgradeCap); inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
      demandOption: false
    })
    .strict()
)

const resolveInputs = async (
  cliArguments: CreateShopArguments,
  networkName: string
): Promise<{ shopPackageId: string; publisherCapId: string }> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  const latestShopPublishArtifact =
    findLatestShopPublishArtifact(deploymentArtifacts)

  const shopPackageId = normalizeIdOrThrow(
    cliArguments.shopPackageId ?? latestShopPublishArtifact?.packageId,
    "A shop package id is required; publish the package or provide --shop-package-id."
  )

  const publisherCapIdFromArtifacts =
    latestShopPublishArtifact?.publisherId ??
    (await resolvePublisherCapIdFromObjectArtifacts({
      networkName,
      publishDigest: latestShopPublishArtifact?.digest
    }))

  const publisherCapId = normalizeIdOrThrow(
    cliArguments.publisherCapId ?? publisherCapIdFromArtifacts,
    "A publisher cap id is required; publish the package or provide --publisher-cap-id."
  )

  return { shopPackageId, publisherCapId }
}

const findLatestShopPublishArtifact = (
  deploymentArtifacts: PublishArtifact[]
): PublishArtifact | undefined =>
  pickLatestArtifact(deploymentArtifacts.filter(isOracleMarketPublishArtifact))

const isOracleMarketPublishArtifact = (artifact: PublishArtifact): boolean => {
  const normalizedPackageName = artifact.packageName?.trim().toLowerCase()
  if (normalizedPackageName === "sui_oracle_market") return true

  const packagePath = (artifact.packagePath ?? "").replace(/\\/g, "/")
  if (packagePath.endsWith("/oracle-market")) return true
  if (packagePath.includes("/move/oracle-market")) return true

  return false
}

const pickLatestArtifact = <TArtifact extends { publishedAt?: string }>(
  artifacts: TArtifact[]
): TArtifact | undefined => {
  if (artifacts.length === 0) return undefined

  // Prefer publishedAt when present; fallback to array order otherwise.
  const hasPublishedAt = artifacts.some((a) => Boolean(a.publishedAt))
  if (!hasPublishedAt) return artifacts[artifacts.length - 1]

  return artifacts.reduce<TArtifact | undefined>((latest, current) => {
    if (!latest) return current

    const latestTime = Date.parse(latest.publishedAt ?? "")
    const currentTime = Date.parse(current.publishedAt ?? "")

    if (!Number.isFinite(latestTime)) return current
    if (!Number.isFinite(currentTime)) return latest

    return currentTime >= latestTime ? current : latest
  }, undefined)
}

const resolvePublisherCapIdFromObjectArtifacts = async ({
  networkName,
  publishDigest
}: {
  networkName: string
  publishDigest?: string
}): Promise<string | undefined> => {
  if (!publishDigest) return undefined

  const objectArtifacts = await loadObjectArtifacts(networkName)
  const publisherArtifact = objectArtifacts.reduceRight<
    (typeof objectArtifacts)[number] | undefined
  >((latest, artifact) => {
    if (latest) return latest
    if (artifact.digest !== publishDigest) return undefined
    if (!artifact.objectType?.endsWith("::package::Publisher")) return undefined
    return artifact
  }, undefined)

  return publisherArtifact?.objectId
}
