import { describe, expect, it } from "vitest"
import type { SuiClient } from "@mysten/sui/client"
import { createToolingCoreContext } from "../../src/context.ts"
import { ENetwork } from "../../src/types.ts"

describe("tooling core context", () => {
  it("returns the provided context as-is", () => {
    const suiClient = {} as SuiClient
    const context = {
      suiClient,
      networkName: ENetwork.LOCALNET,
      rpcUrl: "http://127.0.0.1:9000"
    }

    expect(createToolingCoreContext(context)).toBe(context)
  })
})
