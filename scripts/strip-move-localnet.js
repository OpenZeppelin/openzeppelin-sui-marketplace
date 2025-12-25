#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

const args = new Set(process.argv.slice(2))
const isStaged = args.has("--staged")
const isAll = args.has("--all")
const restoreAfterStage = isStaged && !args.has("--no-restore")

const LOCALNET_SECTION = /\n?\[env\.localnet\][\s\S]*?(?=\n\[|$)/

const runGit = (gitArgs) =>
  execFileSync("git", gitArgs, { encoding: "utf8" }).trim()

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

  const root = process.cwd()
  for (const file of moveLocks) {
    const fullPath = path.resolve(root, file)
    let contents

    try {
      contents = await fs.readFile(fullPath, "utf8")
    } catch {
      continue
    }

    const result = stripLocalnet(contents)
    if (!result.changed) {
      continue
    }

    if (isStaged) {
      await fs.writeFile(fullPath, result.contents, "utf8")
      try {
        runGit(["add", "--", file])
      } finally {
        if (restoreAfterStage) {
          await fs.writeFile(fullPath, contents, "utf8")
        }
      }
    } else {
      await fs.writeFile(fullPath, result.contents, "utf8")
    }
  }
}

main().catch((error) => {
  console.error("Failed to strip [env.localnet] from Move.lock:", error)
  process.exit(1)
})
