import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { SuiClient } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import { toB64 } from "@mysten/sui/utils"

export type IdentifierString = `${string}:${string}`

export type WalletChainSupport =
  | { chains?: readonly string[] }
  | { accounts?: { chains?: readonly string[] }[] }
  | null
  | undefined

export type SignTransactionInput<Account = unknown> = {
  transaction: Transaction
  chain?: IdentifierString
  account?: Account
}

export type SignTransactionResult = {
  bytes: string
  signature: string
  reportTransactionEffects?: (effects: string) => unknown
}

const LOCALNET_CHAIN: IdentifierString = "sui:localnet"
const LOCALNET_HOSTS = new Set(["localhost", "127.0.0.1"])

const getClientRpcUrl = (client: SuiClient) => {
  const anyClient = client as SuiClient & {
    getRpcUrl?: () => string
    rpcUrl?: string
    url?: string
  }

  return anyClient.getRpcUrl?.() ?? anyClient.rpcUrl ?? anyClient.url
}

const assertLocalRpcUrl = (url: string) => {
  if (!isLocalRpc(url)) {
    throw new Error(`Refusing to use non-local RPC URL for localnet: ${url}`)
  }
}

export const isLocalRpc = (url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false
    }
    return LOCALNET_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

export const makeLocalnetExecutor = <Account = unknown>({
  client,
  signTransaction,
  rpcUrlOverride
}: {
  client: SuiClient
  signTransaction: (
    input: SignTransactionInput<Account>
  ) => Promise<SignTransactionResult>
  rpcUrlOverride?: string
}) => {
  const rpcUrl = rpcUrlOverride ?? getClientRpcUrl(client)
  if (rpcUrl) assertLocalRpcUrl(rpcUrl)

  return async (
    transaction: Transaction,
    options?: { chain?: IdentifierString; dryRun?: boolean }
  ): Promise<SuiTransactionBlockResponse> => {
    const chain = options?.chain ?? LOCALNET_CHAIN

    if (options?.dryRun !== false) {
      const dryRunBytes = await transaction.build({ client })
      const dryRunResult = await client.dryRunTransactionBlock({
        transactionBlock: dryRunBytes
      })
      if (dryRunResult.effects?.status?.status !== "success") {
        throw new Error(dryRunResult.effects?.status?.error || "Dry run failed")
      }
    }

    const { bytes, signature, reportTransactionEffects } =
      await signTransaction({
        transaction,
        chain
      })

    const result = await client.executeTransactionBlock({
      transactionBlock: bytes,
      signature,
      options: {
        showRawEffects: true,
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
        showBalanceChanges: true,
        showInput: true
      }
    })

    if (reportTransactionEffects && result.rawEffects) {
      const rawEffectsBytes = Uint8Array.from(result.rawEffects)
      await reportTransactionEffects(toB64(rawEffectsBytes))
    }

    if (result.effects?.status?.status !== "success") {
      throw new Error(result.effects?.status?.error || "Transaction failed")
    }

    return result
  }
}

export const walletSupportsChain = (
  walletOrAccount: WalletChainSupport,
  chainId: string
) => {
  if (!walletOrAccount || !chainId) return false
  if ("chains" in walletOrAccount && Array.isArray(walletOrAccount.chains)) {
    return walletOrAccount.chains.includes(chainId)
  }
  if (
    "accounts" in walletOrAccount &&
    Array.isArray(walletOrAccount.accounts)
  ) {
    return walletOrAccount.accounts.some((account) =>
      account.chains?.includes(chainId)
    )
  }
  return false
}
