import path from "node:path"
import { describe, expect, it } from "vitest"
import { withCwd } from "../../../tests-integration/helpers/cwd.ts"
import { withEnv } from "../../../tests-integration/helpers/env.ts"
import {
  resolveRealPath,
  withTempDir,
  writeFileTree
} from "../../../tests-integration/helpers/fs.ts"
import {
  getAccountConfig,
  getNetworkConfig,
  loadSuiConfig
} from "../../src/config.ts"

const clearConfigEnv = {
  SUI_NETWORK: undefined,
  SUI_KEYSTORE_PATH: undefined,
  SUI_ACCOUNT_INDEX: undefined,
  SUI_ACCOUNT_ADDRESS: undefined,
  SUI_ACCOUNT_PRIVATE_KEY: undefined,
  SUI_ACCOUNT_MNEMONIC: undefined
}

describe("loadSuiConfig", () => {
  it("returns defaults when no config file exists", async () => {
    await withTempDir(async (dir) => {
      await withCwd(dir, async () => {
        await withEnv(clearConfigEnv, async () => {
          const config = await loadSuiConfig()

          expect(config.currentNetwork).toBe("localnet")
          expect(config.network.networkName).toBe("localnet")
          const resolvedDir = await resolveRealPath(dir)
          expect(config.paths.move).toBe(path.join(resolvedDir, "move"))
          expect(config.paths.deployments).toBe(
            path.join(resolvedDir, "deployments")
          )
        })
      })
    })
  })

  it("loads network overrides from sui.config.mjs", async () => {
    await withTempDir(async (dir) => {
      await writeFileTree(dir, {
        "sui.config.mjs": `export default {\n  defaultNetwork: "devnet",\n  networks: {\n    devnet: {\n      url: "http://devnet.local",\n      account: { accountIndex: 1 }\n    },\n    testnet: {\n      url: "http://testnet.local",\n      account: { accountIndex: 2 }\n    }\n  }\n}\n`
      })

      await withCwd(dir, async () => {
        await withEnv(clearConfigEnv, async () => {
          const config = await loadSuiConfig()

          expect(config.currentNetwork).toBe("devnet")
          expect(config.network.url).toBe("http://devnet.local")
          expect(config.network.account.accountIndex).toBe(1)

          const testnetConfig = getNetworkConfig("testnet", config)
          expect(testnetConfig.networkName).toBe("testnet")
          expect(testnetConfig.url).toBe("http://testnet.local")
          expect(testnetConfig.account.accountIndex).toBe(2)
        })
      })
    })
  })
})

describe("getAccountConfig", () => {
  it("returns the named account when present", () => {
    const networkConfig = {
      networkName: "localnet",
      url: "http://localhost:9000",
      account: { accountAddress: "0x1" },
      accounts: {
        alice: { accountAddress: "0x2" }
      }
    }

    const selected = getAccountConfig(networkConfig, "alice")

    expect(selected.accountAddress).toBe("0x2")
  })
})
