import { getFullnodeUrl } from "@mysten/sui/client";

import { DEFAULT_KEYSTORE_PATH } from "./src/scripts/utils/constants";
import { defineSuiConfig } from "./src/scripts/utils/config";

export default defineSuiConfig({
  defaultNetwork: process.env.SUI_NETWORK ?? "localnet",
  networks: {
    localnet: {
      url: process.env.SUI_RPC_URL ?? getFullnodeUrl("localnet"),
      gasBudget: 200_000_000,
      accounts: {
        keystorePath:
          process.env.SUI_KEYSTORE_PATH ?? DEFAULT_KEYSTORE_PATH,
        accountIndex: Number(process.env.SUI_ACCOUNT_INDEX ?? 0),
        accountAddress: process.env.SUI_ACCOUNT_ADDRESS,
      },
    },
    devnet: {
      url: getFullnodeUrl("devnet"),
    },
    testnet: {
      url: getFullnodeUrl("testnet"),
    },
    mainnet: {
      url: getFullnodeUrl("mainnet"),
    },
  },
  paths: {
    move: "move",
    deployments: "deployments",
    artifacts: "deployments",
    objects: "deployments",
  },
});
