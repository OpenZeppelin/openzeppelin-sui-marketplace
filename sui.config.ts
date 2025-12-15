import { defineSuiConfig } from "./src/tooling/config.ts"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "./src/tooling/constants.ts"

export default defineSuiConfig({
  defaultNetwork: "localnet",
  networks: {
    localnet: {
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: {
        accountAddress: process.env.SUI_ACCOUNT_ADDRESS,
        accountPrivateKey: process.env.SUI_ACCOUNT_PRIVATE_KEY,
        accountMnemonic: process.env.SUI_ACCOUNT_MNEMONIC
      }
    }
  },
  paths: {
    move: "move",
    deployments: "deployments",
    artifacts: "deployments",
    objects: "deployments"
  }
})
