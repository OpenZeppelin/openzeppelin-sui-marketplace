import { beforeEach, describe, expect, it, vi } from "vitest"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { SuiResolvedConfig } from "../../src/config.ts"
import { createSuiClientMock } from "../../../tests-integration/helpers/sui.ts"

const faucetMocks = vi.hoisted(() => ({
  requestSuiFromFaucetV2: vi.fn(),
  getFaucetHost: vi.fn((network: string) => `http://faucet/${network}`),
  FaucetRateLimitError: class FaucetRateLimitError extends Error {}
}))

const coreAddressMocks = vi.hoisted(() => ({
  asMinimumBalanceOf: vi.fn()
}))

const utilityMocks = vi.hoisted(() => ({
  wait: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@mysten/sui/faucet", () => faucetMocks)
vi.mock("@sui-oracle-market/tooling-core/address", () => ({
  asMinimumBalanceOf: coreAddressMocks.asMinimumBalanceOf
}))
vi.mock("@sui-oracle-market/tooling-core/utils/utility", () => ({
  wait: utilityMocks.wait
}))

const buildConfig = (networkName: string): SuiResolvedConfig => ({
  currentNetwork: networkName,
  defaultNetwork: networkName,
  networks: {},
  paths: {
    move: "/tmp/move",
    deployments: "/tmp/deployments",
    objects: "/tmp/deployments",
    artifacts: "/tmp/deployments"
  },
  network: {
    networkName,
    url: "http://localhost:9000",
    account: { accountIndex: 0 }
  }
})

describe("ensureFoundedAddress", async () => {
  const module = await import("../../src/address.ts")
  const { ensureFoundedAddress, withTestnetFaucetRetry } = module

  beforeEach(() => {
    faucetMocks.requestSuiFromFaucetV2.mockReset()
    coreAddressMocks.asMinimumBalanceOf.mockReset()
    utilityMocks.wait.mockClear()
  })

  it("throws when faucet is unsupported and balance is insufficient", async () => {
    const { client, mocks } = createSuiClientMock({
      getCoins: vi.fn().mockResolvedValue({
        data: [],
        hasNextPage: false,
        nextCursor: null
      })
    })

    coreAddressMocks.asMinimumBalanceOf.mockResolvedValue(false)

    await expect(
      ensureFoundedAddress(
        { signerAddress: "0x1" },
        { suiClient: client, suiConfig: buildConfig("mainnet") }
      )
    ).rejects.toThrow("faucet is unavailable for network mainnet")

    expect(mocks.getCoins).toHaveBeenCalledTimes(1)
  })

  it("returns when the address is already funded", async () => {
    const { client } = createSuiClientMock({
      getCoins: vi.fn().mockResolvedValue({
        data: [{ balance: "500000000" }, { balance: "500000000" }],
        hasNextPage: false,
        nextCursor: null
      })
    })

    coreAddressMocks.asMinimumBalanceOf.mockResolvedValue(true)

    await expect(
      ensureFoundedAddress(
        { signerAddress: "0x1" },
        { suiClient: client, suiConfig: buildConfig("localnet") }
      )
    ).resolves.toBeUndefined()

    expect(faucetMocks.requestSuiFromFaucetV2).not.toHaveBeenCalled()
  })

  it("retries on gas errors when faucet is supported", async () => {
    const { client } = createSuiClientMock({
      getCoins: vi.fn().mockResolvedValue({
        data: [{ balance: "500000000" }, { balance: "500000000" }],
        hasNextPage: false,
        nextCursor: null
      })
    })

    coreAddressMocks.asMinimumBalanceOf.mockResolvedValue(true)

    const transactionRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("No usable SUI coins available for gas"))
      .mockResolvedValueOnce("ok")

    const onWarning = vi.fn()

    const result = await withTestnetFaucetRetry(
      { signerAddress: "0x1", onWarning },
      transactionRun,
      { suiClient: client, suiConfig: buildConfig("localnet") }
    )

    expect(result).toBe("ok")
    expect(transactionRun).toHaveBeenCalledTimes(2)
    expect(onWarning).toHaveBeenCalledTimes(1)
  })

  it("backs off on faucet rate limits", async () => {
    const { client } = createSuiClientMock({
      getCoins: vi.fn().mockResolvedValue({
        data: [],
        hasNextPage: false,
        nextCursor: null
      })
    })

    coreAddressMocks.asMinimumBalanceOf.mockResolvedValue(false)
    faucetMocks.requestSuiFromFaucetV2.mockRejectedValue(
      new faucetMocks.FaucetRateLimitError("rate limit")
    )

    await expect(
      ensureFoundedAddress(
        { signerAddress: "0x1" },
        { suiClient: client, suiConfig: buildConfig("localnet") }
      )
    ).rejects.toThrow("Failed to fund")

    expect(faucetMocks.requestSuiFromFaucetV2).toHaveBeenCalledTimes(5)
    expect(utilityMocks.wait).toHaveBeenCalledTimes(5)
    expect(utilityMocks.wait.mock.calls.map(([ms]) => ms)).toEqual([
      750, 1250, 1750, 2250, 2750
    ])
  })

  it("rethrows non-gas errors without retrying", async () => {
    const { client } = createSuiClientMock()
    const transactionRun = vi.fn().mockRejectedValue(new Error("boom"))
    const onWarning = vi.fn()

    await expect(
      withTestnetFaucetRetry(
        { signerAddress: "0x1", onWarning },
        transactionRun,
        { suiClient: client, suiConfig: buildConfig("mainnet") }
      )
    ).rejects.toThrow("boom")

    expect(onWarning).not.toHaveBeenCalled()
    expect(faucetMocks.requestSuiFromFaucetV2).not.toHaveBeenCalled()
    expect(utilityMocks.wait).not.toHaveBeenCalled()
  })

  it("splits gas coins when below the minimum coin count", async () => {
    const keypair = Ed25519Keypair.generate()
    const { client, mocks } = createSuiClientMock({
      getCoins: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              coinObjectId: "0x1",
              balance: "1000000000"
            }
          ],
          hasNextPage: false,
          nextCursor: null
        })
        .mockResolvedValueOnce({
          data: [
            { coinObjectId: "0x1", balance: "1000000000" },
            { coinObjectId: "0x2", balance: "500000000" }
          ],
          hasNextPage: false,
          nextCursor: null
        }),
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        effects: { status: { status: "success" } }
      })
    })

    coreAddressMocks.asMinimumBalanceOf.mockResolvedValue(true)

    await expect(
      ensureFoundedAddress(
        { signerAddress: "0x1", signer: keypair },
        { suiClient: client, suiConfig: buildConfig("localnet") }
      )
    ).resolves.toBeUndefined()

    expect(mocks.signAndExecuteTransaction).toHaveBeenCalledTimes(1)
    expect(faucetMocks.requestSuiFromFaucetV2).not.toHaveBeenCalled()
  })
})
