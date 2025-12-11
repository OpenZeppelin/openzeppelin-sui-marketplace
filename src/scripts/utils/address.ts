import type { SuiClient } from "@mysten/sui/client"
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet"
import { normalizeSuiAddress } from "@mysten/sui/utils"

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

/**
 * Ensures the signer has spendable SUI; auto-faucets on localnet/devnet/testnet if empty.
 * Also hydrates a second gas coin if only one is present, to avoid lock contention on a single coin object.
 */
export const ensureFoundedAddress = async (
  {
    network = "localnet",
    signerAddress
  }: {
    network?: "localnet" | "devnet" | "testnet"
    signerAddress: string
  },
  client: SuiClient
) => {
  const faucetSupported = ["localnet", "devnet", "testnet"].includes(network)
  const normalizedAddress = normalizeSuiAddress(signerAddress)

  const coins = await client.getCoins({
    owner: normalizedAddress,
    coinType: "0x2::sui::SUI",
    limit: 2
  })

  const coinCount = coins.data?.length ?? 0
  const hasPlenty = await asMinimumBalanceOf(
    {
      address: signerAddress,
      minimumBalance: 1_000_000n
    },
    client
  )

  // If we already have enough balance and at least two spendable coins, nothing to do.
  if (coinCount >= 2 && hasPlenty) return

  if (faucetSupported) {
    const faucetHost = getFaucetHost(network)
    await requestSuiFromFaucetV2({
      host: faucetHost,
      recipient: signerAddress
    })
    return
  }

  if (!hasPlenty)
    throw new Error(`faucet is unavailable for network ${network}`)
}
