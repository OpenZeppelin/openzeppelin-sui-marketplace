import { getFullnodeUrl } from "@mysten/sui/client"

// We automatically create/update .env.local with the deployed package ID after deployment.
export const CONTRACT_PACKAGE_ID_NOT_DEFINED = "0xNOTDEFINED"
export const LOCALNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED

// Fullnode RPC URLs for the networks we support (localnet, testnet, mainnet).
// Each prefers a `NEXT_PUBLIC_<NET>_RPC_URL` override and otherwise falls back
// to Mysten's canonical `getFullnodeUrl` -- the same env-first pattern
// openzeppelin-sui-payments uses. This keeps source provider-agnostic; the
// recommended working endpoint lives in `.env` / `.env.example` instead.
// `NEXT_PUBLIC_TESTNET_RPC_URL` is also read by the Node scripts (sui.config.ts),
// so one value applies to both UI and scripts. Set it for testnet: Mysten's
// canonical testnet fullnode now 404s for JSON-RPC.
export const LOCALNET_RPC_URL =
  process.env.NEXT_PUBLIC_LOCALNET_RPC_URL || "http://127.0.0.1:9000"
export const TESTNET_RPC_URL =
  process.env.NEXT_PUBLIC_TESTNET_RPC_URL || getFullnodeUrl("testnet")
export const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL || getFullnodeUrl("mainnet")

// Localnet mock Pyth `State` object id, written to .env.local by the localnet
// bootstrap from deployments/mock.localnet.json. The UI resolves each accepted
// currency's PriceInfoObject from its feed id via this state -- no on-chain pyth
// object id is stored anymore. Empty on real networks, which use the built-in
// Pyth pull-oracle config instead.
export const LOCALNET_PYTH_STATE_ID =
  process.env.NEXT_PUBLIC_LOCALNET_PYTH_STATE_ID || ""
export const TESTNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED
export const MAINNET_CONTRACT_PACKAGE_ID =
  process.env.NEXT_PUBLIC_MAINNET_CONTRACT_PACKAGE_ID ||
  CONTRACT_PACKAGE_ID_NOT_DEFINED

export const LOCALNET_EXPLORER_URL = "http://localhost:9001"
export const TESTNET_EXPLORER_URL = "https://testnet.suivision.xyz"
export const MAINNET_EXPLORER_URL = "https://suivision.xyz"

export const CONTRACT_PACKAGE_VARIABLE_NAME = "contractPackageId"

export const CONTRACT_MODULE_NAME = "shop"

export const EXPLORER_URL_VARIABLE_NAME = "explorerUrl"

export const PYTH_STATE_ID_VARIABLE_NAME = "pythStateId"

export const NETWORKS_WITH_FAUCET = ["localnet", "testnet"]
