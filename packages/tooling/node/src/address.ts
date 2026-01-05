import type { SuiClient } from "@mysten/sui/client"
import {
  FaucetRateLimitError,
  getFaucetHost,
  requestSuiFromFaucetV2
} from "@mysten/sui/faucet"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import { asMinimumBalanceOf } from "@sui-oracle-market/tooling-core/address"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { wait } from "@sui-oracle-market/tooling-core/utils/utility"

import type { ToolingContext } from "./factory.ts"

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
  signerAddress: string
  signer?: Ed25519Keypair
  minimumBalance?: bigint
  minimumCoinObjects?: number
  minimumGasCoinBalance?: bigint
  splitGasBudget?: number
}

/**
 * Detects the common "no gas coin" error message from Sui RPC.
 */
const isNoGasError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  return message.includes("No usable SUI coins available for gas")
}

/**
 * Detects "insufficient gas" errors, typically due to low SUI coin balance.
 */
const isInsufficientGasError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  return /insufficient\s*gas/i.test(message)
}

const DEFAULT_MINIMUM_COIN_OBJECTS = 2
const DEFAULT_MINIMUM_GAS_COIN_BALANCE = 500_000_000n
const DEFAULT_MINIMUM_BALANCE =
  DEFAULT_MINIMUM_GAS_COIN_BALANCE * BigInt(DEFAULT_MINIMUM_COIN_OBJECTS)
const DEFAULT_SPLIT_GAS_BUDGET = 10_000_000

type FaucetNetworkName = "localnet" | "devnet" | "testnet"

/**
 * Narrows a network name to the faucet-supported subset.
 */
const asFaucetNetwork = (networkName: string): FaucetNetworkName | undefined =>
  networkName === "localnet" ||
  networkName === "devnet" ||
  networkName === "testnet"
    ? networkName
    : undefined

/**
 * Fetches a list of SUI coin objects for an address.
 * Sui balances are comprised of discrete coin objects, not an account balance.
 */
const getAddressesCoins = async (ownerAddress: string, suiClient: SuiClient) =>
  (
    await suiClient.getCoins({
      owner: normalizeSuiAddress(ownerAddress),
      coinType: "0x2::sui::SUI",
      limit: 10
    })
  ).data || []

/**
 * Computes the effective minimum balance based on per-coin gas thresholds.
 */
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

/**
 * Returns true when the network supports the public Sui faucet.
 */
const isFaucetSupported = (networkName: string) =>
  Boolean(asFaucetNetwork(networkName))

/**
 * Captures coin counts and balance readiness for an address.
 * This is useful because Sui requires a *coin object* for gas, not just total balance.
 */
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
    { suiClient: client }
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

/**
 * Splits a gas coin into multiple coin objects when too few are available.
 * Sui uses object-level coins, so multiple gas coins improve concurrency and avoid locks.
 */
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

/**
 * Requests SUI from the faucet with a simple retry-on-rate-limit backoff.
 */
const requestFunding = async ({
  network,
  signerAddress,
  attempt
}: {
  network: FaucetNetworkName
  signerAddress: string
  attempt: number
}) => {
  const faucetHost = getFaucetHost(network)

  try {
    await requestSuiFromFaucetV2({
      host: faucetHost,
      recipient: signerAddress
    })
    return { success: true as const }
  } catch (error) {
    if (error instanceof FaucetRateLimitError) await wait(500 * attempt + 250)

    return { success: false as const, error }
  }
}

/**
 * Builds a descriptive error for funding failures after repeated attempts.
 */
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
 * Ensures the signer has spendable SUI coin objects and splits gas so multiple coins exist.
 * Why: Sui treats coins as objects; having at least two spendable gas coins avoids lock contention
 * and mirrors how wallets fund PTBs. On localnet/devnet/testnet, this will auto-request from the faucet.
 */
export const ensureFoundedAddress = async (
  {
    signerAddress,
    signer,
    minimumBalance = DEFAULT_MINIMUM_BALANCE,
    minimumCoinObjects = DEFAULT_MINIMUM_COIN_OBJECTS,
    minimumGasCoinBalance = DEFAULT_MINIMUM_GAS_COIN_BALANCE,
    splitGasBudget = DEFAULT_SPLIT_GAS_BUDGET
  }: EnsureFoundedAddressOptions,
  toolingContext: ToolingContext
) => {
  const faucetSupported = isFaucetSupported(
    toolingContext.suiConfig.network.networkName
  )
  const faucetNetwork = asFaucetNetwork(
    toolingContext.suiConfig.network.networkName
  )
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
      toolingContext.suiClient
    )

    if (snapshot.ready) return

    const splitResult = await maybeSplitCoinObjects({
      snapshot,
      signer,
      signerAddress: normalizedAddress,
      client: toolingContext.suiClient,
      minimumCoinObjects,
      minimumGasCoinBalance,
      splitGasBudget
    })
    if (splitResult.error) lastError = splitResult.error

    attempts += 1
    if (splitResult.succeeded) continue

    if (!faucetSupported) {
      if (!snapshot.hasEnoughBalance)
        throw new Error(
          `faucet is unavailable for network ${toolingContext.suiConfig.network.networkName}`
        )
      return
    }

    if (!faucetNetwork)
      throw new Error(
        `faucet is unavailable for network ${toolingContext.suiConfig.network.networkName}`
      )

    const faucetResult = await requestFunding({
      network: faucetNetwork,
      signerAddress,
      attempt: attempts
    })

    if (!faucetResult.success) lastError = faucetResult.error
  }

  throw fundingFailure(
    normalizedAddress,
    toolingContext.suiConfig.network.networkName,
    lastError
  )
}

/**
 * Computes the number of additional coin objects needed.
 */
const calculateMissingCoins = (
  targetCoinObjects: number,
  coins: CoinBalance[]
) => Math.max(0, targetCoinObjects - coins.length)

/**
 * Picks the largest coin object by balance.
 */
const selectRichestCoin = (coins: CoinBalance[]) =>
  coins.reduce<CoinBalance | undefined>((richest, coin) => {
    if (!richest) return coin
    const difference = BigInt(coin.balance) - BigInt(richest.balance)
    return difference > 0n ? coin : richest
  }, undefined)

/**
 * Checks whether the richest coin can be split into the missing number of coins.
 */
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

/**
 * Builds a transaction to split the gas coin and transfer new coins back to the signer.
 */
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
  const transaction = newTransaction(gasBudget)
  transaction.setSender(signerAddress)
  transaction.setGasOwner(signerAddress)

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

/**
 * Signs and executes the coin-splitting transaction.
 */
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
    }
  })

  try {
    await client.waitForTransaction({ digest: response.digest })
  } catch {
    // Best-effort to mirror old requestType behavior.
  }

  return response.effects?.status?.status === "success"
}

/**
 * Ensures a minimum number of gas coin objects by splitting a larger coin.
 */
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

/**
 * Runs a transaction-like operation with a faucet-backed retry when gas is missing.
 * Why: Sui requires real gas coin objects for signing; this helper pre-funds (and retries once)
 * on localnet/devnet/testnet to smooth developer flows similar to an EVM auto-faucet.
 */
export const withTestnetFaucetRetry = async <T>(
  {
    signerAddress,
    signer,
    minimumBalance = DEFAULT_MINIMUM_BALANCE,
    minimumCoinObjects = DEFAULT_MINIMUM_COIN_OBJECTS,
    minimumGasCoinBalance = DEFAULT_MINIMUM_GAS_COIN_BALANCE,
    onWarning
  }: {
    signerAddress: string
    signer?: Ed25519Keypair
    minimumBalance?: bigint
    minimumCoinObjects?: number
    minimumGasCoinBalance?: bigint
    onWarning?: (message: string) => void
  },
  transactionRun: () => Promise<T>,
  toolingContext: ToolingContext
): Promise<T> => {
  const faucetSupported = isFaucetSupported(
    toolingContext.suiConfig.network.networkName
  )
  const ensureOptions = {
    signerAddress,
    signer,
    minimumBalance,
    minimumCoinObjects,
    minimumGasCoinBalance
  }

  if (faucetSupported) await ensureFoundedAddress(ensureOptions, toolingContext)

  try {
    return await transactionRun()
  } catch (error) {
    if (
      !faucetSupported ||
      (!isNoGasError(error) && !isInsufficientGasError(error))
    )
      throw error

    onWarning?.(
      `Gas funding issue detected (${
        error instanceof Error ? error.message : String(error)
      }); requesting faucet and retrying.`
    )
    await ensureFoundedAddress(ensureOptions, toolingContext)

    return await transactionRun()
  }
}
