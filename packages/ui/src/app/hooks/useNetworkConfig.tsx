"use client"

import { createNetworkConfig } from "@mysten/dapp-kit"
import { getFullnodeUrl } from "@mysten/sui/client"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import {
  CONTRACT_PACKAGE_VARIABLE_NAME,
  DEVNET_CONTRACT_PACKAGE_ID,
  DEVNET_EXPLORER_URL,
  EXPLORER_URL_VARIABLE_NAME,
  LOCALNET_CONTRACT_PACKAGE_ID,
  LOCALNET_EXPLORER_URL,
  MAINNET_CONTRACT_PACKAGE_ID,
  MAINNET_EXPLORER_URL,
  TESTNET_CONTRACT_PACKAGE_ID,
  TESTNET_EXPLORER_URL
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
      url: getFullnodeUrl(ENetwork.LOCALNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: LOCALNET_CONTRACT_PACKAGE_ID,
        [EXPLORER_URL_VARIABLE_NAME]: LOCALNET_EXPLORER_URL
      }
    },
    [ENetwork.DEVNET]: {
      url: getFullnodeUrl(ENetwork.DEVNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: DEVNET_CONTRACT_PACKAGE_ID,
        [EXPLORER_URL_VARIABLE_NAME]: DEVNET_EXPLORER_URL
      }
    },
    [ENetwork.TESTNET]: {
      url: getFullnodeUrl(ENetwork.TESTNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: TESTNET_CONTRACT_PACKAGE_ID,
        [EXPLORER_URL_VARIABLE_NAME]: TESTNET_EXPLORER_URL
      }
    },
    [ENetwork.MAINNET]: {
      url: getFullnodeUrl(ENetwork.MAINNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: MAINNET_CONTRACT_PACKAGE_ID,
        [EXPLORER_URL_VARIABLE_NAME]: MAINNET_EXPLORER_URL
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
        [EXPLORER_URL_VARIABLE_NAME]: network.explorerUrl
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
