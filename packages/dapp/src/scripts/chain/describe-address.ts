/**
 * Summarizes a Sui address: balances, owned objects, and staking status.
 * Balances are aggregated from multiple Coin objects; objects themselves are assets.
 * Use this to audit an account's on-chain footprint.
 */
import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  buildOwnedObjectLogFields,
  countUniqueObjectTypes,
  mapOwnerToLabel,
  type OwnedObjectSummary
} from "@sui-oracle-market/tooling-core/object-info"
import { resolveOwnerAddress } from "@sui-oracle-market/tooling-node/account"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

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
  async (tooling, cliArguments) => {
    const addressToInspect = await resolveOwnerAddress(
      cliArguments.address,
      tooling.network
    )

    logInspectionContext({
      address: addressToInspect,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const addressInformation = await collectAddressInformation({
      address: addressToInspect,
      tooling
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
 * Collects balance, stake, and object information for a Sui address.
 */
const collectAddressInformation = async ({
  address,
  tooling
}: {
  address: string
  tooling: Pick<
    Tooling,
    "getCoinBalanceSummary" | "getCoinBalances" | "suiClient"
  >
}): Promise<AddressInformation> => {
  const normalizedAddress = normalizeSuiAddress(address)

  const [suiBalance, coinBalances, ownedObjectsResult, stakeSummary] =
    await Promise.all([
      tooling.getCoinBalanceSummary({
        address: normalizedAddress,
        coinType: "0x2::sui::SUI"
      }),
      tooling.getCoinBalances({ address: normalizedAddress }),
      getOwnedObjectSummaries(normalizedAddress, tooling.suiClient),
      getStakeSummary(normalizedAddress, tooling.suiClient)
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
 * Iterates through owned objects and returns a truncated list of summaries to avoid excessive output.
 */
const getOwnedObjectSummaries = async (
  address: string,
  suiClient: SuiClient
): Promise<{
  summaries: OwnedObjectSummary[]
  truncated: boolean
}> => {
  let cursor: string | undefined
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

    cursor = page.nextCursor ?? undefined
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
const getStakeSummary = async (
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
  console.log("")
}

/**
 * Formats bigint values for display.
 */
const formatBigInt = (value: bigint) => value.toString()
