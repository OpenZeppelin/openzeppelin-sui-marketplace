import {
  type SuiClient,
  type SuiObjectChangeCreated,
  type SuiObjectData,
  type SuiTransactionBlockResponse
} from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getObjectIdFromDynamicFieldObject,
  isDynamicFieldObject
} from "@sui-oracle-market/tooling-core/dynamic-fields"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import {
  deriveRelevantPackageId,
  getSuiObject,
  mapOwnerToArtifact,
  normalizeIdOrThrow,
  normalizeVersion
} from "@sui-oracle-market/tooling-core/object"
import { extractInitialSharedVersion } from "@sui-oracle-market/tooling-core/shared-object"
import {
  assertCreatedObject,
  assertTransactionSuccess,
  ensureCreatedObject,
  findCreatedByType,
  findCreatedObjectBySuffix,
  findCreatedObjectIds,
  findObjectMatching,
  newTransaction
} from "@sui-oracle-market/tooling-core/transactions"
import {
  getObjectArtifactPath,
  loadObjectArtifacts,
  rewriteUpdatedArtifacts,
  writeObjectArtifact
} from "./artifacts.ts"

import type { ToolingContext } from "./factory.ts"

type ExecuteParams = {
  transaction: Transaction
  signer: Ed25519Keypair
  requestType?: "WaitForEffectsCert" | "WaitForLocalExecution"
  retryOnGasStale?: boolean
  assertSuccess?: boolean
}

export {
  assertCreatedObject,
  assertTransactionSuccess,
  ensureCreatedObject,
  findCreatedByType,
  findCreatedObjectBySuffix,
  findCreatedObjectIds,
  findObjectMatching,
  newTransaction
}

export const findCreatedArtifactBySuffix = (
  createdArtifacts: ObjectArtifact[] | undefined,
  suffix: string
) => createdArtifacts?.find((artifact) => artifact.objectType?.endsWith(suffix))

export const findCreatedArtifactIdBySuffix = (
  createdArtifacts: ObjectArtifact[] | undefined,
  suffix: string
) => findCreatedArtifactBySuffix(createdArtifacts, suffix)?.objectId

export const requireCreatedArtifactIdBySuffix = ({
  createdArtifacts,
  suffix,
  label
}: {
  createdArtifacts: ObjectArtifact[] | undefined
  suffix: string
  label: string
}) =>
  normalizeIdOrThrow(
    findCreatedArtifactIdBySuffix(createdArtifacts, suffix),
    `Expected ${label} to be created, but it was not found in transaction artifacts.`
  )

type GasPaymentOptions = {
  transaction: Transaction
  signerAddress: string
  suiClient: SuiClient
  forceUpdate?: boolean
  excludedObjectIds?: Set<string>
}

/**
 * Checks whether a transaction already has gas payment objects attached.
 */
const hasExistingGasPayment = (transaction: Transaction) => {
  const payment = transaction.getData().gasData.payment
  return Array.isArray(payment) && payment.length > 0
}

/**
 * Ensures a fresh gas coin object is selected for the transaction.
 * Sui gas is paid with coin objects (each with a version), unlike EVM balances.
 */
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
  requestType: ExecuteParams["requestType"]
  assertSuccess: boolean
}

/**
 * Executes a signed transaction once and persists object artifacts if it succeeds.
 */
export const executeTransactionOnce = async (
  { transaction, signer, requestType, assertSuccess }: ExecuteOnceArgs,
  toolingContext: ToolingContext
) => {
  const transactionResult =
    await toolingContext.suiClient.signAndExecuteTransaction({
      transaction,
      signer,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true
      }
    })

  if (requestType === "WaitForLocalExecution") {
    try {
      await toolingContext.suiClient.waitForTransaction({
        digest: transactionResult.digest
      })
    } catch {
      // Best-effort to mirror old requestType behavior.
    }
  }

  if (assertSuccess) assertTransactionSuccess(transactionResult)

  const objectArtifacts = await persistObjectsIfAny({
    transactionResult,
    suiClient: toolingContext.suiClient,
    signerAddress: signer.toSuiAddress(),
    networkName: toolingContext.suiConfig.network.networkName
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

/**
 * Determines whether a retry is warranted based on gas-related error messages.
 */
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

/**
 * Normalizes unknown thrown values to Error instances for consistent handling.
 */
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
    assertSuccess = true
  }: ExecuteParams,
  toolingContext: ToolingContext
): Promise<{
  transactionResult: SuiTransactionBlockResponse
  objectArtifacts: PersistedObjectArtifacts
}> => {
  const signerAddress = signer.toSuiAddress()
  const maximumAttempts = retryOnGasStale ? 2 : 1

  // Pre-populate gas with the freshest coin to avoid stale object errors on the first attempt.
  await ensureGasPayment({
    transaction,
    signerAddress,
    suiClient: toolingContext.suiClient
  })

  for (let attemptIndex = 0; attemptIndex < maximumAttempts; attemptIndex++) {
    try {
      return await executeTransactionOnce(
        {
          transaction,
          signer,
          requestType,
          assertSuccess
        },
        toolingContext
      )
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
        suiClient: toolingContext.suiClient,
        forceUpdate: true,
        excludedObjectIds: lockedObjectIds
      })
    }
  }

  throw new Error("Unable to execute transaction after retries.")
}

export type CreatedObjectSummary = {
  objectId: string
  objectType: string
  owner?: SuiObjectChangeCreated["owner"]
  initialSharedVersion?: number | string
}

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

/**
 * Returns true when the transaction effects indicate success.
 */
const didTransactionSucceed = (
  transactionResult: SuiTransactionBlockResponse
) => transactionResult.effects?.status?.status === "success"

/**
 * Persists object artifacts derived from transaction object changes.
 * This captures created, mutated, deleted, wrapped, and transferred objects.
 */
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

/**
 * Builds and writes artifacts for created objects.
 */
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

  const createdObjectsWithData = await getCreatedObjectsWithData(
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

/**
 * Chooses the correct ID to index artifacts, handling dynamic field objects.
 */
const deriveArtifactObjectId = (artifact: ObjectArtifact) =>
  isDynamicFieldObject(artifact.objectType)
    ? normalizeObjectIdSafe(artifact.dynamicFieldId ?? artifact.objectId)
    : normalizeObjectIdSafe(artifact.objectId)

/**
 * Indexes object changes by normalized object ID.
 */
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

/**
 * Extracts the owner field from mutation/transfer changes.
 */
const mapOwnerFromObjectChange = (change: ObjectChangeWithOwner) =>
  "recipient" in change ? change.recipient : change.owner

/**
 * Applies owner/version updates to existing artifacts based on object changes.
 */
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

/**
 * Writes updated object artifacts for mutated or transferred objects.
 */
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

/**
 * Groups object changes by type for easier processing.
 */
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

/**
 * Normalizes a candidate object ID, returning undefined if invalid.
 */
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

/**
 * Builds a set of normalized object IDs for quick lookup.
 */
const buildNormalizedObjectIdSet = (
  changes: ObjectChangeWithObjectId[]
): Set<string> =>
  changes.reduce<Set<string>>((objectIds, change) => {
    const normalizedObjectId = normalizeObjectIdSafe(change.objectId)
    if (normalizedObjectId) objectIds.add(normalizedObjectId)
    return objectIds
  }, new Set())

/**
 * Determines whether a timestamp field should be set on a given artifact.
 */
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

/**
 * Applies timestamp fields to matching artifacts and returns updated entries.
 */
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

/**
 * Marks artifacts with deletion/wrapping timestamps based on object changes.
 */
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

/**
 * Marks artifacts as deleted when objects are deleted.
 */
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

/**
 * Marks artifacts as wrapped when objects are wrapped.
 */
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

/**
 * Fetches full object data for each created object change.
 */
const getCreatedObjectsWithData = async (
  createdChanges: SuiObjectChangeCreated[],
  suiClient: SuiClient
): Promise<CreatedObjectWithData[]> =>
  Promise.all(
    createdChanges.map(async (change) => {
      const { object } = await getSuiObject(
        {
          objectId: change.objectId
        },
        { suiClient }
      )

      return {
        change,
        object
      }
    })
  )

/**
 * Converts created objects into artifact records for persistence.
 */
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

/**
 * Builds a single object artifact from a created object change + fetched data.
 */
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

/**
 * Picks a fresh SUI gas coin, avoiding locked or stale object IDs.
 */
const pickFreshGasCoin = async (
  owner: string,
  client: SuiClient,
  excludeObjectIds: Set<string> = new Set()
) => {
  let cursor: string | null | undefined = undefined

  do {
    const page = await client.getCoins({
      owner,
      coinType: "0x2::sui::SUI",
      limit: 50,
      cursor
    })

    const latestCoin = page.data?.find(
      (coin) => !excludeObjectIds.has(coin.coinObjectId.toLowerCase())
    )

    if (latestCoin) {
      return {
        objectId: latestCoin.coinObjectId,
        version: latestCoin.version,
        digest: latestCoin.digest
      }
    }

    cursor = page.hasNextPage ? page.nextCursor : undefined
  } while (cursor)

  throw new Error(
    "No usable SUI coins available for gas; fund the account or request faucet."
  )
}

/**
 * Attempts to parse a stale object ID from an error message.
 */
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

/**
 * Extracts locked object IDs from an error message.
 */
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
