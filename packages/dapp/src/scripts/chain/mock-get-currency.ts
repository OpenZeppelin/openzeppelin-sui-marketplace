/**
 * Inspects mock coin registry entries on localnet and prints metadata, caps, and supply details.
 * The coin registry is a shared object; each currency and its metadata live as separate objects.
 * If you come from EVM, this is closer to reading ERC-20 metadata and total supply via object queries.
 * It uses view calls and object inspection rather than mutating state.
 */
import type { SuiClient } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import {
  deriveObjectID,
  normalizeSuiAddress,
  normalizeSuiObjectId
} from "@mysten/sui/utils"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

import { assertLocalnetNetwork } from "@sui-oracle-market/tooling-core/network"
import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import type { MockArtifact } from "@sui-oracle-market/tooling-core/types"
import {
  mockArtifactPath,
  readArtifact
} from "@sui-oracle-market/tooling-node/artifacts"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-node/constants"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueRed,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type CliArgs = {
  registryId: string
  coinTypes: string[]
}

type CoinInput = {
  coinType: string
  label?: string
  currencyObjectId?: string
}

type CurrencyViewValues = {
  exists: boolean
  decimals: number
  name: string
  symbol: string
  description: string
  iconUrl: string
  metadataCapId?: string
  metadataCapClaimed: boolean
  metadataCapDeleted: boolean
  treasuryCapId?: string
  denyCapId?: string
  supplyFixed: boolean
  supplyBurnOnly: boolean
  regulated: boolean
  totalSupply?: bigint
}

type CurrencyState = {
  coinType: string
  label?: string
  currencyObjectId: string
  metadataCapStatus: "claimed" | "unclaimed" | "deleted"
  supplyKind: "fixed" | "burn-only" | "mintable" | "unknown"
  totalSupply?: string
  decimals: number
  name: string
  symbol: string
  description: string
  iconUrl: string
  metadataCapId?: string
  treasuryCapId?: string
  denyCapId?: string
  regulated: boolean
}

type InspectReturnValue = [number[], string]
type ViewCallPlan = {
  key: keyof CurrencyViewValues
  decode: (
    value: InspectReturnValue | undefined
  ) => CurrencyViewValues[keyof CurrencyViewValues]
}

type ResolvedSupply = {
  kind: CurrencyState["supplyKind"]
  total?: bigint
}

runSuiScript(async (tooling) => {
  const {
    suiClient,
    loadedEd25519KeyPair: keypair,
    suiConfig: { currentNetwork }
  } = tooling
  const cliArgs = await parseCliArgs()

  assertLocalnetNetwork(currentNetwork)

  const registrySharedObject = await tooling.getSuiSharedObject({
    objectId: cliArgs.registryId,
    mutable: false
  })

  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
  const coinInputs = resolveCoinInputs(cliArgs.coinTypes, mockArtifact)

  for (const coinInput of coinInputs) {
    try {
      const currencyState = await inspectCurrency({
        coinInput,
        getSuiSharedObject: tooling.getSuiSharedObject,
        suiClient,
        registrySharedObject,
        registryId: cliArgs.registryId,
        sender: keypair.toSuiAddress()
      })
      logCurrencyState(currencyState)
    } catch (error) {
      logKeyValueRed("Currency")(
        `${coinInput.label ?? coinInput.coinType} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
})

const parseCliArgs = async (): Promise<CliArgs> => {
  const providedArgs = await yargs(hideBin(process.argv))
    .scriptName("get-mock-currency")
    .option("registry-id", {
      type: "string",
      description: "Coin registry shared object id",
      default: SUI_COIN_REGISTRY_ID
    })
    .option("coin-type", {
      type: "array",
      string: true,
      description:
        "Coin types to inspect (defaults to the mock artifact coins when omitted)",
      default: [] as string[]
    })
    .strict()
    .help()
    .parseAsync()

  return {
    registryId: normalizeSuiObjectId(providedArgs.registryId),
    coinTypes: (providedArgs.coinType as string[]).map((coinType) => coinType)
  }
}

const resolveCoinInputs = (
  coinTypes: string[],
  mockArtifact: MockArtifact | undefined
): CoinInput[] => {
  const artifactCoins = mockArtifact?.coins ?? []

  if (coinTypes.length > 0) {
    return coinTypes.map((coinType) => mergeCoinInput(coinType, artifactCoins))
  }

  if (artifactCoins.length > 0) {
    return artifactCoins.map((coin) => ({
      coinType: coin.coinType,
      label: coin.label,
      currencyObjectId: coin.currencyObjectId
    }))
  }

  throw new Error(
    "No coin types provided. Pass --coin-type or run setup-local to seed mock coins."
  )
}

const mergeCoinInput = (coinType: string, artifactCoins: CoinInput[]) => {
  const normalized = normalizeType(coinType)
  const match = artifactCoins.find(
    (coin) => normalizeType(coin.coinType) === normalized
  )
  return {
    coinType,
    label: match?.label,
    currencyObjectId: match?.currencyObjectId
  }
}

const normalizeType = (type: string) => type.toLowerCase()

const inspectCurrency = async ({
  coinInput,
  getSuiSharedObject,
  suiClient,
  registrySharedObject,
  registryId,
  sender
}: {
  coinInput: CoinInput
  getSuiSharedObject: (args: {
    objectId: string
    mutable?: boolean
  }) => Promise<WrappedSuiSharedObject>
  suiClient: SuiClient
  registrySharedObject: WrappedSuiSharedObject
  registryId: string
  sender: string
}): Promise<CurrencyState> => {
  const currencyObjectId = deriveCurrencyId(coinInput, registryId)
  const currencySharedObject = await getSuiSharedObject({
    objectId: currencyObjectId,
    mutable: false
  })

  const viewValues = await runCoinRegistryViews({
    coinType: coinInput.coinType,
    suiClient,
    registrySharedObject,
    currencySharedObject,
    sender
  })

  const resolvedSupply = await resolveSupplyState({
    viewValues,
    suiClient
  })

  return mapViewToState({
    coinInput,
    currencyObjectId,
    viewValues,
    resolvedSupply
  })
}

const deriveCurrencyId = (coinInput: CoinInput, registryId: string) =>
  normalizeSuiObjectId(
    coinInput.currencyObjectId ??
      deriveObjectID(
        registryId,
        `0x2::coin_registry::CurrencyKey<${coinInput.coinType}>`,
        new Uint8Array()
      )
  )

const runCoinRegistryViews = async ({
  coinType,
  suiClient,
  registrySharedObject,
  currencySharedObject,
  sender
}: {
  coinType: string
  suiClient: SuiClient
  registrySharedObject: WrappedSuiSharedObject
  currencySharedObject: WrappedSuiSharedObject
  sender: string
}): Promise<CurrencyViewValues> => {
  const tx = newTransaction()

  const registryArg = tx.sharedObjectRef(registrySharedObject.sharedRef)
  const currencyArg = tx.sharedObjectRef(currencySharedObject.sharedRef)
  const viewPlan = enqueueViewCalls({
    tx,
    coinType,
    registryArg,
    currencyArg
  })

  const inspection = await suiClient.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: normalizeSuiAddress(sender)
  })

  if (inspection.error)
    throw new Error(`Dev inspect failed: ${inspection.error}`)

  const results = inspection.results ?? []
  return decodeViewResults(viewPlan, results)
}

const enqueueViewCalls = ({
  tx,
  coinType,
  registryArg,
  currencyArg
}: {
  tx: Transaction
  coinType: string
  registryArg: ReturnType<Transaction["sharedObjectRef"]>
  currencyArg: ReturnType<Transaction["sharedObjectRef"]>
}): ViewCallPlan[] => {
  const target = (fn: string) => `0x2::coin_registry::${fn}`

  const viewCalls: ViewCallPlan[] = [
    {
      key: "exists",
      decode: decodeBool("exists")
    },
    {
      key: "decimals",
      decode: decodeU8("decimals")
    },
    {
      key: "name",
      decode: decodeString("name")
    },
    {
      key: "symbol",
      decode: decodeString("symbol")
    },
    {
      key: "description",
      decode: decodeString("description")
    },
    {
      key: "iconUrl",
      decode: decodeString("icon_url")
    },
    {
      key: "metadataCapClaimed",
      decode: decodeBool("is_metadata_cap_claimed")
    },
    {
      key: "metadataCapDeleted",
      decode: decodeBool("is_metadata_cap_deleted")
    },
    {
      key: "metadataCapId",
      decode: decodeOptionalAddress("metadata_cap_id")
    },
    {
      key: "treasuryCapId",
      decode: decodeOptionalAddress("treasury_cap_id")
    },
    {
      key: "denyCapId",
      decode: decodeOptionalAddress("deny_cap_id")
    },
    {
      key: "supplyFixed",
      decode: decodeBool("is_supply_fixed")
    },
    {
      key: "supplyBurnOnly",
      decode: decodeBool("is_supply_burn_only")
    },
    {
      key: "regulated",
      decode: decodeBool("is_regulated")
    },
    {
      key: "totalSupply",
      decode: decodeOptionalU64("total_supply")
    }
  ]

  tx.moveCall({
    target: target("exists"),
    arguments: [registryArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("decimals"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("name"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("symbol"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("description"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("icon_url"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("is_metadata_cap_claimed"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("is_metadata_cap_deleted"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("metadata_cap_id"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("treasury_cap_id"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("deny_cap_id"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("is_supply_fixed"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("is_supply_burn_only"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("is_regulated"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })
  tx.moveCall({
    target: target("total_supply"),
    arguments: [currencyArg],
    typeArguments: [coinType]
  })

  return viewCalls
}

const decodeViewResults = (
  viewPlan: ViewCallPlan[],
  results: Awaited<
    ReturnType<SuiClient["devInspectTransactionBlock"]>
  >["results"]
): CurrencyViewValues => {
  if (!results)
    throw new Error("Dev inspect returned no results for view calls.")

  if (results.length < viewPlan.length)
    throw new Error(
      `Unexpected dev inspect response length ${results.length}; expected ${viewPlan.length}.`
    )

  const decoded: Partial<
    Record<
      keyof CurrencyViewValues,
      CurrencyViewValues[keyof CurrencyViewValues]
    >
  > = {}
  viewPlan.forEach((plan, index) => {
    const value = results[index]?.returnValues?.[0]
    decoded[plan.key] = plan.decode(
      value
    ) as CurrencyViewValues[keyof CurrencyViewValues]
  })

  return decoded as CurrencyViewValues
}

const decodeBool =
  (label: string) =>
  (value: InspectReturnValue | undefined): boolean =>
    unpackBytes(value, label)[0] === 1

const decodeU8 =
  (label: string) =>
  (value: InspectReturnValue | undefined): number => {
    const bytes = unpackBytes(value, label)
    if (bytes.length < 1) throw new Error(`${label} returned empty bytes.`)
    return bytes[0]
  }

const decodeOptionalAddress =
  (label: string) =>
  (value: InspectReturnValue | undefined): string | undefined =>
    decodeOption(unpackBytes(value, label), decodeAddress)

const decodeOptionalU64 =
  (label: string) =>
  (value: InspectReturnValue | undefined): bigint | undefined =>
    decodeOption(unpackBytes(value, label), decodeU64)

const decodeString =
  (label: string) =>
  (value: InspectReturnValue | undefined): string => {
    const bytes = unpackBytes(value, label)
    const [length, offset] = readUleb128(bytes)
    const textBytes = bytes.slice(offset, offset + length)
    return new TextDecoder().decode(textBytes)
  }

const decodeOption = <T>(
  bytes: Uint8Array,
  inner: (payload: Uint8Array) => T
): T | undefined => {
  if (bytes.length === 0) throw new Error("Option payload is empty.")
  const [tag, ...rest] = Array.from(bytes)
  if (tag === 0) return
  if (tag !== 1)
    throw new Error(`Unexpected option tag ${tag}; expected 0 or 1.`)
  return inner(Uint8Array.from(rest))
}

const decodeAddress = (bytes: Uint8Array): string => {
  if (bytes.length !== 32)
    throw new Error(`Expected address bytes length 32, got ${bytes.length}.`)
  return `0x${Buffer.from(bytes).toString("hex")}`
}

const decodeU64 = (bytes: Uint8Array): bigint => {
  if (bytes.length < 8)
    throw new Error(`Expected at least 8 bytes for u64, got ${bytes.length}.`)

  let value = 0n
  for (let i = 0; i < 8; i++) {
    value += BigInt(bytes[i]) << BigInt(8 * i)
  }
  return value
}

const unpackBytes = (
  value: InspectReturnValue | undefined,
  label: string
): Uint8Array => {
  if (!value)
    throw new Error(`Missing return value while decoding ${label} result.`)
  const [rawBytes] = value
  return Uint8Array.from(rawBytes)
}

const readUleb128 = (bytes: Uint8Array): [number, number] => {
  let value = 0
  let shift = 0
  let index = 0

  while (index < bytes.length) {
    const byte = bytes[index]
    value |= (byte & 0x7f) << shift
    index += 1

    if ((byte & 0x80) === 0) return [value, index]

    shift += 7
  }

  throw new Error("ULEB128 decode failed; ran out of bytes.")
}

const resolveSupplyState = async ({
  viewValues,
  suiClient
}: {
  viewValues: CurrencyViewValues
  suiClient: SuiClient
}): Promise<ResolvedSupply> => {
  const kind: CurrencyState["supplyKind"] = viewValues.supplyBurnOnly
    ? "burn-only"
    : viewValues.supplyFixed
      ? "fixed"
      : viewValues.treasuryCapId
        ? "mintable"
        : "unknown"

  const total =
    viewValues.totalSupply ??
    (await getTreasuryCapSupply({
      suiClient,
      treasuryCapId: viewValues.treasuryCapId
    }))

  return { kind, total }
}

const getTreasuryCapSupply = async ({
  suiClient,
  treasuryCapId
}: {
  suiClient: SuiClient
  treasuryCapId?: string
}): Promise<bigint | undefined> => {
  if (!treasuryCapId) return

  try {
    const { data, error } = await suiClient.getObject({
      id: normalizeSuiObjectId(treasuryCapId),
      options: { showContent: true }
    })

    if (error) throw new Error(error.code ?? "Unknown getObject error.")

    const content = data?.content
    if (!content || content.dataType !== "moveObject")
      throw new Error("Treasury cap missing move object content.")

    const totalSupply = extractSupplyValue(
      // @ts-expect-error content typing in SDK is currently broad
      content.fields?.total_supply
    )

    return totalSupply
  } catch (error) {
    logWarning(
      `Failed to read treasury cap ${treasuryCapId ?? ""} supply: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return
  }
}

const extractSupplyValue = (supplyField: unknown): bigint | undefined => {
  if (!supplyField) return
  if (typeof supplyField === "string" && supplyField.length > 0)
    return BigInt(supplyField)
  if (typeof supplyField === "number") return BigInt(supplyField)
  if (typeof supplyField !== "object") return

  const candidate =
    // Parsed fields from RPC usually live on `fields`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supplyField as any)?.fields?.value ??
    // Some node versions expose nested structs flattened under `value`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supplyField as any)?.value

  if (typeof candidate === "string" && candidate.length > 0)
    return BigInt(candidate)
}

const mapViewToState = ({
  coinInput,
  currencyObjectId,
  viewValues,
  resolvedSupply
}: {
  coinInput: CoinInput
  currencyObjectId: string
  viewValues: CurrencyViewValues
  resolvedSupply: ResolvedSupply
}): CurrencyState => {
  const metadataCapStatus = viewValues.metadataCapDeleted
    ? "deleted"
    : viewValues.metadataCapClaimed
      ? "claimed"
      : "unclaimed"

  return {
    coinType: coinInput.coinType,
    label: coinInput.label,
    currencyObjectId,
    metadataCapStatus,
    supplyKind: resolvedSupply.kind,
    totalSupply: resolvedSupply.total?.toString(),
    decimals: viewValues.decimals,
    name: viewValues.name,
    symbol: viewValues.symbol,
    description: viewValues.description,
    iconUrl: viewValues.iconUrl,
    metadataCapId: viewValues.metadataCapId,
    treasuryCapId: viewValues.treasuryCapId,
    denyCapId: viewValues.denyCapId,
    regulated: viewValues.regulated
  }
}

const logCurrencyState = (state: CurrencyState) => {
  logKeyValueGreen("Currency")(state.label ?? state.coinType)
  logKeyValueBlue("CoinType")(state.coinType)
  logKeyValueBlue("Currency")(state.currencyObjectId)
  logKeyValueBlue("Name")(state.name || "N/A")
  logKeyValueBlue("Symbol")(state.symbol || "N/A")
  logKeyValueBlue("Decimals")(state.decimals)
  logKeyValueBlue("Supply")(state.supplyKind)
  logKeyValueBlue("Total")(state.totalSupply ?? "unknown")
  logKeyValueBlue("Regulated")(state.regulated ? "yes" : "no")
  logKeyValueBlue("Metadata")(
    `${state.metadataCapStatus}${
      state.metadataCapId ? ` (${state.metadataCapId})` : ""
    }`
  )
  logKeyValueBlue("Treasury")(state.treasuryCapId ?? "N/A")
  logKeyValueBlue("DenyCap")(state.denyCapId ?? "None")
  console.log("")
}
