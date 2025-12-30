import { getFullnodeUrl } from "@mysten/sui/client"
import { defineSuiConfig } from "@sui-oracle-market/tooling-node/config"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "@sui-oracle-market/tooling-node/constants"

const defaultAccount = {
  accountAddress: process.env.SUI_ACCOUNT_ADDRESS,
  accountPrivateKey: process.env.SUI_ACCOUNT_PRIVATE_KEY,
  accountMnemonic: process.env.SUI_ACCOUNT_MNEMONIC
}

const PYTH_CONFIG = {
  testnet: {
    hermesUrl: "https://hermes-beta.pyth.network",
    pythStateId:
      "0x243759059f4c3111179da5878c12f68d612c21a8d54d85edc86164bb18be1c7c",
    wormholeStateId:
      "0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790",
    pythPackageId:
      "0xabf837e98c26087cba0883c0a7a28326b1fa3c5e1e2c5abdb486f9e8f594c837",
    wormholePackageId:
      "0xf47329f4344f3bf0f8e436e2f7b485466cff300f12a166563995d3888c296a94"
  },
  mainnet: {
    hermesUrl: "https://hermes.pyth.network",
    pythStateId:
      "0x1f9310238ee9298fb703c3419030b35b22bb1cc37113e3bb5007c99aec79e5b8",
    wormholeStateId:
      "0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c",
    pythPackageId:
      "0x04e20ddf36af412a4096f9014f4a565af9e812db9a05cc40254846cf6ed0ad91",
    wormholePackageId:
      "0x5306f64e312b581766351c07af79c72fcb1cd25147157fdc2f8ad76de9a3fb6a"
  }
} as const

const OpenZeppelinPackageIds = {
  testnet: "0x1252a9eebce06a98f55eb5132787377ce2cfb28b64145562ba58b1a571c44e34"
}

const WormholePackageIds = {
  testnet: "0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790"
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
      account: defaultAccount,
      move: {
        dependencyAddresses: {}
      }
    },
    testnet: {
      url: getFullnodeUrl("testnet"),
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount,
      move: {
        dependencyAddresses: {
          Pyth: PYTH_CONFIG.testnet.pythPackageId,
          openzeppelin_math: OpenZeppelinPackageIds.testnet,
          Wormhole: WormholePackageIds.testnet
        }
      },
      pyth: {
        hermesUrl: PYTH_CONFIG.testnet.hermesUrl,
        pythStateId: PYTH_CONFIG.testnet.pythStateId,
        wormholeStateId: PYTH_CONFIG.testnet.wormholeStateId,
        wormholePackageId: PYTH_CONFIG.testnet.wormholePackageId
      }
    },
    mainnet: {
      url: getFullnodeUrl("mainnet"),
      gasBudget: DEFAULT_PUBLISH_GAS_BUDGET,
      account: defaultAccount,
      move: {
        dependencyAddresses: {
          Pyth: PYTH_CONFIG.mainnet.pythPackageId
        }
      },
      pyth: {
        hermesUrl: PYTH_CONFIG.mainnet.hermesUrl,
        pythStateId: PYTH_CONFIG.mainnet.pythStateId,
        wormholeStateId: PYTH_CONFIG.mainnet.wormholeStateId,
        wormholePackageId: PYTH_CONFIG.mainnet.wormholePackageId
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
