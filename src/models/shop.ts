// const normalizeShopArtifact = (
//   artifact: ShopObjectArtifact
// ): ShopObjectArtifact => ({
//   ...artifact,
//   packageId: normalizeOptionalId(artifact.packageId),
//   publisherId: normalizeOptionalId(artifact.publisherId),
//   creator: normalizeOptionalAddress(artifact.creator),
//   transactionDigest: artifact.transactionDigest,
//   objects: artifact.objects?.map(normalizeObject) ?? [],
//   // Remove legacy fields on write by overriding with undefined (JSON.stringify drops them).
//   shopId: undefined,
//   shopOwnerCapId: undefined,
//   shopInitialSharedVersion: undefined,
//   shopOwnerAddress: undefined,
//   digest: undefined
// })

// const DEFAULT_ARTIFACT: ShopObjectArtifact = { objects: [] }

/**
 * Reads the shop object artifact for a network, creating an empty baseline when missing.
 */
//TODO review and create a lookout
// export const readShopObjectArtifact = async (
//   network: NetworkName
// ): Promise<ShopObjectArtifact> =>
//   readArtifact<ShopObjectArtifact>(
//     getObjectArtifactPath(network),
//     DEFAULT_ARTIFACT
//   )

/**
 * Writes the shop object artifact to disk after normalizing IDs and shared versions.
 */
// export const writeShopObjectArtifact = async (
//   network: string,
//   artifact: ShopObjectArtifact,
//   options: { artifactPath?: string } = {}
// ): Promise<{ artifactPath: string; artifact: ShopObjectArtifact }> => {
//   const targetPath = options.artifactPath ?? getObjectArtifactPath(network)
//   const normalizedArtifact = normalizeShopArtifact(artifact)

//   const merged = await writeObjectArtifact(DEFAULT_ARTIFACT)(
//     targetPath,
//     normalizedArtifact
//   )

//   return { artifactPath: targetPath, artifact: merged }
// }
