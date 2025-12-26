#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

const args = new Set(process.argv.slice(2))
const isStaged = args.has("--staged")
const isAll = args.has("--all")
const restoreAfterStage = isStaged && !args.has("--no-restore")

const LOCALNET_SECTION = /\n?\[env\.localnet\][\s\S]*?(?=\n\[|$)/

const getRepoRoot = () => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8"
    }).trim()
  } catch {
    return process.cwd()
  }
}

const repoRoot = getRepoRoot()

const runGit = (gitArgs, options = {}) => {
  const { input, trim = true } = options
  const output = execFileSync("git", gitArgs, {
    encoding: "utf8",
    cwd: repoRoot,
    input
  })

  return trim ? output.trim() : output
}

const getStagedFiles = () => {
  try {
    const output = runGit([
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACM"
    ])
    return output ? output.split("\n").filter(Boolean) : []
  } catch {
    return []
  }
}

const getAllMoveLocks = () => {
  try {
    const output = runGit(["ls-files", "--", "**/Move.lock"])
    return output ? output.split("\n").filter(Boolean) : []
  } catch {
    return []
  }
}

const getIndexEntry = (file) => {
  try {
    // Format: <mode> <object> <stage>\t<file>
    const line = runGit(["ls-files", "-s", "--", file])
    if (!line) return null
    const [mode, object, stageAndPath] = line.split(/\s+/, 3)
    const stage = stageAndPath?.split("\t")?.[0]
    if (!mode || !object || typeof stage === "undefined") return null
    return { mode, object, stage }
  } catch {
    return null
  }
}

const readFileFromIndex = (file) => {
  try {
    return runGit(["show", `:${file}`], { trim: false })
  } catch {
    return null
  }
}

const writeContentsToIndex = (file, mode, contents) => {
  const blob = runGit(["hash-object", "-w", "--stdin"], {
    input: contents,
    trim: true
  })

  // Prefer update-index so we don't have to touch the working tree.
  runGit(["update-index", "--cacheinfo", `${mode},${blob},${file}`])
}

const stripLocalnet = (contents) => {
  if (!LOCALNET_SECTION.test(contents)) {
    return { changed: false, contents }
  }

  const hadTrailingNewline = contents.endsWith("\n")
  const updated = contents.replace(LOCALNET_SECTION, "")
  const normalized = updated.replace(/\n{3,}/g, "\n\n")
  const withTrailingNewline =
    hadTrailingNewline && !normalized.endsWith("\n")
      ? `${normalized}\n`
      : normalized

  return { changed: true, contents: withTrailingNewline }
}

const main = async () => {
  const fileList = isAll ? getAllMoveLocks() : isStaged ? getStagedFiles() : []

  const moveLocks = fileList.filter(
    (file) => file.endsWith("/Move.lock") || path.basename(file) === "Move.lock"
  )

  if (moveLocks.length === 0) {
    return
  }

  const root = repoRoot
  for (const file of moveLocks) {
    const fullPath = path.resolve(root, file)
    let contents

    try {
      if (isStaged) {
        const staged = readFileFromIndex(file)
        if (staged == null) {
          continue
        }
        contents = staged
      } else {
        contents = await fs.readFile(fullPath, "utf8")
      }
    } catch {
      continue
    }

    const result = stripLocalnet(contents)
    if (!result.changed) {
      continue
    }

    if (isStaged) {
      const entry = getIndexEntry(file)
      if (!entry) {
        continue
      }

      writeContentsToIndex(file, entry.mode, result.contents)

      // Backwards-compat: older behavior temporarily modified the working tree.
      // We now update only the index, so there's nothing to restore.
      void restoreAfterStage
    } else {
      await fs.writeFile(fullPath, result.contents, "utf8")
    }
  }
}

main().catch((error) => {
  console.error("Failed to strip [env.localnet] from Move.lock:", error)
  process.exit(1)
})
