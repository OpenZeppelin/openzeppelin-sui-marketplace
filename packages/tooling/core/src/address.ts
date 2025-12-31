import { normalizeSuiAddress } from "@mysten/sui/utils"

import type { ToolingCoreContext } from "./context.ts"

/**
 * Parses a comma-delimited address list, trims entries, and normalizes Sui addresses.
 * Sui addresses are 32-byte (0x + 64 hex chars) account IDs, not 20-byte EVM addresses,
 * so normalization ensures consistent length and casing for comparisons.
 */
export const parseAddressList = ({
  rawAddresses,
  label
}: {
  rawAddresses: string | string[] | undefined
  label: string
}): string[] => {
  const addressCandidates = (
    Array.isArray(rawAddresses)
      ? rawAddresses
      : rawAddresses
        ? [rawAddresses]
        : []
  )
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)

  if (addressCandidates.length === 0)
    throw new Error(`${label} must include at least one address.`)

  const normalizedAddresses = addressCandidates.map((address) =>
    normalizeSuiAddress(address)
  )

  return Array.from(new Set(normalizedAddresses))
}

/**
 * Fetches the total SUI balance for an address by querying the SUI coin type.
 * On Sui, balances are represented as coin objects, not account-balance mappings
 * like in EVM; the RPC aggregates those coin objects for a total balance.
 */
export const getSuiBalance = async (
  { address }: { address: string },
  { suiClient }: ToolingCoreContext
) => {
  const balance = await suiClient.getBalance({
    owner: normalizeSuiAddress(address),
    coinType: "0x2::sui::SUI"
  })
  return BigInt(balance.totalBalance ?? 0n)
}

export type CoinBalanceSummary = {
  coinType: string
  coinObjectCount: number
  totalBalance: bigint
  lockedBalanceTotal: bigint
}

const sumLockedBalance = (
  lockedBalance: Record<string, string> | undefined
): bigint =>
  Object.values(lockedBalance ?? {}).reduce(
    (total, lockedAmount) => total + BigInt(lockedAmount),
    0n
  )

export const getCoinBalanceSummary = async (
  { address, coinType }: { address: string; coinType: string },
  { suiClient }: ToolingCoreContext
): Promise<CoinBalanceSummary> => {
  const balance = await suiClient.getBalance({
    owner: normalizeSuiAddress(address),
    coinType
  })

  return {
    coinType: balance.coinType,
    coinObjectCount: balance.coinObjectCount,
    totalBalance: BigInt(balance.totalBalance ?? 0n),
    lockedBalanceTotal: sumLockedBalance(balance.lockedBalance)
  }
}

export const getCoinBalances = async (
  { address }: { address: string },
  { suiClient }: ToolingCoreContext
): Promise<CoinBalanceSummary[]> => {
  const balances = await suiClient.getAllBalances({
    owner: normalizeSuiAddress(address)
  })

  return balances.map((balance) => ({
    coinType: balance.coinType,
    coinObjectCount: balance.coinObjectCount,
    totalBalance: BigInt(balance.totalBalance ?? 0n),
    lockedBalanceTotal: sumLockedBalance(balance.lockedBalance)
  }))
}

/**
 * Checks whether an address meets a minimum total SUI balance threshold.
 * Useful for gating operations that require multiple gas coin objects in Sui,
 * where insufficient total balance can still be blocked by coin object scarcity.
 */
export const asMinimumBalanceOf = async (
  {
    address,
    minimumBalance
  }: {
    address: string
    minimumBalance: bigint
  },
  context: ToolingCoreContext
) => {
  const currentBalance = await getSuiBalance({ address }, context)

  return currentBalance >= minimumBalance
}
