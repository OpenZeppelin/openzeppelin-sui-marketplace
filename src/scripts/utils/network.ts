import { getFullnodeUrl } from "@mysten/sui/client";
import type { NetworkName } from "./types";

export const resolveCommonRpcUrl = (network: NetworkName | string) => {
  switch (network) {
    case "localnet":
    case "devnet":
    case "testnet":
    case "mainnet":
      return getFullnodeUrl(network);
    default:
      undefined;
  }
};

export const resolveRpcUrl = (
  network: NetworkName | string,
  RpcUrlOverride?: string
) => {
  if (RpcUrlOverride) return RpcUrlOverride;

  const RpcUrl = resolveCommonRpcUrl(network);

  if (RpcUrl) return RpcUrl;

  throw new Error(
    "Provide an RPC URL for custom networks (via config or env)."
  );
};

export const buildExplorerUrl = (digest: string, network: NetworkName) => {
  const explorerNetwork = network === "mainnet" ? "" : `?network=${network}`;
  return `https://explorer.sui.io/txblock/${digest}${explorerNetwork}`;
};
