import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  getAccountConfig,
  type SuiNetworkConfig
} from "../../tooling/config.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import {
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import {
  buildOwnedObjectLogFields,
  countUniqueObjectTypes,
  mapOwnerToLabel,
  type OwnedObjectSummary
} from "../../tooling/object-info.ts"
import { runSuiScript } from "../../tooling/process.ts"

type GetAddressInfoCliArgs = {
  address?: string
}

type CoinBalanceSummary = {
  coinType: string
  coinObjectCount: number
  totalBalance: bigint
  lockedBalanceTotal: bigint
}

type StakeSummary = {
  totalStake: bigint
  activeStake: bigint
  pendingStake: bigint
  inactiveStake: bigint
  stakeEntryCount: number
}

type AddressInformation = {
  normalizedAddress: string
  suiBalance: CoinBalanceSummary
  coinBalances: CoinBalanceSummary[]
  ownedObjects: OwnedObjectSummary[]
  ownedObjectsTruncated: boolean
  stakeSummary: StakeSummary
}

const OWNED_OBJECTS_PAGE_SIZE = 50
const OWNED_OBJECTS_HARD_LIMIT = 200
const OWNED_OBJECTS_LOG_LIMIT = 10

runSuiScript<GetAddressInfoCliArgs>(
  async ({ network, currentNetwork }, cliArguments) => {
    const suiClient = createSuiClient(network.url)
    const addressToInspect = await resolveTargetAddress({
      providedAddress: cliArguments.address,
      networkConfig: network
    })

    logInspectionContext({
      address: addressToInspect,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const addressInformation = await collectAddressInformation({
      address: addressToInspect,
      suiClient
    })

    logAddressInformation(addressInformation)
  },
  yargs().option("address", {
    type: "string",
    description:
      "Address to inspect. Defaults to the configured account when omitted.",
    demandOption: true
  })
)

/**
 * Creates a Sui JSON-RPC client for the provided RPC URL.
 */
const createSuiClient = (rpcUrl: string) => new SuiClient({ url: rpcUrl })

/**
 * Resolves the address to inspect by preferring CLI input, falling back to the configured account.
 */
const resolveTargetAddress = async ({
  providedAddress,
  networkConfig
}: {
  providedAddress?: string
  networkConfig: SuiNetworkConfig
}) => {
  if (providedAddress) return normalizeSuiAddress(providedAddress)

  return resolveConfiguredAddress(networkConfig)
}

/**
 * Reads the configured account or derives it from the keystore when no explicit address is set.
 */
const resolveConfiguredAddress = async (networkConfig: SuiNetworkConfig) => {
  const accountConfig = getAccountConfig(networkConfig)

  if (accountConfig.accountAddress)
    return normalizeSuiAddress(accountConfig.accountAddress)

  const keypair = await loadKeypair(accountConfig)
  return normalizeSuiAddress(keypair.toSuiAddress())
}

/**
 * Collects balance, stake, and object information for a Sui address.
 */
const collectAddressInformation = async ({
  address,
  suiClient
}: {
  address: string
  suiClient: SuiClient
}): Promise<AddressInformation> => {
  const normalizedAddress = normalizeSuiAddress(address)

  const [suiBalance, coinBalances, ownedObjectsResult, stakeSummary] =
    await Promise.all([
      fetchSuiBalance(normalizedAddress, suiClient),
      fetchCoinBalances(normalizedAddress, suiClient),
      fetchOwnedObjectSummaries(normalizedAddress, suiClient),
      fetchStakeSummary(normalizedAddress, suiClient)
    ])

  return {
    normalizedAddress,
    suiBalance,
    coinBalances,
    ownedObjects: ownedObjectsResult.summaries,
    ownedObjectsTruncated: ownedObjectsResult.truncated,
    stakeSummary
  }
}

/**
 * Fetches the SUI balance (both amount and object count) for the address.
 */
const fetchSuiBalance = async (
  address: string,
  suiClient: SuiClient
): Promise<CoinBalanceSummary> => {
  const balance = await suiClient.getBalance({
    owner: address,
    coinType: "0x2::sui::SUI"
  })

  return {
    coinType: balance.coinType,
    coinObjectCount: balance.coinObjectCount,
    totalBalance: BigInt(balance.totalBalance),
    lockedBalanceTotal: sumLockedBalance(balance.lockedBalance)
  }
}

/**
 * Returns the balances for every coin type owned by the address.
 */
const fetchCoinBalances = async (
  address: string,
  suiClient: SuiClient
): Promise<CoinBalanceSummary[]> => {
  const balances = await suiClient.getAllBalances({ owner: address })

  return balances.map((balance) => ({
    coinType: balance.coinType,
    coinObjectCount: balance.coinObjectCount,
    totalBalance: BigInt(balance.totalBalance),
    lockedBalanceTotal: sumLockedBalance(balance.lockedBalance)
  }))
}

/**
 * Iterates through owned objects and returns a truncated list of summaries to avoid excessive output.
 */
const fetchOwnedObjectSummaries = async (
  address: string,
  suiClient: SuiClient
): Promise<{
  summaries: OwnedObjectSummary[]
  truncated: boolean
}> => {
  let cursor: string | null | undefined
  const ownedObjects: OwnedObjectSummary[] = []
  let truncated = false

  while (true) {
    const page = await suiClient.getOwnedObjects({
      owner: address,
      cursor,
      limit: OWNED_OBJECTS_PAGE_SIZE,
      options: { showType: true }
    })

    const formattedObjects = (page.data ?? []).flatMap(formatOwnedObject)
    ownedObjects.push(...formattedObjects)

    const reachedHardLimit = ownedObjects.length >= OWNED_OBJECTS_HARD_LIMIT

    if (!page.hasNextPage || !page.nextCursor) break

    if (reachedHardLimit) {
      truncated = true
      break
    }

    cursor = page.nextCursor
  }

  return {
    summaries: ownedObjects.slice(0, OWNED_OBJECTS_HARD_LIMIT),
    truncated
  }
}

/**
 * Formats an owned object entry into a small summary.
 */
const formatOwnedObject = ({
  data
}: Awaited<
  ReturnType<SuiClient["getOwnedObjects"]>
>["data"][number]): OwnedObjectSummary[] => {
  if (!data?.objectId) return []

  return [
    {
      objectId: data.objectId,
      objectType: data.type || undefined,
      version: data.version,
      ownerLabel: mapOwnerToLabel(data.owner),
      previousTransaction: data.previousTransaction || undefined
    }
  ]
}

/**
 * Aggregates stake amounts by their status.
 */
const fetchStakeSummary = async (
  address: string,
  suiClient: SuiClient
): Promise<StakeSummary> => {
  const stakes = await suiClient.getStakes({ owner: address })

  return stakes.reduce<StakeSummary>(
    (summary, delegatedStake) => ({
      ...summary,
      ...accumulateStakeEntries(summary, delegatedStake.stakes || [])
    }),
    {
      totalStake: 0n,
      activeStake: 0n,
      pendingStake: 0n,
      inactiveStake: 0n,
      stakeEntryCount: 0
    }
  )
}

/**
 * Adds stake amounts into the running summary.
 */
const accumulateStakeEntries = (
  currentSummary: StakeSummary,
  stakeEntries: NonNullable<
    Awaited<ReturnType<SuiClient["getStakes"]>>[number]["stakes"]
  >
) => {
  const updatedSummary = { ...currentSummary }

  for (const stakeEntry of stakeEntries) {
    const principal = BigInt(stakeEntry.principal)
    updatedSummary.totalStake += principal
    updatedSummary.stakeEntryCount += 1

    if (stakeEntry.status === "Active") {
      updatedSummary.activeStake += principal
      continue
    }

    if (stakeEntry.status === "Pending") {
      updatedSummary.pendingStake += principal
      continue
    }

    updatedSummary.inactiveStake += principal
  }

  return updatedSummary
}

/**
 * Logs the gathered address information in a readable format.
 */
const logAddressInformation = (addressInformation: AddressInformation) => {
  logKeyValueGreen("Address")(addressInformation.normalizedAddress)
  logKeyValueGreen("SUI balance")(
    formatBigInt(addressInformation.suiBalance.totalBalance)
  )
  logKeyValueGreen("SUI objects")(addressInformation.suiBalance.coinObjectCount)

  console.log("\nCoin balances")
  if (addressInformation.coinBalances.length === 0) {
    logKeyValueYellow("Coins")("No coin balances found for this address.")
  } else {
    addressInformation.coinBalances.forEach((balance) =>
      logEachGreen({
        coinType: balance.coinType,
        objects: balance.coinObjectCount,
        total: formatBigInt(balance.totalBalance),
        locked: formatBigInt(balance.lockedBalanceTotal)
      })
    )
  }

  console.log("\nStake summary")
  logEachGreen({
    totalStake: formatBigInt(addressInformation.stakeSummary.totalStake),
    activeStake: formatBigInt(addressInformation.stakeSummary.activeStake),
    pendingStake: formatBigInt(addressInformation.stakeSummary.pendingStake),
    inactiveStake: formatBigInt(addressInformation.stakeSummary.inactiveStake),
    stakeEntries: addressInformation.stakeSummary.stakeEntryCount
  })

  console.log("\nOwned objects")
  logKeyValueGreen("Owned total")(addressInformation.ownedObjects.length)
  logKeyValueGreen("Unique types")(
    countUniqueObjectTypes(addressInformation.ownedObjects)
  )

  const objectsToLog = addressInformation.ownedObjects.slice(
    0,
    OWNED_OBJECTS_LOG_LIMIT
  )

  if (objectsToLog.length === 0) {
    logKeyValueYellow("Objects")("No owned objects found.")
  } else {
    objectsToLog.forEach((object) =>
      logEachGreen(buildOwnedObjectLogFields(object))
    )

    if (addressInformation.ownedObjects.length > OWNED_OBJECTS_LOG_LIMIT) {
      logKeyValueYellow("Objects")(
        `Showing ${OWNED_OBJECTS_LOG_LIMIT} of ${addressInformation.ownedObjects.length}.`
      )
    }

    if (addressInformation.ownedObjectsTruncated) {
      logKeyValueYellow("Objects")(
        `Listing truncated at ${OWNED_OBJECTS_HARD_LIMIT} items.`
      )
    }
  }
}

/**
 * Builds the log fields for an owned object to make the output more actionable.
 */
/**
 * Logs the script execution context for clarity.
 */
const logInspectionContext = ({
  address,
  rpcUrl,
  networkName
}: {
  address: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Inspecting")(address)
  console.log("\n")
}

/**
 * Sums the locked balance entries returned by the RPC.
 */
const sumLockedBalance = (lockedBalance: Record<string, string>): bigint =>
  Object.values(lockedBalance).reduce(
    (total, lockedAmount) => total + BigInt(lockedAmount),
    0n
  )

/**
 * Formats bigint values for display.
 */
const formatBigInt = (value: bigint) => value.toString()
