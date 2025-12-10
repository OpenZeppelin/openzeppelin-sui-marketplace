import { defineSuiConfig } from "./src/scripts/utils/config";

export default defineSuiConfig({
  defaultNetwork: "localnet",
  networks: {
    localnet: {
      gasBudget: 200_000_000,
      account: {
        accountAddress: process.env.SUI_ACCOUNT_ADDRESS,
        accountPrivateKey: process.env.SUI_ACCOUNT_PRIVATE_KEY,
        accountMnemonic: process.env.SUI_ACCOUNT_MNEMONIC,
      },
    },
  },
  paths: {
    move: "move",
    deployments: "deployments",
    artifacts: "deployments",
    objects: "deployments",
  },
});
