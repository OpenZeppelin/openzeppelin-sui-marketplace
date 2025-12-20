import { createNetworkConfig } from "@mysten/dapp-kit"
import { getFullnodeUrl } from "@mysten/sui/client"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import {
  CONTRACT_PACKAGE_VARIABLE_NAME,
  DEVNET_CONTRACT_PACKAGE_ID,
  DEVNET_EXPLORER_URL,
  DEVNET_SHOP_ID,
  EXPLORER_URL_VARIABLE_NAME,
  LOCALNET_CONTRACT_PACKAGE_ID,
  LOCALNET_EXPLORER_URL,
  LOCALNET_SHOP_ID,
  MAINNET_CONTRACT_PACKAGE_ID,
  MAINNET_EXPLORER_URL,
  MAINNET_SHOP_ID,
  SHOP_ID_VARIABLE_NAME,
  TESTNET_CONTRACT_PACKAGE_ID,
  TESTNET_EXPLORER_URL,
  TESTNET_SHOP_ID
} from "../config/network"

const useNetworkConfig = () => {
  return createNetworkConfig({
    [ENetwork.LOCALNET]: {
      url: getFullnodeUrl(ENetwork.LOCALNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: LOCALNET_CONTRACT_PACKAGE_ID,
        [SHOP_ID_VARIABLE_NAME]: LOCALNET_SHOP_ID,
        [EXPLORER_URL_VARIABLE_NAME]: LOCALNET_EXPLORER_URL
      }
    },
    [ENetwork.DEVNET]: {
      url: getFullnodeUrl(ENetwork.DEVNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: DEVNET_CONTRACT_PACKAGE_ID,
        [SHOP_ID_VARIABLE_NAME]: DEVNET_SHOP_ID,
        [EXPLORER_URL_VARIABLE_NAME]: DEVNET_EXPLORER_URL
      }
    },
    [ENetwork.TESTNET]: {
      url: getFullnodeUrl(ENetwork.TESTNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: TESTNET_CONTRACT_PACKAGE_ID,
        [SHOP_ID_VARIABLE_NAME]: TESTNET_SHOP_ID,
        [EXPLORER_URL_VARIABLE_NAME]: TESTNET_EXPLORER_URL
      }
    },
    [ENetwork.MAINNET]: {
      url: getFullnodeUrl(ENetwork.MAINNET),
      variables: {
        [CONTRACT_PACKAGE_VARIABLE_NAME]: MAINNET_CONTRACT_PACKAGE_ID,
        [SHOP_ID_VARIABLE_NAME]: MAINNET_SHOP_ID,
        [EXPLORER_URL_VARIABLE_NAME]: MAINNET_EXPLORER_URL
      }
    }
  })
}

export default useNetworkConfig
