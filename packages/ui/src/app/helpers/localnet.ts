import { SuiClient } from "@mysten/sui/client"
import {
  isLocalRpc,
  makeLocalnetExecutor as makeLocalnetExecutorCore,
  walletSupportsChain,
  type SignTransactionInput,
  type SignTransactionResult
} from "@sui-oracle-market/tooling-core/localnet"
import type { WalletAccount } from "@mysten/wallet-standard"
import { LOCALNET_RPC_URL } from "../config/network"

let localnetClient: SuiClient | null = null

export const getLocalnetClient = () => {
  if (!isLocalRpc(LOCALNET_RPC_URL)) {
    throw new Error(
      `Refusing to use non-local RPC URL for localnet: ${LOCALNET_RPC_URL}`
    )
  }
  if (!localnetClient) {
    localnetClient = new SuiClient({ url: LOCALNET_RPC_URL })
  }
  return localnetClient
}

export const makeLocalnetExecutor = ({
  client,
  signTransaction
}: {
  client: SuiClient
  signTransaction: (
    input: SignTransactionInput<WalletAccount>
  ) => Promise<SignTransactionResult>
}) =>
  makeLocalnetExecutorCore<WalletAccount>({
    client,
    signTransaction,
    rpcUrlOverride: LOCALNET_RPC_URL
  })

export { isLocalRpc, walletSupportsChain }
