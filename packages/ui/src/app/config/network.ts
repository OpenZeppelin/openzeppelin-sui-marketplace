// We automatically create/update .env.local with the deployed package ID after deployment.
export const CONTRACT_PACKAGE_ID_NOT_DEFINED = "0xNOTDEFINED"
export const SHOP_ID_NOT_DEFINED = "0xNOTDEFINED"
export const LOCALNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const LOCALNET_SHOP_ID =
  process.env.NEXT_PUBLIC_LOCALNET_SHOP_ID || SHOP_ID_NOT_DEFINED
export const LOCALNET_RPC_URL = "http://127.0.0.1:9000"
export const DEVNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_DEVNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const DEVNET_SHOP_ID =
  process.env.NEXT_PUBLIC_DEVNET_SHOP_ID || SHOP_ID_NOT_DEFINED
export const TESTNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const TESTNET_SHOP_ID =
  process.env.NEXT_PUBLIC_TESTNET_SHOP_ID || SHOP_ID_NOT_DEFINED
export const MAINNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_MAINNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const MAINNET_SHOP_ID =
  process.env.NEXT_PUBLIC_MAINNET_SHOP_ID || SHOP_ID_NOT_DEFINED

export const LOCALNET_EXPLORER_URL = "http://localhost:9001"
export const DEVNET_EXPLORER_URL = "https://devnet.suivision.xyz"
export const TESTNET_EXPLORER_URL = "https://testnet.suivision.xyz"
export const MAINNET_EXPLORER_URL = "https://suivision.xyz"

export const CONTRACT_PACKAGE_VARIABLE_NAME = "contractPackageId"
export const SHOP_ID_VARIABLE_NAME = "shopId"

export const CONTRACT_MODULE_NAME = "shop"

export const EXPLORER_URL_VARIABLE_NAME = "explorerUrl"

export const NETWORKS_WITH_FAUCET = ["localnet", "devnet", "testnet"]
