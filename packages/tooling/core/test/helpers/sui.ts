import type {
  GasCostSummary,
  ObjectResponseError,
  OwnedObjectRef,
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectChangeDeleted,
  SuiObjectChangeMutated,
  SuiObjectChangeTransferred,
  SuiObjectChangeWrapped,
  SuiObjectData,
  SuiObjectRef,
  SuiObjectResponse,
  SuiTransactionBlockResponse,
  TransactionEffects
} from "@mysten/sui/client"
import { vi } from "vitest"

type SuiClientMocks = {
  getCoins: ReturnType<typeof vi.fn>
  getBalance: ReturnType<typeof vi.fn>
  getAllBalances: ReturnType<typeof vi.fn>
  getObject: ReturnType<typeof vi.fn>
  getOwnedObjects: ReturnType<typeof vi.fn>
  getDynamicFields: ReturnType<typeof vi.fn>
  getDynamicFieldObject: ReturnType<typeof vi.fn>
  multiGetObjects: ReturnType<typeof vi.fn>
  signAndExecuteTransaction: ReturnType<typeof vi.fn>
  waitForTransaction: ReturnType<typeof vi.fn>
  getLatestSuiSystemState: ReturnType<typeof vi.fn>
  getLatestCheckpointSequenceNumber: ReturnType<typeof vi.fn>
  getReferenceGasPrice: ReturnType<typeof vi.fn>
  getChainIdentifier: ReturnType<typeof vi.fn>
}

type TransactionResponseOverrides = Omit<
  Partial<SuiTransactionBlockResponse>,
  "effects"
> & {
  effects?: Partial<TransactionEffects> | null
}

export const createSuiClientMock = (
  overrides: Partial<SuiClientMocks> = {}
) => {
  const mocks: SuiClientMocks = {
    getCoins: vi.fn().mockResolvedValue({
      data: [],
      hasNextPage: false,
      nextCursor: null
    }),
    getBalance: vi.fn().mockResolvedValue({
      coinType: "0x2::sui::SUI",
      coinObjectCount: 0,
      totalBalance: "0",
      lockedBalance: {}
    }),
    getAllBalances: vi.fn().mockResolvedValue([]),
    getObject: vi.fn().mockResolvedValue({ data: undefined, error: undefined }),
    getOwnedObjects: vi.fn().mockResolvedValue({
      data: [],
      hasNextPage: false,
      nextCursor: null
    }),
    getDynamicFields: vi.fn().mockResolvedValue({
      data: [],
      hasNextPage: false,
      nextCursor: null
    }),
    getDynamicFieldObject: vi
      .fn()
      .mockResolvedValue({ data: undefined, error: undefined }),
    multiGetObjects: vi.fn().mockResolvedValue([]),
    signAndExecuteTransaction: vi.fn().mockResolvedValue({
      effects: buildTransactionEffects()
    }),
    waitForTransaction: vi.fn().mockResolvedValue({
      digest: "digest",
      effects: buildTransactionEffects()
    }),
    getLatestSuiSystemState: vi.fn().mockResolvedValue({
      epoch: "0",
      protocolVersion: "0",
      activeValidators: [],
      epochStartTimestampMs: null
    }),
    getLatestCheckpointSequenceNumber: vi.fn().mockResolvedValue("0"),
    getReferenceGasPrice: vi.fn().mockResolvedValue(0n),
    getChainIdentifier: vi.fn().mockResolvedValue("0x0")
  }

  Object.assign(mocks, overrides)

  return {
    client: mocks as unknown as SuiClient,
    mocks
  }
}

export const buildSuiObjectData = (
  overrides: Partial<SuiObjectData> = {}
): SuiObjectData => ({
  objectId: "0x1",
  version: "1",
  digest: "digest",
  type: "0x2::sui::SUI",
  ...overrides
})

export const buildSuiObjectResponse = ({
  data,
  error
}: {
  data?: Partial<SuiObjectData>
  error?: ObjectResponseError
} = {}): SuiObjectResponse => ({
  data: data ? buildSuiObjectData(data) : undefined,
  error
})

export const buildObjectRef = (
  overrides: Partial<SuiObjectRef> = {}
): SuiObjectRef => ({
  digest: "digest",
  objectId: "0x1",
  version: "1",
  ...overrides
})

export const buildOwnedObjectRef = (
  overrides: Partial<OwnedObjectRef> = {}
): OwnedObjectRef => ({
  owner: { AddressOwner: "0x1" },
  reference: buildObjectRef(),
  ...overrides
})

export const buildGasCostSummary = (
  overrides: Partial<GasCostSummary> = {}
): GasCostSummary => ({
  computationCost: "0",
  storageCost: "0",
  storageRebate: "0",
  nonRefundableStorageFee: "0",
  ...overrides
})

export const buildTransactionEffects = (
  overrides: Partial<TransactionEffects> = {}
): TransactionEffects => ({
  executedEpoch: "0",
  gasObject: buildOwnedObjectRef(),
  gasUsed: buildGasCostSummary(),
  messageVersion: "v1",
  status: { status: "success" },
  transactionDigest: "digest",
  ...overrides
})

export const buildTransactionResponse = (
  overrides: TransactionResponseOverrides = {}
): SuiTransactionBlockResponse => ({
  digest: "digest",
  objectChanges: [],
  ...overrides,
  effects:
    overrides.effects === null
      ? null
      : buildTransactionEffects(overrides.effects)
})

export const buildCreatedObjectChange = (
  overrides: Partial<SuiObjectChangeCreated> = {}
): SuiObjectChangeCreated => ({
  type: "created",
  objectId: "0x1",
  objectType: "0x2::example::Thing",
  version: "1",
  digest: "digest",
  owner: { AddressOwner: "0x1" },
  sender: "0x1",
  ...overrides
})

export const buildMutatedObjectChange = (
  overrides: Partial<SuiObjectChangeMutated> = {}
): SuiObjectChangeMutated => ({
  type: "mutated",
  objectId: "0x1",
  objectType: "0x2::example::Thing",
  version: "1",
  previousVersion: "0",
  digest: "digest",
  owner: { AddressOwner: "0x1" },
  sender: "0x1",
  ...overrides
})

export const buildTransferredObjectChange = (
  overrides: Partial<SuiObjectChangeTransferred> = {}
): SuiObjectChangeTransferred => ({
  type: "transferred",
  objectId: "0x1",
  objectType: "0x2::example::Thing",
  version: "1",
  digest: "digest",
  recipient: { AddressOwner: "0x1" },
  sender: "0x1",
  ...overrides
})

export const buildDeletedObjectChange = (
  overrides: Partial<SuiObjectChangeDeleted> = {}
): SuiObjectChangeDeleted => ({
  type: "deleted",
  objectId: "0x1",
  objectType: "0x2::example::Thing",
  version: "1",
  sender: "0x1",
  ...overrides
})

export const buildWrappedObjectChange = (
  overrides: Partial<SuiObjectChangeWrapped> = {}
): SuiObjectChangeWrapped => ({
  type: "wrapped",
  objectId: "0x1",
  objectType: "0x2::example::Thing",
  version: "1",
  sender: "0x1",
  ...overrides
})
