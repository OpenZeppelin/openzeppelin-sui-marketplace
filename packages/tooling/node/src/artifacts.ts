import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import { formatErrorMessage } from "@sui-oracle-market/tooling-core/utils/errors"
import { AsyncLocalStorage } from "node:async_hooks"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path, { dirname } from "node:path"

export const ARTIFACTS_FILES = ["mock", "deployment", "objects"] as const
export type ArtifactFile = (typeof ARTIFACTS_FILES)[number]

const artifactsRootStore = new AsyncLocalStorage<string>()

export const withArtifactsRoot = async <T>(
  artifactsDir: string,
  action: () => Promise<T> | T
): Promise<T> => {
  const resolved = path.resolve(artifactsDir)
  return await artifactsRootStore.run(resolved, action)
}

const resolveArtifactKey = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.objectId === "string") return `object:${record.objectId}`
  if (typeof record.packageId === "string") return `package:${record.packageId}`
  return undefined
}

const dedupeArtifacts = <TArtifact>(entries: TArtifact[]): TArtifact[] => {
  const seen = new Set<string>()
  const dedupedReversed: TArtifact[] = []

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const key = resolveArtifactKey(entry)
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    dedupedReversed.push(entry)
  }

  return dedupedReversed.reverse()
}

/**
 * Curried writer that appends/merges JSON artifacts on disk.
 * Why: deployment/mock scripts share a consistent artifact format so other tools
 * (indexers, relayers) can pick up package IDs and object IDs without bespoke parsing.
 */
export const writeArtifact =
  <TArtifact>(defaultIfMissing?: TArtifact) =>
  async (filePath: string, newArtifact: TArtifact): Promise<TArtifact> => {
    try {
      await mkdir(dirname(filePath), { recursive: true })

      const currentArtifacts = await readArtifact<TArtifact>(
        filePath,
        defaultIfMissing as TArtifact
      )

      const updatedArtifacts =
        Array.isArray(currentArtifacts) && Array.isArray(newArtifact)
          ? dedupeArtifacts([...currentArtifacts, ...newArtifact])
          : {
              ...currentArtifacts,
              ...newArtifact
            }

      await writeFile(filePath, JSON.stringify(updatedArtifacts, undefined, 2))

      return updatedArtifacts as unknown as TArtifact
    } catch (error) {
      throw new Error(
        `Failed to write artifact at ${filePath}: ${formatErrorMessage(error)}`
      )
    }
  }

/**
 * Writes/merges deployment artifacts.
 */
export const writeDeploymentArtifact = writeArtifact<PublishArtifact[]>([])
/**
 * Writes/merges object artifacts.
 */
export const writeObjectArtifact = writeArtifact<ObjectArtifact[]>([])

/**
 * Rewrites the full object artifact file after applying updates.
 */
export const rewriteUpdatedArtifacts = async <TArtifact>({
  objectArtifacts,
  networkName
}: {
  objectArtifacts: TArtifact[]
  networkName: string
}): Promise<void> => {
  const objectArtifactPath = getObjectArtifactPath(networkName)

  try {
    await writeFile(
      objectArtifactPath,
      JSON.stringify(objectArtifacts, undefined, 2)
    )
  } catch (error) {
    throw new Error(
      `Failed to persist updated object artifacts at ${objectArtifactPath}: ${formatErrorMessage(
        error
      )}`
    )
  }
}

/**
 * Reads a JSON artifact from disk, optionally creating it with defaults when missing.
 * Useful for idempotent flows where artifacts double as state storage between runs.
 */
export const readArtifact = async <TArtifact>(
  filePath: string,
  defaultIfMissing?: TArtifact
): Promise<TArtifact> => {
  try {
    const rawArtifact = await readFile(filePath, "utf8")
    return JSON.parse(rawArtifact) as TArtifact
  } catch (error) {
    if (
      defaultIfMissing &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(defaultIfMissing, undefined, 2))

      return defaultIfMissing
    }

    throw new Error(
      `Failed to read artifact at ${filePath}: ${formatErrorMessage(error)}`
    )
  }
}

/**
 * Builds a path resolver for artifact files by network name.
 */
const resolveArtifactsRoot = () => {
  const scoped = artifactsRootStore.getStore()
  if (scoped) return scoped

  const override = process.env.SUI_ARTIFACTS_DIR?.trim()
  if (override) return path.resolve(override)

  return path.join(process.cwd(), "deployments")
}

export const getArtifactPath =
  (artifactType: ArtifactFile) => (network: string) =>
    path.join(resolveArtifactsRoot(), `${artifactType}.${network}.json`)

/**
 * Returns the deployment artifact path for a network.
 */
export const getDeploymentArtifactPath = getArtifactPath("deployment")
/**
 * Returns the object artifact path for a network.
 */
export const getObjectArtifactPath = getArtifactPath("objects")

/**
 * Loads deployment artifacts for the given network.
 */
export const loadDeploymentArtifacts = (networkName: string) =>
  readArtifact<PublishArtifact[]>(getDeploymentArtifactPath(networkName), [])

/**
 * Loads object artifacts for the given network.
 */
export const loadObjectArtifacts = (networkName: string) =>
  readArtifact<ObjectArtifact[]>(getObjectArtifactPath(networkName), [])

/**
 * Returns the most recent object artifact that matches a type suffix.
 * Useful when multiple instances of the same Move type are created across runs.
 */
export const getLatestObjectFromArtifact =
  (objectTypeSuffix: string) =>
  async (networkName: string): Promise<ObjectArtifact | undefined> => {
    const objectArtifacts = await loadObjectArtifacts(networkName)

    return objectArtifacts.reduceRight<ObjectArtifact | undefined>(
      (latestMatch, artifact) => {
        if (latestMatch) return latestMatch
        if (!artifact.objectType?.endsWith(objectTypeSuffix)) return undefined

        return {
          ...artifact,
          packageId: normalizeSuiObjectId(artifact.packageId),
          objectId: normalizeSuiObjectId(artifact.objectId)
        }
      },
      undefined
    )
  }

/**
 * Returns the most recent deployment artifact that matches a type suffix.
 * Useful when multiple instances of the same Move type are created across runs.
 */
export const getLatestDeploymentFromArtifact =
  (packageName: string) =>
  async (networkName: string): Promise<PublishArtifact | undefined> => {
    const objectArtifacts = await loadDeploymentArtifacts(networkName)

    return objectArtifacts.reduceRight<PublishArtifact | undefined>(
      (latestMatch, artifact) => {
        if (latestMatch) return latestMatch
        if (!artifact.packageName?.endsWith(packageName)) return undefined

        return {
          ...artifact,
          packageId: normalizeSuiObjectId(artifact.packageId)
        }
      },
      undefined
    )
  }

export const getLatestArtifact = <TArtifact extends { publishedAt?: string }>(
  artifacts: TArtifact[]
): TArtifact | undefined => {
  if (artifacts.length === 0) return undefined

  const hasPublishedAt = artifacts.some((artifact) =>
    Boolean(artifact.publishedAt)
  )
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

export const findLatestArtifactThat = (
  predicate: (artifact: PublishArtifact) => boolean,
  deploymentArtifacts: PublishArtifact[]
) => getLatestArtifact(deploymentArtifacts.filter(predicate))

export const resolvePublisherCapIdFromObjectArtifacts = async ({
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
