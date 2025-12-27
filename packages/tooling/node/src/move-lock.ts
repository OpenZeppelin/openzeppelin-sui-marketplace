export const CORE_PUBLISHED_DEPENDENCIES = new Set([
  "bridge",
  "movestdlib",
  "sui",
  "suisystem"
])

export type MoveLockDependencyScope = {
  dependencies: Set<string>
  devDependencies: Set<string>
}

type PublishedAddressOptions = {
  includeDevDependencies?: boolean
  corePublishedDependencies?: Set<string>
}

type MoveLockSplit = {
  header: string
  packageBlocks: string[]
}

type MoveLockUpdateResult = {
  updatedContents: string
  updatedDependencies: string[]
}

export const normalizeDependencyId = (id: string) => id.trim().toLowerCase()

const splitMoveLock = (lockContents: string): MoveLockSplit => {
  const parts = lockContents.split(/\[\[move\.package\]\]/)
  const [header = "", ...packageBlocks] = parts
  return { header, packageBlocks }
}

const extractDependencyIdFromBlock = (block: string): string | undefined =>
  block.match(/id\s*=\s*"([^"]+)"/)?.[1]

const parseDependencyIdsFromSection = (block?: string) => {
  const ids = new Set<string>()
  if (!block) return ids

  for (const match of block.matchAll(/id\s*=\s*"([^"]+)"/g)) {
    ids.add(normalizeDependencyId(match[1]))
  }

  return ids
}

const isDependencyInScope = (
  dependencyId: string,
  allowedDependencyIds?: Set<string>
) =>
  !allowedDependencyIds ||
  allowedDependencyIds.has(normalizeDependencyId(dependencyId))

const isCorePublishedDependency = (
  dependencyId: string,
  corePublishedDependencies: Set<string>
) => corePublishedDependencies.has(normalizeDependencyId(dependencyId))

const hasPublishedAddressInBlock = (block: string) =>
  /published-at\s*=\s*"0x[0-9a-fA-F]+"/.test(block) ||
  /published-id\s*=\s*"0x[0-9a-fA-F]+"/.test(block)

const normalizeAddress = (address: string) => {
  const normalized = address.trim().toLowerCase()
  return normalized.startsWith("0x") ? normalized : `0x${normalized}`
}

const normalizeDependencyAddressMap = (
  dependencyAddresses: Record<string, string>
) =>
  Object.entries(dependencyAddresses).reduce((map, [dependencyId, address]) => {
    if (!dependencyId || !address) return map
    map.set(normalizeDependencyId(dependencyId), normalizeAddress(address))
    return map
  }, new Map<string, string>())

export const parseMoveLockDependencyScope = (
  lockContents: string
): MoveLockDependencyScope | undefined => {
  const moveSection = splitMoveLock(lockContents).header
  const dependenciesBlock = moveSection.match(
    /(?:^|\r?\n)\s*dependencies\s*=\s*\[([\s\S]*?)\]/
  )?.[1]
  const devDependenciesBlock = moveSection.match(
    /(?:^|\r?\n)\s*dev-dependencies\s*=\s*\[([\s\S]*?)\]/
  )?.[1]

  const dependencies = parseDependencyIdsFromSection(dependenciesBlock)
  const devDependencies = parseDependencyIdsFromSection(devDependenciesBlock)

  if (dependencies.size === 0 && devDependencies.size === 0) return undefined

  return { dependencies, devDependencies }
}

export const resolveAllowedDependencyIds = (
  lockContents: string,
  includeDevDependencies: boolean
): Set<string> | undefined => {
  const scope = parseMoveLockDependencyScope(lockContents)
  if (!scope) return undefined

  const allowed = new Set<string>(scope.dependencies)
  if (includeDevDependencies) {
    scope.devDependencies.forEach((id) => allowed.add(id))
  }

  return allowed.size > 0 ? allowed : undefined
}

export const parsePublishedAddressesFromLock = (
  lockContents: string,
  { includeDevDependencies = true }: PublishedAddressOptions = {}
): Record<string, string> => {
  const { packageBlocks } = splitMoveLock(lockContents)
  const addresses: Record<string, string> = {}
  const allowedDependencyIds = resolveAllowedDependencyIds(
    lockContents,
    includeDevDependencies
  )

  for (const block of packageBlocks) {
    const dependencyId = extractDependencyIdFromBlock(block)
    if (!dependencyId) continue
    if (!isDependencyInScope(dependencyId, allowedDependencyIds)) continue

    const publishedMatch =
      block.match(/published-at\s*=\s*"0x([0-9a-fA-F]+)"/) ||
      block.match(/published-id\s*=\s*"0x([0-9a-fA-F]+)"/)

    if (publishedMatch) {
      addresses[dependencyId] = `0x${publishedMatch[1].toLowerCase()}`
    }
  }

  return addresses
}

export const findUnpublishedDependenciesInLock = (
  lockContents: string,
  {
    includeDevDependencies = true,
    corePublishedDependencies = CORE_PUBLISHED_DEPENDENCIES
  }: PublishedAddressOptions = {}
): string[] => {
  const { packageBlocks } = splitMoveLock(lockContents)
  const allowedDependencyIds = resolveAllowedDependencyIds(
    lockContents,
    includeDevDependencies
  )

  const unpublishedDependencies: string[] = []

  for (const block of packageBlocks) {
    const dependencyId = extractDependencyIdFromBlock(block)
    if (!dependencyId) continue
    if (!isDependencyInScope(dependencyId, allowedDependencyIds)) continue
    if (isCorePublishedDependency(dependencyId, corePublishedDependencies))
      continue
    if (hasPublishedAddressInBlock(block)) continue

    unpublishedDependencies.push(dependencyId)
  }

  return unpublishedDependencies
}

export const updateMoveLockPublishedAddresses = (
  lockContents: string,
  dependencyAddresses: Record<string, string>
): MoveLockUpdateResult => {
  const { header, packageBlocks } = splitMoveLock(lockContents)
  const normalizedAddresses = normalizeDependencyAddressMap(dependencyAddresses)
  const updatedDependencies: string[] = []

  const updatedBlocks = packageBlocks.map((block) => {
    const dependencyId = extractDependencyIdFromBlock(block)
    if (!dependencyId) return block

    const normalizedDependencyId = normalizeDependencyId(dependencyId)
    const address = normalizedAddresses.get(normalizedDependencyId)
    if (!address) return block

    const publishedLineRegex =
      /^\s*published-(?:at|id)\s*=\s*"0x[0-9a-fA-F]+"\s*$/m
    const idLineRegex = /^(\s*)id\s*=\s*"[^"]+"\s*$/m
    const idLineMatch = block.match(idLineRegex)
    if (!idLineMatch) return block

    const indent = idLineMatch[1] ?? ""
    const publishedLine = `${indent}published-at = "${address}"`

    const updatedBlock = publishedLineRegex.test(block)
      ? block.replace(publishedLineRegex, publishedLine)
      : block.replace(idLineMatch[0], `${idLineMatch[0]}\n${publishedLine}`)

    if (updatedBlock !== block) {
      updatedDependencies.push(dependencyId)
    }

    return updatedBlock
  })

  const updatedContents = [header, ...updatedBlocks]
    .filter((section, index) => index === 0 || section.length > 0)
    .join("[[move.package]]")

  return {
    updatedContents,
    updatedDependencies
  }
}
