import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const testRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

export const createTempDir = async (prefix = "tooling-test-") =>
  mkdtemp(path.join(os.tmpdir(), prefix))

export const withTempDir = async <T>(
  action: (dir: string) => Promise<T> | T,
  prefix?: string
): Promise<T> => {
  const dir = await createTempDir(prefix)

  try {
    return await action(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export const writeFileTree = async (
  root: string,
  files: Record<string, string>
) => {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const fullPath = path.join(root, relativePath)
      await mkdir(path.dirname(fullPath), { recursive: true })
      await writeFile(fullPath, contents, "utf8")
    })
  )
}

export const readTextFile = (filePath: string) => readFile(filePath, "utf8")

export const resolveRealPath = (value: string) => realpath(value)

export const fixturePath = (...segments: string[]) =>
  path.join(testRoot, "fixtures", ...segments)

export const readFixture = (...segments: string[]) =>
  readTextFile(fixturePath(...segments))
