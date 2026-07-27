import { getFullnodeUrl } from "@mysten/sui/client"
import { defineSuiConfig } from "@sui-oracle-market/tooling-node/config"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "@sui-oracle-market/tooling-node/constants"

const defaultAccount = {
  accountAddress: process.env.SUI_ACCOUNT_ADDRESS,
  accountPrivateKey: process.env.SUI_ACCOUNT_PRIVATE_KEY,
  accountMnemonic: process.env.SUI_ACCOUNT_MNEMONIC
}

export default defineSuiConfig({
  defaultNetwork: "testnet",
  networks: {
    localnet: {
      url: process.env.NEXT_PUBLIC_LOCALNET_RPC_URL || "http://127.0.0.1:9000",
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount
    },
    testnet: {
      url: process.env.NEXT_PUBLIC_TESTNET_RPC_URL || getFullnodeUrl("testnet"),
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount
    },
    mainnet: {
      url: process.env.NEXT_PUBLIC_MAINNET_RPC_URL || getFullnodeUrl("mainnet"),
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount
    }
  },
  paths: {
    move: "contracts",
    deployments: "deployments",
    artifacts: "deployments",
    objects: "deployments"
  }
})
