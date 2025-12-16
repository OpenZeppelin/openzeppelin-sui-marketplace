import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path, { dirname } from "node:path"
import type { ObjectArtifact } from "./object.ts"
import type { PublishArtifact } from "./types.ts"

export const ARTIFACTS_FILES = ["mock", "deployment", "objects"] as const
export type ArtifactFile = (typeof ARTIFACTS_FILES)[number]

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
          ? [...currentArtifacts, ...newArtifact]
          : {
              ...currentArtifacts,
              ...newArtifact
            }

      await writeFile(filePath, JSON.stringify(updatedArtifacts, null, 2))

      return updatedArtifacts as unknown as TArtifact
    } catch (error) {
      throw new Error(
        `Failed to write artifact at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

export const writeDeploymentArtifact = writeArtifact<PublishArtifact[]>([])
export const writeObjectArtifact = writeArtifact<ObjectArtifact[]>([])

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
      JSON.stringify(objectArtifacts, null, 2)
    )
  } catch (error) {
    throw new Error(
      `Failed to persist updated object artifacts at ${objectArtifactPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
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
      await writeFile(filePath, JSON.stringify(defaultIfMissing, null, 2))

      return defaultIfMissing
    }

    throw new Error(
      `Failed to read artifact at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const getArtifactPath =
  (artifactType: ArtifactFile) => (network: string) =>
    path.join(process.cwd(), "deployments", `${artifactType}.${network}.json`)

export const getDeploymentArtifactPath = getArtifactPath("deployment")
export const getObjectArtifactPath = getArtifactPath("objects")

export const loadDeploymentArtifacts = (networkName: string) =>
  readArtifact<PublishArtifact[]>(getDeploymentArtifactPath(networkName), [])

export const loadObjectArtifacts = (networkName: string) =>
  readArtifact<ObjectArtifact[]>(getObjectArtifactPath(networkName), [])

export const getLatestObjectFromArtifact = async (
  objectTypeSuffix: string,
  networkName: string
): Promise<ObjectArtifact | undefined> => {
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
