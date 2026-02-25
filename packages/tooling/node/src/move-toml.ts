import fs from "node:fs/promises"
import path from "node:path"

import { formatErrorMessage } from "@sui-oracle-market/tooling-core/utils/errors"
import type { ToolingContext } from "./factory.ts"
import { logKeyValueBlue, logWarning } from "./log.ts"
import { resolveMoveCliEnvironmentName } from "./move.ts"
import { getSuiCliEnvironmentChainId } from "./suiCli.ts"
import { isErrnoWithCode } from "./utils/fs.ts"
import { escapeRegExp } from "./utils/regex.ts"
import { findTomlSectionByName } from "./utils/toml.ts"

type MoveEnvironmentSyncResult = {
  updatedFiles: string[]
}

export type MoveEnvironmentChainIdSyncResult = {
  updatedFiles: string[]
  chainId?: string
  didAttempt: boolean
}

export const logLocalnetMoveEnvironmentSyncResult = ({
  chainId,
  updatedFiles,
  didAttempt
}: MoveEnvironmentChainIdSyncResult) => {
  if (didAttempt && !chainId) {
    logWarning(
      "Unable to resolve localnet chain id; Move.toml environments were not updated."
    )
  }

  if (updatedFiles.length) {
    logKeyValueBlue("Move.toml")(
      `updated ${updatedFiles.length} test-publish environment entries`
    )
  }
}

const resolveLineEnding = (contents: string) =>
  contents.includes("\r\n") ? "\r\n" : "\n"

export const listMoveTomlFiles = async (
  rootPath: string
): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  const filesByEntry = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const fullPath = path.join(rootPath, entry.name)
      if (entry.isDirectory()) return listMoveTomlFiles(fullPath)
      if (entry.isFile() && entry.name === "Move.toml") return [fullPath]
      return []
    })
  )

  return filesByEntry.flat()
}

const trimLeadingEmptyLines = (contents: string) =>
  contents.replace(/^(?:\s*\r?\n)+/, "")

const trimTrailingEmptyLines = (contents: string) =>
  contents.replace(/(?:\r?\n\s*)+$/, "")

const ensureTrailingNewline = (
  contents: string,
  lineEnding: string,
  shouldPreserveTrailingNewline: boolean
) => {
  if (!shouldPreserveTrailingNewline) return contents
  return contents.endsWith("\n") ? contents : `${contents}${lineEnding}`
}

const removePublishedSectionForNetwork = (
  contents: string,
  networkName: string
): { updatedContents: string; didUpdate: boolean } => {
  const sectionName = `published.${networkName}`
  const sectionBlock = findTomlSectionByName(contents, sectionName)
  if (!sectionBlock) return { updatedContents: contents, didUpdate: false }

  const lineEnding = resolveLineEnding(contents)
  const shouldPreserveTrailingNewline = contents.endsWith("\n")
  const before = trimTrailingEmptyLines(contents.slice(0, sectionBlock.start))
  const after = trimLeadingEmptyLines(contents.slice(sectionBlock.end))
  const separator =
    before && after
      ? `${lineEnding}${lineEnding}`
      : before && !after
        ? lineEnding
        : ""
  const combined = `${before}${separator}${after}`

  return {
    updatedContents: ensureTrailingNewline(
      combined,
      lineEnding,
      shouldPreserveTrailingNewline
    ),
    didUpdate: true
  }
}

const hasDepReplacementSection = (contents: string, environmentName: string) =>
  new RegExp(
    `^\\s*\\[dep-replacements\\.${escapeRegExp(environmentName)}\\]\\s*(#.*)?$`,
    "m"
  ).test(contents)

const hasEnvironmentEntry = (contents: string, environmentName: string) => {
  const environmentBlock = findTomlSectionByName(contents, "environments")
  if (!environmentBlock) return false

  const entryRegex = new RegExp(
    `^\\s*${escapeRegExp(environmentName)}\\s*=\\s*"[^"]*"\\s*(#.*)?$`
  )

  return environmentBlock.block
    .split(/\r?\n/)
    .some((line) => entryRegex.test(line))
}

const resolveEnvironmentEntryIndent = (
  lines: string[],
  headerIndex: number
) => {
  const entryLine = lines.slice(headerIndex + 1).find((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith("#")
  })
  return entryLine?.match(/^\s*/)?.[0] ?? ""
}

const updateEnvironmentBlock = ({
  block,
  environmentName,
  chainId
}: {
  block: string
  environmentName: string
  chainId: string
}): { updatedBlock: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(block)
  const lines = block.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    /^\s*\[environments\]\s*(#.*)?$/.test(line)
  )
  if (headerIndex < 0) return { updatedBlock: block, didUpdate: false }

  const escapedEnvironmentName = escapeRegExp(environmentName)
  const entryRegex = new RegExp(
    `^(\\s*)${escapedEnvironmentName}\\s*=\\s*"([^"]*)"(?:(\\s*#.*))?$`
  )
  const entryIndex = lines.findIndex((line) => entryRegex.test(line))

  if (entryIndex >= 0) {
    const match = lines[entryIndex]?.match(entryRegex)
    const existingChainId = match?.[2]
    if (existingChainId === chainId) {
      return { updatedBlock: block, didUpdate: false }
    }
    const indent = match?.[1] ?? ""
    const commentSuffix = match?.[3] ?? ""
    const updatedEntryLine = `${indent}${environmentName} = "${chainId}"${commentSuffix}`
    const updatedLines = lines.map((line, index) =>
      index === entryIndex ? updatedEntryLine : line
    )
    return { updatedBlock: updatedLines.join(lineEnding), didUpdate: true }
  }

  const indent = resolveEnvironmentEntryIndent(lines, headerIndex)
  const lastContentIndex = (() => {
    for (let index = lines.length - 1; index > headerIndex; index -= 1) {
      if (lines[index].trim().length > 0) return index
    }
    return headerIndex
  })()
  const insertIndex = lastContentIndex + 1
  const newEntryLine = `${indent}${environmentName} = "${chainId}"`
  const updatedLines = [
    ...lines.slice(0, insertIndex),
    newEntryLine,
    ...lines.slice(insertIndex)
  ]
  return { updatedBlock: updatedLines.join(lineEnding), didUpdate: true }
}

const insertEnvironmentBlock = (contents: string, block: string): string => {
  const lineEnding = resolveLineEnding(contents)
  const normalizedBlock = block.split(/\r?\n/).join(lineEnding)
  const insertionMatch = contents.match(
    /^\s*\[(addresses|dev-dependencies)\]\s*(#.*)?$/m
  )

  if (insertionMatch?.index === undefined) {
    const prefix = contents.endsWith("\n")
      ? contents
      : `${contents}${lineEnding}`
    return `${prefix}${normalizedBlock}${lineEnding}`
  }

  const before = contents.slice(0, insertionMatch.index)
  const after = contents.slice(insertionMatch.index)

  const prefix = before.endsWith("\n") ? before : `${before}${lineEnding}`
  const suffix =
    after.startsWith("\n") || after.startsWith("\r\n")
      ? after
      : `${lineEnding}${after}`

  return `${prefix}${normalizedBlock}${suffix}`
}

const updateMoveTomlEnvironmentChainId = ({
  contents,
  environmentName,
  chainId,
  shouldRequireManagedEnvironment = true
}: {
  contents: string
  environmentName: string
  chainId: string
  shouldRequireManagedEnvironment?: boolean
}): { updatedContents: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(contents)
  const shouldManageEnvironment =
    hasDepReplacementSection(contents, environmentName) ||
    hasEnvironmentEntry(contents, environmentName)

  if (shouldRequireManagedEnvironment && !shouldManageEnvironment) {
    return { updatedContents: contents, didUpdate: false }
  }

  const environmentBlock = findTomlSectionByName(contents, "environments")
  const newEntryBlock = `[environments]${lineEnding}${environmentName} = "${chainId}"`

  if (!environmentBlock) {
    return {
      updatedContents: insertEnvironmentBlock(contents, newEntryBlock),
      didUpdate: true
    }
  }

  const { updatedBlock, didUpdate } = updateEnvironmentBlock({
    block: environmentBlock.block,
    environmentName,
    chainId
  })
  if (!didUpdate) return { updatedContents: contents, didUpdate: false }

  return {
    updatedContents:
      contents.slice(0, environmentBlock.start) +
      updatedBlock +
      contents.slice(environmentBlock.end),
    didUpdate: true
  }
}

export const ensureMoveTomlEnvironmentChainId = async ({
  moveTomlPath,
  environmentName,
  chainId
}: {
  moveTomlPath: string
  environmentName: string
  chainId: string
}): Promise<boolean> => {
  const contents = await fs.readFile(moveTomlPath, "utf8")
  const { updatedContents, didUpdate } = updateMoveTomlEnvironmentChainId({
    contents,
    environmentName,
    chainId,
    shouldRequireManagedEnvironment: false
  })
  if (!didUpdate) return false

  await fs.writeFile(moveTomlPath, updatedContents)
  return true
}

/**
 * Resolves the chain identifier from RPC, falling back to Sui CLI env config.
 */
export const resolveChainIdentifier = async (
  { environmentName }: { environmentName?: string },
  { suiClient }: ToolingContext
): Promise<string | undefined> => {
  try {
    return await suiClient.getChainIdentifier()
  } catch {
    return await getSuiCliEnvironmentChainId(environmentName)
  }
}

/**
 * Ensures the Move.toml environments entry matches the localnet chain id.
 * Use dryRun to report drift without writing changes.
 */
export const syncLocalnetMoveEnvironmentChainId = async (
  {
    moveRootPath,
    environmentName,
    dryRun = false
  }: {
    moveRootPath: string
    environmentName: string | undefined
    dryRun?: boolean
  },
  toolingContext: ToolingContext
): Promise<MoveEnvironmentChainIdSyncResult> => {
  if (environmentName !== "localnet")
    return { updatedFiles: [], didAttempt: false }

  const chainId = await resolveChainIdentifier(
    {
      environmentName
    },
    toolingContext
  )

  if (!chainId) return { updatedFiles: [], chainId, didAttempt: true }

  const resolvedEnvironmentName = resolveMoveCliEnvironmentName(environmentName)
  if (!resolvedEnvironmentName)
    return { updatedFiles: [], chainId, didAttempt: true }

  const { updatedFiles } = await syncMoveEnvironmentChainId({
    moveRootPath,
    environmentName: resolvedEnvironmentName,
    chainId,
    dryRun
  })

  return { updatedFiles, chainId, didAttempt: true }
}

/**
 * Syncs Move.toml environment chain IDs under the provided move root.
 * Use dryRun to report potential updates without writing files.
 */
export const syncMoveEnvironmentChainId = async ({
  moveRootPath,
  environmentName,
  chainId,
  dryRun = false
}: {
  moveRootPath: string
  environmentName: string
  chainId: string
  dryRun?: boolean
}): Promise<MoveEnvironmentSyncResult> => {
  const updatedFiles: string[] = []

  try {
    const moveTomlFiles = await listMoveTomlFiles(moveRootPath)
    await Promise.all(
      moveTomlFiles.map(async (moveTomlPath) => {
        const contents = await fs.readFile(moveTomlPath, "utf8")
        const { updatedContents, didUpdate } = updateMoveTomlEnvironmentChainId(
          {
            contents,
            environmentName,
            chainId
          }
        )
        if (!didUpdate) return
        if (!dryRun) {
          await fs.writeFile(moveTomlPath, updatedContents)
        }
        updatedFiles.push(moveTomlPath)
      })
    )
  } catch (error) {
    logWarning(
      `Failed to sync Move.toml environments under ${moveRootPath}: ${formatErrorMessage(
        error
      )}`
    )
  }

  return { updatedFiles }
}

export const clearPublishedEntryForNetwork = async ({
  packagePath,
  networkName
}: {
  packagePath: string
  networkName: string | undefined
}): Promise<{ publishedTomlPath: string; didUpdate: boolean }> => {
  const publishedTomlPath = path.join(packagePath, "Published.toml")
  if (!networkName) return { publishedTomlPath, didUpdate: false }

  let contents: string
  try {
    contents = await fs.readFile(publishedTomlPath, "utf8")
  } catch (error) {
    if (isErrnoWithCode(error, "ENOENT"))
      return { publishedTomlPath, didUpdate: false }
    throw error
  }

  const targetNetworks =
    networkName === "localnet" ? ["localnet", "test-publish"] : [networkName]
  let updatedContents = contents
  let didUpdate = false

  for (const targetNetwork of targetNetworks) {
    const result = removePublishedSectionForNetwork(
      updatedContents,
      targetNetwork
    )
    updatedContents = result.updatedContents
    if (result.didUpdate) didUpdate = true
  }

  if (!didUpdate) return { publishedTomlPath, didUpdate: false }

  await fs.writeFile(publishedTomlPath, updatedContents)
  return { publishedTomlPath, didUpdate: true }
}
