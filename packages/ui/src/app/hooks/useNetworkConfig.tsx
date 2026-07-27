"use client"

import { createNetworkConfig } from "@mysten/dapp-kit"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import {
  CONTRACT_PACKAGE_VARIABLE_NAME,
  EXPLORER_URL_VARIABLE_NAME,
  LOCALNET_CONTRACT_PACKAGE_ID,
  LOCALNET_EXPLORER_URL,
  LOCALNET_PYTH_STATE_ID,
  LOCALNET_RPC_URL,
  MAINNET_CONTRACT_PACKAGE_ID,
  MAINNET_EXPLORER_URL,
  MAINNET_RPC_URL,
  PYTH_STATE_ID_VARIABLE_NAME,
  TESTNET_CONTRACT_PACKAGE_ID,
  TESTNET_EXPLORER_URL,
  TESTNET_RPC_URL
} from "../config/network"
import useCustomNetworks from "./useCustomNetworks"
import useHostNetworkPolicy from "./useHostNetworkPolicy"

/**
 * Build the network map used by @mysten/dapp-kit.
 * In Sui we configure more than just an RPC URL: each environment needs the
 * published Move package ID so the UI targets the right chain deployment.
 */
const useNetworkConfig = () => {
  const { allowNetworkSwitching } = useHostNetworkPolicy()
  const { networks: customNetworks } = useCustomNetworks()
  const fullNetworkConfig = {
    [ENetwork.LOCALNET]: {
      url: LOCALNET_RPC_URL,
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: LOCALNET_CONTRACT_PACKAGE_ID,
        [EXPLORER_URL_VARIABLE_NAME]: LOCALNET_EXPLORER_URL,
        [PYTH_STATE_ID_VARIABLE_NAME]: LOCALNET_PYTH_STATE_ID
      }
    },
    [ENetwork.TESTNET]: {
      // Resolved in config/network.ts: honors NEXT_PUBLIC_TESTNET_RPC_URL and
      // defaults to a working public node (Mysten's testnet fullnode 404s).
      url: TESTNET_RPC_URL,
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: TESTNET_CONTRACT_PACKAGE_ID,
        [EXPLORER_URL_VARIABLE_NAME]: TESTNET_EXPLORER_URL,
        [PYTH_STATE_ID_VARIABLE_NAME]: ""
      }
    },
    [ENetwork.MAINNET]: {
      url: MAINNET_RPC_URL,
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: MAINNET_CONTRACT_PACKAGE_ID,
        [EXPLORER_URL_VARIABLE_NAME]: MAINNET_EXPLORER_URL,
        [PYTH_STATE_ID_VARIABLE_NAME]: ""
      }
    }
  }

  type NetworkVariables = Record<string, string>

  const customNetworkConfig = customNetworks.reduce<
    Record<string, { url: string; variables: NetworkVariables }>
  >((accumulator, network) => {
    accumulator[network.networkKey] = {
      url: network.rpcUrl,
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: network.contractPackageId,
        [EXPLORER_URL_VARIABLE_NAME]: network.explorerUrl,
        [PYTH_STATE_ID_VARIABLE_NAME]: ""
      }
    }
    return accumulator
  }, {})

  const networkConfig = allowNetworkSwitching
    ? { ...fullNetworkConfig, ...customNetworkConfig }
    : { [ENetwork.TESTNET]: fullNetworkConfig[ENetwork.TESTNET] }

  return createNetworkConfig(networkConfig)
}

export default useNetworkConfig
