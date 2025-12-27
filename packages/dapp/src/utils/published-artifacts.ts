import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import {
  findLatestArtifactThat,
  isPublishArtifactNamed,
  loadDeploymentArtifacts,
  resolvePublisherCapIdFromObjectArtifacts
} from "@sui-oracle-market/tooling-node/artifacts"

export const isOracleMarketPublishArtifact =
  isPublishArtifactNamed("sui_oracle_market")

export const isItemExamplesPublishArtifact =
  isPublishArtifactNamed("item_examples")

export const resolveShopPublishInputs = async ({
  networkName,
  shopPackageId,
  publisherCapId
}: {
  networkName: string
  shopPackageId?: string
  publisherCapId?: string
}): Promise<{ shopPackageId: string; publisherCapId: string }> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  const latestShopPublishArtifact = findLatestArtifactThat(
    isOracleMarketPublishArtifact,
    deploymentArtifacts
  )

  const resolvedShopPackageId = normalizeIdOrThrow(
    shopPackageId ?? latestShopPublishArtifact?.packageId,
    "A shop package id is required; publish the package or provide --shop-package-id."
  )

  const publisherCapIdFromArtifacts =
    latestShopPublishArtifact?.publisherId ??
    (await resolvePublisherCapIdFromObjectArtifacts({
      networkName,
      publishDigest: latestShopPublishArtifact?.digest
    }))

  const resolvedPublisherCapId = normalizeIdOrThrow(
    publisherCapId ?? publisherCapIdFromArtifacts,
    "A publisher cap id is required; publish the package or provide --publisher-cap-id."
  )

  return {
    shopPackageId: resolvedShopPackageId,
    publisherCapId: resolvedPublisherCapId
  }
}

export const resolveItemExamplesPackageId = async ({
  networkName,
  itemPackageId
}: {
  networkName: string
  itemPackageId?: string
}): Promise<string> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  const latestItemExamplesPublishArtifact = findLatestArtifactThat(
    isItemExamplesPublishArtifact,
    deploymentArtifacts
  )

  return normalizeIdOrThrow(
    itemPackageId ?? latestItemExamplesPublishArtifact?.packageId,
    "An item-examples package id is required; publish the item examples package or provide --item-package-id."
  )
}
