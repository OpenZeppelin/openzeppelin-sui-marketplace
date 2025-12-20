import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"

export const parseAddressList = (
  rawAddresses: string | string[] | undefined,
  label: string
): string[] => {
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

export const getSuiBalance = async (address: string, client: SuiClient) => {
  const balance = await client.getBalance({
    owner: address,
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
  client: SuiClient
) => {
  const currentBalance = await getSuiBalance(address, client)

  return currentBalance >= minimumBalance
}
