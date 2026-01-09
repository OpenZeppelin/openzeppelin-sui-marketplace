import { escapeRegExp } from "./utils/regex.ts"

export type MoveLockFormat = "pinned" | "legacy" | "unknown"

export type SuiFrameworkPinnedEntry = {
  /** e.g. "localnet" or "testnet" when parsing pinned locks */
  environmentName?: string
  /** The Move.lock section name (after the env), e.g. "Sui" or "MoveStdlib_1" */
  packageName: string
  /** Full section header as it appears in the lock, e.g. "[pinned.testnet.Sui_1]" */
  sectionHeader: string
  /** Git revision for MystenLabs/sui.git */
  revision: string
  /** Optional subdir from the inline table */
  subdir?: string
}

const detectMoveLockFormat = (lockContents: string): MoveLockFormat => {
  if (/^\s*\[move\]\s*$/m.test(lockContents)) return "pinned"
  if (/\[\[move\.package\]\]/.test(lockContents)) return "legacy"
  return "unknown"
}

const sliceTomlSection = (
  contents: string,
  headerPattern: RegExp
): string | undefined => {
  const lines = contents.split(/\r?\n/)
  const lineOffsets: number[] = [0]
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === "\n") lineOffsets.push(index + 1)
  }

  const headerIndex = lines.findIndex((line) => headerPattern.test(line))
  if (headerIndex < 0) return undefined

  const anyHeaderRegex = /^\s*\[[^\]]+\]\s*(#.*)?$/
  const nextHeaderIndex = lines.findIndex(
    (line, index) => index > headerIndex && anyHeaderRegex.test(line)
  )

  const start = lineOffsets[headerIndex] ?? 0
  const end =
    nextHeaderIndex >= 0
      ? (lineOffsets[nextHeaderIndex] ?? contents.length)
      : contents.length

  return contents.slice(start, end)
}

const extractSuiGitRevisionFromPinnedSection = (
  section: string
): string | undefined => {
  const sourceLineMatch = section.match(/^\s*source\s*=\s*\{([^}]*)\}\s*$/m)
  if (!sourceLineMatch) return undefined

  const sourceInlineTable = sourceLineMatch[1] ?? ""
  const isSuiFrameworkSource =
    /git\s*=\s*"https:\/\/github\.com\/MystenLabs\/sui\.git"/i.test(
      sourceInlineTable
    )
  if (!isSuiFrameworkSource) return undefined

  const revisionMatch = sourceInlineTable.match(/rev\s*=\s*"([^"]+)"/i)
  return revisionMatch?.[1]
}

const extractSuiGitSubdirFromPinnedSection = (section: string) => {
  const sourceLineMatch = section.match(/^\s*source\s*=\s*\{([^}]*)\}\s*$/m)
  if (!sourceLineMatch) return undefined

  const sourceInlineTable = sourceLineMatch[1] ?? ""
  const isSuiFrameworkSource =
    /git\s*=\s*"https:\/\/github\.com\/MystenLabs\/sui\.git"/i.test(
      sourceInlineTable
    )
  if (!isSuiFrameworkSource) return undefined

  const subdirMatch = sourceInlineTable.match(/subdir\s*=\s*"([^"]+)"/i)
  return subdirMatch?.[1]
}

const parsePinnedSectionHeaderParts = (
  headerLine: string
): {
  environmentName?: string
  packageName?: string
} => {
  const trimmed = headerLine.trim()
  const match = trimmed.match(/^\[pinned\.([^.\]]+)\.([^\]]+)\]$/)
  if (!match) return {}
  return { environmentName: match[1], packageName: match[2] }
}

const extractSuiFrameworkPinnedEntriesFromPinnedLock = ({
  lockContents,
  environmentName
}: {
  lockContents: string
  environmentName?: string
}): SuiFrameworkPinnedEntry[] => {
  const environmentPrefix = environmentName
    ? `pinned.${escapeRegExp(environmentName)}.`
    : "pinned."

  const headerRegex = new RegExp(
    `^\\s*\\[${environmentPrefix}[^\\]]+\\]\\s*$`,
    "gm"
  )

  const headerMatches = [...lockContents.matchAll(headerRegex)]
  const entries: SuiFrameworkPinnedEntry[] = []

  for (const match of headerMatches) {
    const sectionHeader = match[0].trim()
    const sectionHeaderPattern = new RegExp(
      `^\\s*${escapeRegExp(sectionHeader)}\\s*$`,
      "m"
    )
    const section = sliceTomlSection(lockContents, sectionHeaderPattern)
    if (!section) continue

    const revision = extractSuiGitRevisionFromPinnedSection(section)
    if (!revision) continue

    const { environmentName: parsedEnv, packageName } =
      parsePinnedSectionHeaderParts(sectionHeader)
    if (!packageName) continue

    entries.push({
      environmentName: parsedEnv,
      packageName,
      sectionHeader,
      revision,
      subdir: extractSuiGitSubdirFromPinnedSection(section)
    })
  }

  return entries
}

const extractSuiGitRevisionsFromPinnedLock = ({
  lockContents,
  environmentName
}: {
  lockContents: string
  environmentName?: string
}): Set<string> => {
  const environmentPrefix = environmentName
    ? `pinned\\.${escapeRegExp(environmentName)}\\.`
    : "pinned\\."

  const headerRegex = new RegExp(
    `^\\s*\\[${environmentPrefix}[^\\]]+\\]\\s*$`,
    "gm"
  )

  const headerMatches = [...lockContents.matchAll(headerRegex)]
  const revisions = new Set<string>()

  for (const match of headerMatches) {
    const headerLine = match[0].trim()
    const escapedHeader = escapeRegExp(headerLine)
    const section = sliceTomlSection(
      lockContents,
      new RegExp(`^\\s*${escapedHeader}\\s*$`, "m")
    )
    if (!section) continue

    const revision = extractSuiGitRevisionFromPinnedSection(section)
    if (revision) revisions.add(revision)
  }

  return revisions
}

const extractSuiGitRevisionsFromLegacyLock = (
  lockContents: string
): Set<string> => {
  const revisions = new Set<string>()
  const packageBlocks = lockContents.split(/\[\[move\.package\]\]/).slice(1)

  for (const packageBlock of packageBlocks) {
    const isSuiFrameworkBlock =
      /id\s*=\s*"Bridge"/i.test(packageBlock) ||
      /id\s*=\s*"Sui"/i.test(packageBlock) ||
      /id\s*=\s*"MoveStdlib"/i.test(packageBlock)

    if (!isSuiFrameworkBlock) continue

    const revisionMatch = packageBlock.match(/rev\s*=\s*"([^"]+)"/)
    if (revisionMatch?.[1]) revisions.add(revisionMatch[1])
  }

  return revisions
}

export const extractSuiFrameworkRevisionsFromMoveLock = ({
  lockContents,
  environmentName
}: {
  lockContents: string
  environmentName?: string
}): Set<string> => {
  const format = detectMoveLockFormat(lockContents)

  if (format === "pinned") {
    return extractSuiGitRevisionsFromPinnedLock({
      lockContents,
      environmentName
    })
  }

  if (format === "legacy") {
    return extractSuiGitRevisionsFromLegacyLock(lockContents)
  }

  return new Set<string>()
}

/**
 * Returns per-section details for pinned Move.lock files so callers can explain why
 * multiple Sui framework revisions appear (e.g. which environment and package pins each rev).
 */
export const extractSuiFrameworkPinnedEntriesFromMoveLock = ({
  lockContents,
  environmentName
}: {
  lockContents: string
  environmentName?: string
}): SuiFrameworkPinnedEntry[] => {
  const format = detectMoveLockFormat(lockContents)
  if (format !== "pinned") return []

  return extractSuiFrameworkPinnedEntriesFromPinnedLock({
    lockContents,
    environmentName
  })
}

export const extractSingleSuiFrameworkRevisionFromMoveLock = ({
  lockContents,
  environmentName
}: {
  lockContents: string
  environmentName?: string
}): string | undefined => {
  const revisions = extractSuiFrameworkRevisionsFromMoveLock({
    lockContents,
    environmentName
  })

  const [firstRevision] = [...revisions]
  return firstRevision
}
