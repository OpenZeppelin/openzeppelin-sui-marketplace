import type { SuiClient } from "@mysten/sui/client"
import { isRecord } from "./utils/utility.ts"

type UnknownRecord = Record<string, unknown>
type StructSearchCriteria = {
  moduleName: string
  structName: string
}

const resolvePackageDisassembledModules = (
  content: unknown
): UnknownRecord | undefined => {
  if (!isRecord(content)) return undefined
  if (content.dataType !== "package") return undefined
  return isRecord(content.disassembled) ? content.disassembled : undefined
}

const hasModuleInDisassembledContent = (
  disassembledModules: UnknownRecord,
  moduleName: string
) => Object.hasOwn(disassembledModules, moduleName)

const fetchPackageContent = async (
  suiClient: SuiClient,
  packageId: string
): Promise<unknown> =>
  (
    await suiClient.getObject({
      id: packageId,
      options: { showContent: true }
    })
  ).data?.content

const resolveStructCandidate = (
  normalizedTypeRecord: UnknownRecord
): UnknownRecord | undefined =>
  isRecord(normalizedTypeRecord.Struct)
    ? normalizedTypeRecord.Struct
    : undefined

const resolveReferenceCandidate = (
  normalizedTypeRecord: UnknownRecord
): unknown =>
  normalizedTypeRecord.Reference ??
  normalizedTypeRecord.MutableReference ??
  normalizedTypeRecord.Vector

const resolveStructTypeArguments = (structRecord: UnknownRecord): unknown[] =>
  Array.isArray(structRecord.typeArguments) ? structRecord.typeArguments : []

const resolveMatchingStructAddress = (
  structRecord: UnknownRecord,
  criteria: StructSearchCriteria
): string | undefined => {
  if (
    structRecord.module === criteria.moduleName &&
    structRecord.name === criteria.structName &&
    typeof structRecord.address === "string"
  ) {
    return structRecord.address
  }

  return undefined
}

const findFirstDefined = <TValue, TResult>(
  values: TValue[],
  resolveValue: (value: TValue) => TResult | undefined
): TResult | undefined => {
  for (const value of values) {
    const resolvedValue = resolveValue(value)
    if (resolvedValue !== undefined) return resolvedValue
  }
  return undefined
}

const findStructAddressInNormalizedTypeWithCriteria = (
  normalizedType: unknown,
  criteria: StructSearchCriteria
): string | undefined => {
  if (!isRecord(normalizedType)) return undefined

  const structRecord = resolveStructCandidate(normalizedType)
  if (structRecord) {
    const matchingAddress = resolveMatchingStructAddress(structRecord, criteria)
    if (matchingAddress) return matchingAddress

    const nestedAddress = findFirstDefined(
      resolveStructTypeArguments(structRecord),
      (nestedTypeArgument) =>
        findStructAddressInNormalizedTypeWithCriteria(
          nestedTypeArgument,
          criteria
        )
    )
    if (nestedAddress) return nestedAddress
  }

  const referenceCandidate = resolveReferenceCandidate(normalizedType)
  if (referenceCandidate === undefined) return undefined

  return findStructAddressInNormalizedTypeWithCriteria(
    referenceCandidate,
    criteria
  )
}

export const hasMoveModule = (
  content: unknown,
  moduleName: string
): content is {
  dataType: "package"
  disassembled: Record<string, unknown>
} => {
  const disassembledModules = resolvePackageDisassembledModules(content)
  if (!disassembledModules) return false
  return hasModuleInDisassembledContent(disassembledModules, moduleName)
}

export const findDependencyPackageIdByModuleName = async ({
  suiClient,
  dependencyPackageIds,
  moduleName
}: {
  suiClient: SuiClient
  dependencyPackageIds: string[]
  moduleName: string
}): Promise<string | undefined> => {
  for (const dependencyPackageId of dependencyPackageIds) {
    const dependencyPackageContent = await fetchPackageContent(
      suiClient,
      dependencyPackageId
    )
    if (hasMoveModule(dependencyPackageContent, moduleName))
      return dependencyPackageId
  }
  return undefined
}

export const findStructAddressInNormalizedType = ({
  normalizedType,
  moduleName,
  structName
}: {
  normalizedType: unknown
  moduleName: string
  structName: string
}): string | undefined =>
  findStructAddressInNormalizedTypeWithCriteria(normalizedType, {
    moduleName,
    structName
  })

export const findStructAddressInNormalizedTypes = ({
  normalizedTypes,
  moduleName,
  structName
}: {
  normalizedTypes: unknown[]
  moduleName: string
  structName: string
}): string | undefined =>
  findFirstDefined(normalizedTypes, (normalizedType) =>
    findStructAddressInNormalizedTypeWithCriteria(normalizedType, {
      moduleName,
      structName
    })
  )
