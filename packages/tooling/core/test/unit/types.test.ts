import { describe, expect, it } from "vitest"
import { ENetwork } from "../../src/types.ts"

describe("ENetwork", () => {
  it("exposes the expected network names", () => {
    expect(ENetwork.LOCALNET).toBe("localnet")
    expect(ENetwork.DEVNET).toBe("devnet")
    expect(ENetwork.TESTNET).toBe("testnet")
    expect(ENetwork.MAINNET).toBe("mainnet")
    expect(Object.values(ENetwork)).toHaveLength(4)
  })
})
