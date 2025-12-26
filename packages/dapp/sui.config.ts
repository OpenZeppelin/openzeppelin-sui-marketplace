import { getFullnodeUrl } from "@mysten/sui/client"
import { defineSuiConfig } from "@sui-oracle-market/tooling-node/config"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "@sui-oracle-market/tooling-node/constants"

const defaultAccount = {
  accountAddress: process.env.SUI_ACCOUNT_ADDRESS,
  accountPrivateKey: process.env.SUI_ACCOUNT_PRIVATE_KEY,
  accountMnemonic: process.env.SUI_ACCOUNT_MNEMONIC
}

export default defineSuiConfig({
  defaultNetwork: "localnet",
  networks: {
    localnet: {
      url: "http://127.0.0.1:9000",
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount
    },
    devnet: {
      url: getFullnodeUrl("devnet"),
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount
    },
    testnet: {
      url: getFullnodeUrl("testnet"),
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount
    },
    mainnet: {
      url: getFullnodeUrl("mainnet"),
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount
    }
  },
  paths: {
    move: "move",
    deployments: "deployments",
    artifacts: "deployments",
    objects: "deployments"
  }
})
