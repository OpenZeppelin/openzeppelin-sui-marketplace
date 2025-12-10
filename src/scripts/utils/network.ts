import { getFullnodeUrl } from "@mysten/sui/client";
import type { NetworkName } from "./types";

export const resolveRpcUrl = (
  network: NetworkName | string,
  RpcUrlOverride?: string
) => {
  if (RpcUrlOverride) return RpcUrlOverride;
  switch (network) {
    case "localnet":
    case "devnet":
    case "testnet":
    case "mainnet":
      return getFullnodeUrl(network);
    case "custom":
      throw new Error("Provide an RPC URL for network=custom (via config or env).");
    default:
      throw new Error(`Unsupported network ${network as string}`);
  }
};

export const buildExplorerUrl = (digest: string, network: NetworkName) => {
  const explorerNetwork = network === "mainnet" ? "" : `?network=${network}`;
  return `https://explorer.sui.io/txblock/${digest}${explorerNetwork}`;
};
