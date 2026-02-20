import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"

const normalizePackageNameForComparison = (packageName: string) =>
  packageName.trim().toLowerCase()

const isRootPublishArtifact = (artifact: PublishArtifact) =>
  artifact.isDependency !== true

const selectFallbackArtifact = (
  artifacts: PublishArtifact[]
): PublishArtifact | undefined => artifacts[0]

const resolveNormalizedPackageName = (artifact: PublishArtifact) =>
  artifact.packageName
    ? normalizePackageNameForComparison(artifact.packageName)
    : undefined

const findArtifactByPackageName = (
  artifacts: PublishArtifact[],
  packageName: string
) => artifacts.find(isPublishArtifactNamed(packageName))

export const pickRootNonDependencyArtifact = (artifacts: PublishArtifact[]) => {
  const selectedArtifact =
    artifacts.find(isRootPublishArtifact) ?? selectFallbackArtifact(artifacts)
  if (selectedArtifact) return selectedArtifact
  throw new Error("No artifacts to select from.")
}

export const isPublishArtifactNamed =
  (packageName: string) =>
  (artifact: PublishArtifact): boolean => {
    const normalizedRequestedPackageName =
      normalizePackageNameForComparison(packageName)
    const normalizedArtifactPackageName = resolveNormalizedPackageName(artifact)

    return normalizedArtifactPackageName === normalizedRequestedPackageName
  }

export const findPublishedPackageIdByName = (
  artifacts: PublishArtifact[],
  packageName: string
): string | undefined =>
  findArtifactByPackageName(artifacts, packageName)?.packageId
