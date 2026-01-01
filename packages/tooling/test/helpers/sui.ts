import type {
  ObjectResponseError,
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectChangeDeleted,
  SuiObjectChangeMutated,
  SuiObjectChangeTransferred,
  SuiObjectChangeWrapped,
  SuiObjectData,
  SuiObjectResponse,
  SuiTransactionBlockResponse
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
  getLatestSuiSystemState: ReturnType<typeof vi.fn>
  getLatestCheckpointSequenceNumber: ReturnType<typeof vi.fn>
  getReferenceGasPrice: ReturnType<typeof vi.fn>
  getChainIdentifier: ReturnType<typeof vi.fn>
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
      effects: { status: { status: "success" } }
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
): SuiObjectData =>
  ({
    objectId: "0x1",
    version: "1",
    digest: "digest",
    type: "0x2::sui::SUI",
    ...overrides
  }) as SuiObjectData

export const buildSuiObjectResponse = ({
  data,
  error
}: {
  data?: Partial<SuiObjectData>
  error?: ObjectResponseError
} = {}): SuiObjectResponse =>
  ({
    data: data ? buildSuiObjectData(data) : undefined,
    error
  }) as SuiObjectResponse

export const buildTransactionResponse = (
  overrides: Partial<SuiTransactionBlockResponse> = {}
): SuiTransactionBlockResponse =>
  ({
    effects: { status: { status: "success" } },
    objectChanges: [],
    ...overrides
  }) as SuiTransactionBlockResponse

export const buildCreatedObjectChange = (
  overrides: Partial<SuiObjectChangeCreated> = {}
): SuiObjectChangeCreated =>
  ({
    type: "created",
    objectId: "0x1",
    objectType: "0x2::example::Thing",
    version: "1",
    digest: "digest",
    ...overrides
  }) as SuiObjectChangeCreated

export const buildMutatedObjectChange = (
  overrides: Partial<SuiObjectChangeMutated> = {}
): SuiObjectChangeMutated =>
  ({
    type: "mutated",
    objectId: "0x1",
    version: "1",
    digest: "digest",
    ...overrides
  }) as SuiObjectChangeMutated

export const buildTransferredObjectChange = (
  overrides: Partial<SuiObjectChangeTransferred> = {}
): SuiObjectChangeTransferred =>
  ({
    type: "transferred",
    objectId: "0x1",
    version: "1",
    digest: "digest",
    ...overrides
  }) as SuiObjectChangeTransferred

export const buildDeletedObjectChange = (
  overrides: Partial<SuiObjectChangeDeleted> = {}
): SuiObjectChangeDeleted =>
  ({
    type: "deleted",
    objectId: "0x1",
    version: "1",
    digest: "digest",
    ...overrides
  }) as SuiObjectChangeDeleted

export const buildWrappedObjectChange = (
  overrides: Partial<SuiObjectChangeWrapped> = {}
): SuiObjectChangeWrapped =>
  ({
    type: "wrapped",
    objectId: "0x1",
    version: "1",
    digest: "digest",
    ...overrides
  }) as SuiObjectChangeWrapped
