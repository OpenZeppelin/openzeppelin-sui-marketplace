// We automatically create/update .env.local with the deployed package ID after deployment.
export const CONTRACT_PACKAGE_ID_NOT_DEFINED = "0xNOTDEFINED"
export const LOCALNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const LOCALNET_RPC_URL = "http://127.0.0.1:9000"

// Localnet mock Pyth `State` object id, written to .env.local by the localnet
// bootstrap from deployments/mock.localnet.json. The UI resolves each accepted
// currency's PriceInfoObject from its feed id via this state -- no on-chain pyth
// object id is stored anymore. Empty on real networks, which use the built-in
// Pyth pull-oracle config instead.
export const LOCALNET_PYTH_STATE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_PYTH_STATE_ID || ""
export const DEVNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_DEVNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const TESTNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const MAINNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_MAINNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED

export const LOCALNET_EXPLORER_URL = "http://localhost:9001"
export const DEVNET_EXPLORER_URL = "https://devnet.suivision.xyz"
export const TESTNET_EXPLORER_URL = "https://testnet.suivision.xyz"
export const MAINNET_EXPLORER_URL = "https://suivision.xyz"

export const CONTRACT_PACKAGE_VARIABLE_NAME = "contractPackageId"

export const CONTRACT_MODULE_NAME = "shop"

export const EXPLORER_URL_VARIABLE_NAME = "explorerUrl"

export const PYTH_STATE_ID_VARIABLE_NAME = "pythStateId"

export const NETWORKS_WITH_FAUCET = ["localnet", "devnet", "testnet"]
