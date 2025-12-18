import type { SuiObjectChange } from "@mysten/sui/client"
import {
  type SuiClient,
  type SuiObjectChangeCreated,
  type SuiObjectData,
  type SuiTransactionBlockResponse
} from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getObjectArtifactPath,
  loadObjectArtifacts,
  rewriteUpdatedArtifacts,
  writeObjectArtifact
} from "./artifacts.ts"
import type { ObjectArtifact } from "./object.ts"
import {
  deriveRelevantPackageId,
  getSuiObject,
  mapOwnerToArtifact,
  normalizeVersion
} from "./object.ts"
import {
  getObjectIdFromDynamicFieldObject,
  isDynamicFieldObject
} from "./dynamic-fields.ts"
import { extractInitialSharedVersion } from "./shared-object.ts"

type ExecuteParams = {
  transaction: Transaction
  signer: Ed25519Keypair
  requestType?: "WaitForEffectsCert" | "WaitForLocalExecution"
  retryOnGasStale?: boolean
  assertSuccess?: boolean
  networkName: string
}

/**
 * Creates a Transaction and optionally seeds a gas budget.
 * Why: Sui PTBs are built client-side; setting gas early mirrors how wallets prepare PTBs.
 */
export const newTransaction = (gasBudget?: number) => {
  const tx = new Transaction()
  if (gasBudget) tx.setGasBudget(gasBudget)
  return tx
}

/**
 * Throws if a transaction block did not succeed.
 * Mirrors EVM receipt status checks to keep scripts predictable.
 */
export const assertTransactionSuccess = ({
  effects
}: SuiTransactionBlockResponse) => {
  if (effects?.status?.status !== "success")
    throw new Error(effects?.status?.error || "Transaction failed")
}

type GasPaymentOptions = {
  transaction: Transaction
  signerAddress: string
  suiClient: SuiClient
  forceUpdate?: boolean
  excludedObjectIds?: Set<string>
}

const hasExistingGasPayment = (transaction: Transaction) => {
  const payment = transaction.getData().gasData.payment
  return Array.isArray(payment) && payment.length > 0
}

const ensureGasPayment = async ({
  transaction,
  signerAddress,
  suiClient,
  forceUpdate = false,
  excludedObjectIds = new Set()
}: GasPaymentOptions) => {
  if (!forceUpdate && hasExistingGasPayment(transaction)) return

  const gasCoin = await pickFreshGasCoin(
    signerAddress,
    suiClient,
    excludedObjectIds
  )
  transaction.setGasOwner(signerAddress)
  transaction.setGasPayment([gasCoin])
}

type ExecuteOnceArgs = {
  transaction: Transaction
  signer: Ed25519Keypair
  suiClient: SuiClient
  requestType: ExecuteParams["requestType"]
  assertSuccess: boolean
  networkName: string
}

export const executeTransactionOnce = async ({
  transaction,
  signer,
  suiClient,
  requestType,
  assertSuccess,
  networkName
}: ExecuteOnceArgs) => {
  const transactionResult = await suiClient.signAndExecuteTransaction({
    transaction,
    signer,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true
    },
    requestType
  })

  if (assertSuccess) assertTransactionSuccess(transactionResult)

  const objectArtifacts = await persistObjectsIfAny({
    transactionResult,
    suiClient,
    signerAddress: signer.toSuiAddress(),
    networkName
  })

  return {
    transactionResult,
    objectArtifacts
  }
}

type RetryDecision = {
  shouldRetry: boolean
  lockedObjectIds: Set<string>
}

const decideRetryForGasIssues = (
  error: unknown,
  allowRetryOnGasStale: boolean,
  attemptIndex: number
): RetryDecision => {
  if (!allowRetryOnGasStale || attemptIndex > 0)
    return { shouldRetry: false, lockedObjectIds: new Set() }

  const staleObjectId = parseStaleObjectId(error)
  const lockedObjectIds = parseLockedObjectIds(error)
  const encounteredGasIssue = Boolean(staleObjectId) || lockedObjectIds.size > 0

  return {
    shouldRetry: encounteredGasIssue,
    lockedObjectIds
  }
}

const normalizeUnknownError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error))

/**
 * Signs and executes a transaction, retrying once on stale/locked gas objects.
 * Why: Gas coins are objects with versions; this helper refreshes gas to align with Sui’s
 * object model, similar to replacing a nonce-bumped tx in EVM when a coin is outdated.
 */
export const signAndExecute = async (
  {
    transaction,
    signer,
    requestType = "WaitForLocalExecution",
    retryOnGasStale = true,
    assertSuccess = true,
    networkName
  }: ExecuteParams,
  suiClient: SuiClient
): Promise<{
  transactionResult: SuiTransactionBlockResponse
  objectArtifacts: PersistedObjectArtifacts
}> => {
  const signerAddress = signer.toSuiAddress()
  const maximumAttempts = retryOnGasStale ? 2 : 1

  // Pre-populate gas with the freshest coin to avoid stale object errors on the first attempt.
  await ensureGasPayment({ transaction, signerAddress, suiClient })

  for (let attemptIndex = 0; attemptIndex < maximumAttempts; attemptIndex++) {
    try {
      return await executeTransactionOnce({
        transaction,
        signer,
        suiClient,
        requestType,
        assertSuccess,
        networkName
      })
    } catch (error) {
      const { shouldRetry, lockedObjectIds } = decideRetryForGasIssues(
        error,
        retryOnGasStale,
        attemptIndex
      )

      if (!shouldRetry) throw normalizeUnknownError(error)

      // Refresh gas with the latest version in case the stale object is a SUI coin.
      await ensureGasPayment({
        transaction,
        signerAddress,
        suiClient,
        forceUpdate: true,
        excludedObjectIds: lockedObjectIds
      })
    }
  }

  throw new Error("Unable to execute transaction after retries.")
}

type ObjectChangeWithType = Extract<
  NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number],
  { type: "created" }
> & { objectType: string; objectId: string }

const isCreatedWithType = (
  change: NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number]
): change is ObjectChangeWithType =>
  change.type === "created" &&
  "objectType" in change &&
  typeof change.objectType === "string" &&
  "objectId" in change &&
  typeof change.objectId === "string"

const findCreatedByMatcher = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] =>
  (result.objectChanges ?? [])
    .filter(isCreatedWithType)
    .filter((change) => matcher(change.objectType))
    .map((change) => change.objectId)

export const findCreatedObjectIds = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): string[] =>
  findCreatedByMatcher(result, (objectType) => objectType.endsWith(typeSuffix))

export const findCreatedByType = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] => findCreatedByMatcher(result, matcher)

export type CreatedObjectSummary = {
  objectId: string
  objectType: string
  owner?: SuiObjectChangeCreated["owner"]
  initialSharedVersion?: number | string
}

/**
 * Returns the first created object whose type matches the provided predicate, preserving owner metadata.
 */
export const findObjectMatching = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): SuiObjectChange | undefined =>
  (result.objectChanges ?? []).find(
    (change) => isCreatedWithType(change) && matcher(change.objectType)
  )

export const assertCreatedObject = (
  objectChange: SuiObjectChange | undefined,
  objectToFind: string
): SuiObjectChangeCreated => {
  if (!objectChange || objectChange.type !== "created")
    throw new Error(
      `Transaction succeeded but ${objectToFind} was not found in object changes.`
    )

  return objectChange as SuiObjectChangeCreated
}

/**
 * Convenience wrapper for `findCreatedObject` that matches on a type suffix.
 */
export const findCreatedObjectBySuffix = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): SuiObjectChange | undefined =>
  findObjectMatching(result, (objectType) => objectType.endsWith(typeSuffix))

export const ensureCreatedObject = (
  objectToFind: string,
  transactionResult: Awaited<
    ReturnType<typeof signAndExecute>
  >["transactionResult"]
): SuiObjectChangeCreated =>
  assertCreatedObject(
    findCreatedObjectBySuffix(transactionResult, objectToFind),
    objectToFind
  )

type ObjectChangeDeleted = Extract<
  NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number],
  { type: "deleted" }
>
type ObjectChangeMutated = Extract<
  NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number],
  { type: "mutated" }
>
type ObjectChangeWrapped = Extract<
  NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number],
  { type: "wrapped" }
>
type ObjectChangeTransferred = Extract<
  NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number],
  { type: "transferred" }
>

type ObjectChangesByType = {
  created: SuiObjectChangeCreated[]
  deleted: ObjectChangeDeleted[]
  mutated: ObjectChangeMutated[]
  wrapped: ObjectChangeWrapped[]
  transferred: ObjectChangeTransferred[]
}

type CreatedObjectWithData = {
  change: SuiObjectChangeCreated
  object: SuiObjectData
}

type PersistedObjectArtifacts = {
  created: ObjectArtifact[]
  deleted: ObjectArtifact[]
  updated: ObjectArtifact[]
  wrapped: ObjectArtifact[]
}

const EMPTY_OBJECT_ARTIFACTS: PersistedObjectArtifacts = {
  created: [],
  deleted: [],
  updated: [],
  wrapped: []
}

const didTransactionSucceed = (
  transactionResult: SuiTransactionBlockResponse
) => transactionResult.effects?.status?.status === "success"

const persistObjectsIfAny = async ({
  transactionResult,
  suiClient,
  signerAddress,
  networkName
}: {
  transactionResult: SuiTransactionBlockResponse
  suiClient: SuiClient
  signerAddress: string
  networkName: string
}): Promise<PersistedObjectArtifacts> => {
  if (!didTransactionSucceed(transactionResult)) return EMPTY_OBJECT_ARTIFACTS

  const { created, deleted, mutated, transferred, wrapped } =
    groupObjectChanges(transactionResult.objectChanges)

  const objectCreatedArtifacts = await persistCreatedArtifacts(
    {
      createdChanges: created,
      signerAddress,
      networkName
    },
    suiClient
  )

  const updatedArtifacts = await persistUpdatedArtifacts({
    updatedChanges: [...mutated, ...transferred],
    networkName
  })

  const deletedArtifacts = await persistDeletedArtifacts({
    deletedChanges: deleted,
    networkName
  })

  const wrappedArtifacts = await persistWrappedArtifacts({
    wrappedChanges: wrapped,
    networkName
  })

  return {
    created: objectCreatedArtifacts,
    deleted: deletedArtifacts,
    updated: updatedArtifacts,
    wrapped: wrappedArtifacts
  }
}

const persistCreatedArtifacts = async (
  {
    createdChanges,
    signerAddress,
    networkName
  }: {
    createdChanges: SuiObjectChangeCreated[]
    signerAddress: string
    networkName: string
  },
  suiClient: SuiClient
): Promise<ObjectArtifact[]> => {
  if (!createdChanges.length) return []

  const createdObjectsWithData = await fetchCreatedObjectsWithData(
    createdChanges,
    suiClient
  )

  const objectCreatedArtifacts = buildArtifactsForCreatedObjects({
    createdObjectsWithData,
    signerAddress
  })

  if (objectCreatedArtifacts.length)
    await writeObjectArtifact(
      getObjectArtifactPath(networkName),
      objectCreatedArtifacts
    )

  return objectCreatedArtifacts
}

const deriveArtifactObjectId = (artifact: ObjectArtifact) =>
  isDynamicFieldObject(artifact.objectType)
    ? normalizeObjectIdSafe(artifact.dynamicFieldId ?? artifact.objectId)
    : normalizeObjectIdSafe(artifact.objectId)

const indexUpdatesByObjectId = (
  updatedChanges: ObjectChangeWithOwner[]
): Map<string, ObjectChangeWithOwner> =>
  updatedChanges.reduce<Map<string, ObjectChangeWithOwner>>(
    (accumulator, change) => {
      const normalizedId = normalizeObjectIdSafe(change.objectId)
      if (normalizedId) accumulator.set(normalizedId, change)
      return accumulator
    },
    new Map()
  )

type ObjectChangeWithOwner = ObjectChangeMutated | ObjectChangeTransferred
type ObjectChangeWithObjectId =
  | ObjectChangeWithOwner
  | ObjectChangeDeleted
  | ObjectChangeWrapped
type TimestampField = "deletedAt" | "wrappedAt"

const mapOwnerFromObjectChange = (change: ObjectChangeWithOwner) =>
  "recipient" in change ? change.recipient : change.owner

const applyUpdatesToArtifacts = ({
  currentObjectArtifacts,
  updatesById
}: {
  currentObjectArtifacts: ObjectArtifact[]
  updatesById: Map<string, ObjectChangeWithOwner>
}) => {
  const updatedArtifacts: ObjectArtifact[] = []

  const nextArtifacts = currentObjectArtifacts.map((artifact) => {
    const artifactObjectId = deriveArtifactObjectId(artifact)
    if (!artifactObjectId) return artifact

    const matchingChange = updatesById.get(artifactObjectId)
    if (!matchingChange) return artifact

    const updatedArtifact: ObjectArtifact = {
      ...artifact,
      owner: mapOwnerToArtifact(mapOwnerFromObjectChange(matchingChange)),
      version: normalizeVersion(matchingChange.version),
      digest: matchingChange.digest
    }

    updatedArtifacts.push(updatedArtifact)
    return updatedArtifact
  })

  return { updatedArtifacts, nextArtifacts }
}

const persistUpdatedArtifacts = async ({
  updatedChanges,
  networkName
}: {
  updatedChanges: ObjectChangeWithOwner[]
  networkName: string
}): Promise<ObjectArtifact[]> => {
  if (!updatedChanges.length) return []

  const updatesById = indexUpdatesByObjectId(updatedChanges)

  if (!updatesById.size) return []

  const currentObjectArtifacts = await loadObjectArtifacts(networkName)

  const { updatedArtifacts, nextArtifacts } = applyUpdatesToArtifacts({
    currentObjectArtifacts,
    updatesById
  })

  if (!updatedArtifacts.length) return []

  await rewriteUpdatedArtifacts({
    objectArtifacts: nextArtifacts,
    networkName
  })

  return updatedArtifacts
}

const groupObjectChanges = (
  objectChanges: SuiTransactionBlockResponse["objectChanges"]
): ObjectChangesByType => ({
  created: (objectChanges || []).filter(
    (change): change is SuiObjectChangeCreated => change.type === "created"
  ),
  deleted: (objectChanges || []).filter(
    (change): change is ObjectChangeDeleted => change.type === "deleted"
  ),
  mutated: (objectChanges || []).filter(
    (change): change is ObjectChangeMutated => change.type === "mutated"
  ),
  wrapped: (objectChanges || []).filter(
    (change): change is ObjectChangeWrapped => change.type === "wrapped"
  ),
  transferred: (objectChanges || []).filter(
    (change): change is ObjectChangeTransferred => change.type === "transferred"
  )
})

const normalizeObjectIdSafe = (
  candidate?: string | null
): string | undefined =>
  candidate
    ? (() => {
        try {
          return normalizeSuiObjectId(candidate)
        } catch {
          return undefined
        }
      })()
    : undefined

const buildNormalizedObjectIdSet = (
  changes: ObjectChangeWithObjectId[]
): Set<string> =>
  changes.reduce<Set<string>>((objectIds, change) => {
    const normalizedObjectId = normalizeObjectIdSafe(change.objectId)
    if (normalizedObjectId) objectIds.add(normalizedObjectId)
    return objectIds
  }, new Set())

const shouldApplyTimestamp = ({
  artifact,
  targetObjectIds,
  predicate
}: {
  artifact: ObjectArtifact
  targetObjectIds: Set<string>
  predicate: (artifact: ObjectArtifact) => boolean
}): boolean => {
  const artifactObjectId = deriveArtifactObjectId(artifact)
  return Boolean(
    artifactObjectId &&
    targetObjectIds.has(artifactObjectId) &&
    predicate(artifact)
  )
}

const markArtifactsWithTimestamp = ({
  objectArtifacts,
  targetObjectIds,
  timestampField,
  timestampValue,
  predicate
}: {
  objectArtifacts: ObjectArtifact[]
  targetObjectIds: Set<string>
  timestampField: TimestampField
  timestampValue: string
  predicate: (artifact: ObjectArtifact) => boolean
}) => {
  const affectedArtifacts: ObjectArtifact[] = []

  const nextArtifacts = objectArtifacts.map((artifact) => {
    if (
      shouldApplyTimestamp({
        artifact,
        targetObjectIds,
        predicate
      })
    ) {
      const updatedArtifact = {
        ...artifact,
        [timestampField]: timestampValue
      } as ObjectArtifact

      affectedArtifacts.push(updatedArtifact)
      return updatedArtifact
    }

    return artifact
  })

  return { affectedArtifacts, nextArtifacts }
}

const timestampArtifactsForObjectChanges = async ({
  changes,
  networkName,
  timestampField,
  shouldTimestampArtifact
}: {
  changes: ObjectChangeWithObjectId[]
  networkName: string
  timestampField: TimestampField
  shouldTimestampArtifact: (artifact: ObjectArtifact) => boolean
}): Promise<ObjectArtifact[]> => {
  if (!changes.length) return []

  const targetObjectIds = buildNormalizedObjectIdSet(changes)
  if (!targetObjectIds.size) return []

  const currentObjectArtifacts = await loadObjectArtifacts(networkName)
  const timestampValue = new Date().toISOString()

  const { affectedArtifacts, nextArtifacts } = markArtifactsWithTimestamp({
    objectArtifacts: currentObjectArtifacts,
    targetObjectIds,
    timestampField,
    timestampValue,
    predicate: shouldTimestampArtifact
  })

  if (!affectedArtifacts.length) return []

  await rewriteUpdatedArtifacts({
    objectArtifacts: nextArtifacts,
    networkName
  })

  return affectedArtifacts
}

const persistDeletedArtifacts = async ({
  deletedChanges,
  networkName
}: {
  deletedChanges: ObjectChangeDeleted[]
  networkName: string
}): Promise<ObjectArtifact[]> =>
  timestampArtifactsForObjectChanges({
    changes: deletedChanges,
    networkName,
    timestampField: "deletedAt",
    shouldTimestampArtifact: () => true
  })

const persistWrappedArtifacts = async ({
  wrappedChanges,
  networkName
}: {
  wrappedChanges: ObjectChangeWrapped[]
  networkName: string
}): Promise<ObjectArtifact[]> =>
  timestampArtifactsForObjectChanges({
    changes: wrappedChanges,
    networkName,
    timestampField: "wrappedAt",
    shouldTimestampArtifact: (artifact) => !artifact.wrappedAt
  })

const fetchCreatedObjectsWithData = async (
  createdChanges: SuiObjectChangeCreated[],
  suiClient: SuiClient
): Promise<CreatedObjectWithData[]> =>
  Promise.all(
    createdChanges.map(async (change) => {
      const { object } = await getSuiObject(
        {
          objectId: change.objectId
        },
        suiClient
      )

      return {
        change,
        object
      }
    })
  )

const buildArtifactsForCreatedObjects = ({
  createdObjectsWithData,
  signerAddress
}: {
  createdObjectsWithData: CreatedObjectWithData[]
  signerAddress: string
}): ObjectArtifact[] => {
  const objectArtifacts: ObjectArtifact[] = []

  for (const createdObject of createdObjectsWithData) {
    const artifact = buildObjectArtifactFromCreatedObject({
      createdObject,
      signerAddress
    })

    if (artifact) objectArtifacts.push(artifact)
  }

  return objectArtifacts
}

const buildObjectArtifactFromCreatedObject = ({
  createdObject,
  signerAddress
}: {
  createdObject: CreatedObjectWithData
  signerAddress: string
}): ObjectArtifact | undefined => {
  const objectType =
    createdObject.object.type || createdObject.change.objectType || ""
  const packageId = deriveRelevantPackageId(objectType)

  const objectId =
    (isDynamicFieldObject(createdObject.object.type || undefined)
      ? getObjectIdFromDynamicFieldObject(createdObject.object)
      : createdObject.object.objectId) || createdObject.object.objectId

  const initialSharedVersion =
    extractInitialSharedVersion(createdObject.object) ??
    normalizeVersion(createdObject.change.version)

  return {
    packageId,
    signer: signerAddress,
    objectId: normalizeSuiObjectId(objectId),
    objectType,
    owner: mapOwnerToArtifact(createdObject.object.owner || undefined),
    dynamicFieldId: isDynamicFieldObject(createdObject.object.type || undefined)
      ? normalizeSuiObjectId(createdObject.object.objectId)
      : undefined,
    initialSharedVersion,
    version: normalizeVersion(createdObject.object.version),
    digest: createdObject.change.digest
  }
}

const pickFreshGasCoin = async (
  owner: string,
  client: SuiClient,
  excludeObjectIds: Set<string> = new Set()
) => {
  const coins = await client.getCoins({
    owner,
    coinType: "0x2::sui::SUI",
    limit: 10
  })

  const latestCoin = coins.data?.find(
    (coin) => !excludeObjectIds.has(coin.coinObjectId.toLowerCase())
  )

  if (!latestCoin) {
    if (excludeObjectIds.size > 0 && (coins.data?.length ?? 0) > 0)
      throw new Error(
        "No usable SUI coins available for gas; fund the account or request faucet."
      )

    throw new Error(
      "No usable SUI coins available for gas; fund the account or request faucet."
    )
  }

  return {
    objectId: latestCoin.coinObjectId,
    version: latestCoin.version,
    digest: latestCoin.digest
  }
}

const parseStaleObjectId = (error: unknown): string | undefined => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  const match = message.match(/Object ID (\S+)/)
  return match?.[1]
}

const parseLockedObjectIds = (error: unknown): Set<string> => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""

  const lockedIds = new Set<string>()
  for (const line of message.split("\n")) {
    const match = line.match(/0x[0-9a-fA-F]+/)
    if (match) lockedIds.add(match[0].toLowerCase())
  }
  return lockedIds
}
