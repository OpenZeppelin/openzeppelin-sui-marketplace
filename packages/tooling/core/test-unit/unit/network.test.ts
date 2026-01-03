import { describe, expect, it } from "vitest"
import {
  assertLocalnetNetwork,
  buildExplorerUrl,
  resolveCommonRpcUrl,
  resolveRpcUrl
} from "../../src/network.ts"

describe("network helpers", () => {
  it("returns a common RPC url for known networks", () => {
    expect(resolveCommonRpcUrl("localnet")).toBeTypeOf("string")
    expect(resolveCommonRpcUrl("testnet")).toBeTypeOf("string")
    expect(resolveCommonRpcUrl("custom")).toBeUndefined()
  })

  it("prefers the override RPC url when provided", () => {
    expect(resolveRpcUrl("custom", "http://custom")).toBe("http://custom")
  })

  it("throws for custom networks without overrides", () => {
    expect(() => resolveRpcUrl("custom-network")).toThrow(
      "Provide an RPC URL for custom networks"
    )
  })

  it("builds explorer URLs per network", () => {
    expect(buildExplorerUrl("digest", "mainnet")).toBe(
      "https://explorer.sui.io/txblock/digest"
    )
    expect(buildExplorerUrl("digest", "testnet")).toBe(
      "https://explorer.sui.io/txblock/digest?network=testnet"
    )
  })

  it("guards localnet-only operations", () => {
    expect(() => assertLocalnetNetwork("devnet")).toThrow(
      "setup-local only seeds mock packages on localnet"
    )
    expect(() => assertLocalnetNetwork("localnet")).not.toThrow()
  })
})
