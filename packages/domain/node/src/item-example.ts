import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import {
  isPublishArtifactNamed,
  loadDeploymentArtifacts,
  findLatestArtifactThat
} from "@sui-oracle-market/tooling-node/artifacts"

export const isItemExamplesPublishArtifact =
  isPublishArtifactNamed("item_examples")

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
