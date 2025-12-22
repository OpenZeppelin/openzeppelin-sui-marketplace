import { normalizeSuiAddress } from "@mysten/sui/utils"

import type { ToolingCoreContext } from "./context.ts"

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
