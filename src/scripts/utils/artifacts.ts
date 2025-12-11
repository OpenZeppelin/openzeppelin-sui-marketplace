import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { PublishArtifact } from "./types.ts"

export const writeArtifact =
  <TArtifact>(defaultIfMissing?: TArtifact) =>
  async (filePath: string, newArtifact: TArtifact): Promise<TArtifact> => {
    try {
      await mkdir(dirname(filePath), { recursive: true })

      const currentArtifacts = await readArtifact<TArtifact>(
        filePath,
        defaultIfMissing
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
