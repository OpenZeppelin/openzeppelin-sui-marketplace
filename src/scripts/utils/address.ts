import type { SuiClient } from "@mysten/sui/client"
import {
  FaucetRateLimitError,
  getFaucetHost,
  requestSuiFromFaucetV2
} from "@mysten/sui/faucet"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import { logKeyValueBlue, logWarning } from "./log.ts"

const DEFAULT_MINIMUM_COIN_OBJECTS = 2
const DEFAULT_MINIMUM_GAS_COIN_BALANCE = 500_000_000n
const DEFAULT_MINIMUM_BALANCE =
  DEFAULT_MINIMUM_GAS_COIN_BALANCE * BigInt(DEFAULT_MINIMUM_COIN_OBJECTS)
const DEFAULT_SPLIT_GAS_BUDGET = 10_000_000

type CoinBalance = NonNullable<
  Awaited<ReturnType<SuiClient["getCoins"]>>["data"]
>[number]

type FundingSnapshot = {
  coins: CoinBalance[]
  coinCount: number
  hasEnoughBalance: boolean
  hasSufficientGasCoin: boolean
  ready: boolean
}

export type EnsureFoundedAddressOptions = {
  network?: "localnet" | "devnet" | "testnet"
  signerAddress: string
  signer?: Ed25519Keypair
  minimumBalance?: bigint
  minimumCoinObjects?: number
  minimumGasCoinBalance?: bigint
  splitGasBudget?: number
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

const getAddressesCoins = async (ownerAddress: string, suiClient: SuiClient) =>
  (
    await suiClient.getCoins({
      owner: normalizeSuiAddress(ownerAddress),
      coinType: "0x2::sui::SUI",
      limit: 10
    })
  ).data || []

const deriveEffectiveMinimumBalance = ({
  minimumBalance,
  minimumCoinObjects = DEFAULT_MINIMUM_COIN_OBJECTS,
  minimumGasCoinBalance = DEFAULT_MINIMUM_GAS_COIN_BALANCE
}: Pick<
  EnsureFoundedAddressOptions,
  "minimumBalance" | "minimumCoinObjects" | "minimumGasCoinBalance"
>) => {
  const minimumBalanceTarget =
    minimumGasCoinBalance *
    BigInt(minimumCoinObjects || DEFAULT_MINIMUM_COIN_OBJECTS)
  return minimumBalance && minimumBalance > minimumBalanceTarget
    ? minimumBalance
    : minimumBalanceTarget
}

const isFaucetSupported = (network: EnsureFoundedAddressOptions["network"]) =>
  ["localnet", "devnet", "testnet"].includes(network ?? "")

const fundingSnapshot = async (
  {
    signerAddress,
    minimumBalance,
    minimumCoinObjects,
    minimumGasCoinBalance
  }: {
    signerAddress: string
    minimumBalance: bigint
    minimumCoinObjects: number
    minimumGasCoinBalance: bigint
  },
  client: SuiClient
): Promise<FundingSnapshot> => {
  const coins = await getAddressesCoins(signerAddress, client)
  const coinCount = coins.length
  const hasEnoughBalance = await asMinimumBalanceOf(
    {
      address: signerAddress,
      minimumBalance
    },
    client
  )
  const hasSufficientGasCoin =
    minimumGasCoinBalance <= 0n ||
    coins.some((coin) => BigInt(coin.balance) >= minimumGasCoinBalance)

  return {
    coins,
    coinCount,
    hasEnoughBalance,
    hasSufficientGasCoin,
    ready:
      coinCount >= minimumCoinObjects &&
      hasEnoughBalance &&
      hasSufficientGasCoin
  }
}

const maybeSplitCoinObjects = async ({
  snapshot,
  signer,
  signerAddress,
  client,
  minimumCoinObjects,
  minimumGasCoinBalance,
  splitGasBudget
}: {
  snapshot: FundingSnapshot
  signer?: Ed25519Keypair
  signerAddress: string
  client: SuiClient
  minimumCoinObjects: number
  minimumGasCoinBalance: bigint
  splitGasBudget: number
}) => {
  const shouldSplit =
    signer &&
    snapshot.coinCount > 0 &&
    snapshot.coinCount < minimumCoinObjects &&
    snapshot.hasEnoughBalance

  if (!shouldSplit) {
    return { attempted: false, succeeded: false as const }
  }

  try {
    const succeeded = await topUpCoinObjects({
      coins: snapshot.coins,
      signer,
      signerAddress,
      client,
      targetCoinObjects: minimumCoinObjects,
      perCoinAmount: minimumGasCoinBalance,
      gasBudget: splitGasBudget
    })

    return {
      attempted: true,
      succeeded,
      error: succeeded
        ? undefined
        : new Error("Failed to split SUI coin into additional gas objects.")
    }
  } catch (error) {
    return { attempted: true, succeeded: false as const, error }
  }
}

const requestFunding = async ({
  network,
  signerAddress,
  attempt
}: {
  network: EnsureFoundedAddressOptions["network"]
  signerAddress: string
  attempt: number
}) => {
  const faucetHost = getFaucetHost(network ?? "localnet")

  try {
    await requestSuiFromFaucetV2({
      host: faucetHost,
      recipient: signerAddress
    })
    return { success: true as const }
  } catch (error) {
    if (error instanceof FaucetRateLimitError) await delay(500 * attempt + 250)

    return { success: false as const, error }
  }
}

const fundingFailure = (address: string, network: string, lastError: unknown) =>
  new Error(
    `Failed to fund ${address} on ${network}: not enough SUI coin objects after funding attempts${
      lastError
        ? ` (last error: ${
            lastError instanceof Error ? lastError.message : String(lastError)
          })`
        : ""
    }.`
  )

/**
 * Ensures the signer has spendable SUI; auto-faucets on localnet/devnet/testnet if empty.
 * Also hydrates a second gas coin if only one is present, to avoid lock contention on a single coin object.
 */
export const ensureFoundedAddress = async (
  {
    network = "localnet",
    signerAddress,
    signer,
    minimumBalance = DEFAULT_MINIMUM_BALANCE,
    minimumCoinObjects = DEFAULT_MINIMUM_COIN_OBJECTS,
    minimumGasCoinBalance = DEFAULT_MINIMUM_GAS_COIN_BALANCE,
    splitGasBudget = DEFAULT_SPLIT_GAS_BUDGET
  }: EnsureFoundedAddressOptions,
  client: SuiClient
) => {
  const faucetSupported = isFaucetSupported(network)
  const normalizedAddress = normalizeSuiAddress(signerAddress)

  const effectiveMinimumBalance = deriveEffectiveMinimumBalance({
    minimumBalance,
    minimumCoinObjects,
    minimumGasCoinBalance
  })

  let attempts = 0
  let lastError: unknown

  while (attempts < 5) {
    const snapshot = await fundingSnapshot(
      {
        signerAddress,
        minimumBalance: effectiveMinimumBalance,
        minimumCoinObjects,
        minimumGasCoinBalance
      },
      client
    )

    if (snapshot.ready) return

    const splitResult = await maybeSplitCoinObjects({
      snapshot,
      signer,
      signerAddress: normalizedAddress,
      client,
      minimumCoinObjects,
      minimumGasCoinBalance,
      splitGasBudget
    })
    if (splitResult.error) lastError = splitResult.error

    attempts += 1
    if (splitResult.succeeded) continue

    if (!faucetSupported) {
      if (!snapshot.hasEnoughBalance)
        throw new Error(`faucet is unavailable for network ${network}`)
      return
    }

    const faucetResult = await requestFunding({
      network,
      signerAddress,
      attempt: attempts
    })

    if (!faucetResult.success) lastError = faucetResult.error
  }

  throw fundingFailure(normalizedAddress, network, lastError)
}

const calculateMissingCoins = (
  targetCoinObjects: number,
  coins: CoinBalance[]
) => Math.max(0, targetCoinObjects - coins.length)

const selectRichestCoin = (coins: CoinBalance[]) =>
  coins.reduce<CoinBalance | null>((richest, coin) => {
    if (!richest) return coin
    const difference = BigInt(coin.balance) - BigInt(richest.balance)
    return difference > 0n ? coin : richest
  }, null)

const canAffordSplit = ({
  richestCoin,
  missingCoins,
  perCoinAmount,
  gasBudget
}: {
  richestCoin: CoinBalance
  missingCoins: number
  perCoinAmount: bigint
  gasBudget: number
}) => {
  const availableBalance = BigInt(richestCoin.balance)
  const totalSplit = perCoinAmount * BigInt(missingCoins)

  if (perCoinAmount <= 0n) return false
  return availableBalance > totalSplit + BigInt(gasBudget)
}

const buildSplitTransaction = ({
  missingCoins,
  perCoinAmount,
  signerAddress,
  gasBudget
}: {
  missingCoins: number
  perCoinAmount: bigint
  signerAddress: string
  gasBudget: number
}) => {
  const transaction = new Transaction()
  transaction.setSender(signerAddress)
  transaction.setGasOwner(signerAddress)
  transaction.setGasBudget(gasBudget)

  const splitResult = transaction.splitCoins(
    transaction.gas,
    Array.from({ length: missingCoins }, () =>
      transaction.pure.u64(perCoinAmount)
    )
  )

  const newCoins = Array.from(
    { length: missingCoins },
    (_, index) => splitResult[index] ?? splitResult
  )

  newCoins.forEach((coin) =>
    transaction.transferObjects([coin], transaction.pure.address(signerAddress))
  )

  return transaction
}

const executeSplitTransaction = async ({
  transaction,
  signer,
  client
}: {
  transaction: Transaction
  signer: Ed25519Keypair
  client: SuiClient
}) => {
  const response = await client.signAndExecuteTransaction({
    signer,
    transaction,
    options: {
      showEffects: true
    },
    requestType: "WaitForLocalExecution"
  })

  return response.effects?.status?.status === "success"
}

const topUpCoinObjects = async ({
  coins,
  signer,
  signerAddress,
  client,
  targetCoinObjects,
  perCoinAmount,
  gasBudget
}: {
  coins: CoinBalance[]
  signer: Ed25519Keypair
  signerAddress: string
  client: SuiClient
  targetCoinObjects: number
  perCoinAmount: bigint
  gasBudget: number
}) => {
  const missingCoins = calculateMissingCoins(targetCoinObjects, coins)
  if (missingCoins <= 0) return true

  const richestCoin = selectRichestCoin(coins)
  if (!richestCoin) return false
  if (!canAffordSplit({ richestCoin, missingCoins, perCoinAmount, gasBudget }))
    return false

  const splitTransaction = buildSplitTransaction({
    missingCoins,
    perCoinAmount,
    signerAddress,
    gasBudget
  })

  return executeSplitTransaction({
    transaction: splitTransaction,
    signer,
    client
  })
}

const isNoGasError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : ""
  return message.includes("No usable SUI coins available for gas")
}

const isInsufficientGasError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : ""
  return /insufficient\s*gas/i.test(message)
}

/**
 * Wraps an operation and, on faucet-supported networks, tops up and retries once
 * if we hit the "No usable SUI coins available for gas" error.
 */
export const withTestnetFaucetRetry = async <T>(
  {
    signerAddress,
    signer,
    network,
    minimumBalance = DEFAULT_MINIMUM_BALANCE,
    minimumCoinObjects = DEFAULT_MINIMUM_COIN_OBJECTS,
    minimumGasCoinBalance = DEFAULT_MINIMUM_GAS_COIN_BALANCE
  }: {
    signerAddress: string
    network: string
    signer?: Ed25519Keypair
    minimumBalance?: bigint
    minimumCoinObjects?: number
    minimumGasCoinBalance?: bigint
  },
  transactionRun: () => Promise<T>,
  suiClient: SuiClient
): Promise<T> => {
  const networkName = (network || "localnet").toLowerCase()
  const faucetSupported = ["localnet", "devnet", "testnet"].includes(
    networkName
  )
  const ensureOptions = {
    network: networkName as EnsureFoundedAddressOptions["network"],
    signerAddress,
    signer,
    minimumBalance,
    minimumCoinObjects,
    minimumGasCoinBalance
  }

  if (faucetSupported) {
    logKeyValueBlue("faucet")(
      `ensure funds for ${normalizeSuiAddress(signerAddress)} on ${networkName}`
    )
    await ensureFoundedAddress(ensureOptions, suiClient)
  }

  try {
    return await transactionRun()
  } catch (error) {
    if (
      !faucetSupported ||
      (!isNoGasError(error) && !isInsufficientGasError(error))
    )
      throw error

    logWarning(
      `Gas funding issue detected (${
        error instanceof Error ? error.message : String(error)
      }); requesting faucet and retrying.`
    )
    await ensureFoundedAddress(ensureOptions, suiClient)

    return await transactionRun()
  }
}
