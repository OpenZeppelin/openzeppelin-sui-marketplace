import { beforeEach, describe, expect, it, vi } from "vitest"
import { createSuiClientMock } from "../../../test/helpers/sui.ts"
import { createTooling } from "../../src/factory.ts"

const loadKeypairMock = vi.hoisted(() => vi.fn())
const coreAddressMocks = vi.hoisted(() => ({
  getCoinBalanceSummary: vi.fn(),
  getCoinBalances: vi.fn()
}))
const transactionMocks = vi.hoisted(() => ({
  signAndExecute: vi.fn(),
  executeTransactionOnce: vi.fn()
}))
const publishMocks = vi.hoisted(() => ({
  publishPackageWithLog: vi.fn(),
  publishPackage: vi.fn()
}))
const addressMocks = vi.hoisted(() => ({
  ensureFoundedAddress: vi.fn(),
  withTestnetFaucetRetry: vi.fn()
}))

vi.mock("../../src/keypair.ts", () => ({
  loadKeypair: loadKeypairMock
}))

vi.mock("@sui-oracle-market/tooling-core/address", () => ({
  getCoinBalanceSummary: coreAddressMocks.getCoinBalanceSummary,
  getCoinBalances: coreAddressMocks.getCoinBalances
}))

vi.mock("../../src/transactions.ts", () => ({
  signAndExecute: transactionMocks.signAndExecute,
  executeTransactionOnce: transactionMocks.executeTransactionOnce
}))

vi.mock("../../src/publish.ts", () => ({
  publishPackageWithLog: publishMocks.publishPackageWithLog,
  publishPackage: publishMocks.publishPackage
}))

vi.mock("../../src/address.ts", () => ({
  ensureFoundedAddress: addressMocks.ensureFoundedAddress,
  withTestnetFaucetRetry: addressMocks.withTestnetFaucetRetry
}))

const buildSuiConfig = () => ({
  currentNetwork: "localnet",
  defaultNetwork: "localnet",
  networks: {
    localnet: {
      networkName: "localnet",
      url: "http://localhost:9000",
      faucetUrl: "http://localhost:9123",
      gasBudget: 123,
      move: { withUnpublishedDependencies: true },
      account: {
        accountIndex: 0,
        accountAddress: "0x1",
        accountPrivateKey: "secret",
        accountMnemonic: "mnemonic",
        keystorePath: "/tmp/keystore.json"
      },
      accounts: {
        alice: {
          accountAddress: "0x2",
          accountPrivateKey: "secret2",
          keystorePath: "/tmp/alice.json"
        }
      }
    }
  },
  paths: {
    move: "/tmp/move",
    deployments: "/tmp/deployments",
    objects: "/tmp/deployments",
    artifacts: "/tmp/deployments"
  },
  network: {
    networkName: "localnet",
    url: "http://localhost:9000",
    faucetUrl: "http://localhost:9123",
    gasBudget: 123,
    move: { withUnpublishedDependencies: true },
    account: {
      accountIndex: 0,
      accountAddress: "0x1",
      accountPrivateKey: "secret",
      accountMnemonic: "mnemonic",
      keystorePath: "/tmp/keystore.json"
    },
    accounts: {
      alice: {
        accountAddress: "0x2",
        accountPrivateKey: "secret2",
        keystorePath: "/tmp/alice.json"
      }
    }
  }
})

describe("createTooling", () => {
  beforeEach(() => {
    loadKeypairMock.mockReset()
    coreAddressMocks.getCoinBalanceSummary.mockReset()
    coreAddressMocks.getCoinBalances.mockReset()
    transactionMocks.signAndExecute.mockReset()
    transactionMocks.executeTransactionOnce.mockReset()
    publishMocks.publishPackageWithLog.mockReset()
    publishMocks.publishPackage.mockReset()
    addressMocks.ensureFoundedAddress.mockReset()
    addressMocks.withTestnetFaucetRetry.mockReset()
  })

  it("creates a tooling facade with bound helpers", async () => {
    const { client } = createSuiClientMock()
    loadKeypairMock.mockResolvedValue({
      toSuiAddress: () => "0x1"
    })

    const suiConfig = buildSuiConfig()
    const tooling = await createTooling({ suiClient: client, suiConfig })

    expect(tooling.network.networkName).toBe("localnet")
    expect(tooling.loadedEd25519KeyPair.toSuiAddress()).toBe("0x1")
    expect(typeof tooling.getCoinBalances).toBe("function")
    expect(typeof tooling.toJSON).toBe("function")
  })

  it("sanitizes secrets when serializing tooling", async () => {
    const { client } = createSuiClientMock()
    loadKeypairMock.mockResolvedValue({
      toSuiAddress: () => "0x1"
    })

    const suiConfig = buildSuiConfig()
    const tooling = await createTooling({ suiClient: client, suiConfig })
    const json = tooling.toJSON()

    expect(json.network?.account).toEqual({
      accountIndex: 0,
      accountAddress: "0x1",
      keystorePath: "/tmp/keystore.json"
    })
    expect(json.network?.accounts?.alice).toEqual({
      accountAddress: "0x2",
      keystorePath: "/tmp/alice.json"
    })
    expect(json.suiConfig?.network?.account).toEqual({
      accountIndex: 0,
      accountAddress: "0x1",
      keystorePath: "/tmp/keystore.json"
    })
    expect(json.hasSuiClient).toBe(true)
    expect(json.hasKeypair).toBe(true)
  })

  it("binds publish and transaction helpers with the tooling context", async () => {
    const { client } = createSuiClientMock()
    loadKeypairMock.mockResolvedValue({
      toSuiAddress: () => "0x1"
    })
    publishMocks.publishPackageWithLog.mockResolvedValue([])
    transactionMocks.signAndExecute.mockResolvedValue({
      transactionResult: { effects: { status: { status: "success" } } },
      objectArtifacts: { created: [], deleted: [], updated: [], wrapped: [] }
    })

    const suiConfig = buildSuiConfig()
    const tooling = await createTooling({ suiClient: client, suiConfig })

    const publishArgs = {
      packagePath: "/tmp/package",
      keypair: tooling.loadedEd25519KeyPair
    }
    await tooling.publishPackageWithLog(publishArgs)

    expect(publishMocks.publishPackageWithLog).toHaveBeenCalledWith(
      publishArgs,
      { suiClient: client, suiConfig }
    )

    await tooling.signAndExecute({
      transaction: { getData: () => ({ gasData: { payment: [] } }) } as never,
      signer: tooling.loadedEd25519KeyPair
    })

    expect(transactionMocks.signAndExecute).toHaveBeenCalledWith(
      expect.anything(),
      { suiClient: client, suiConfig }
    )
  })
})
