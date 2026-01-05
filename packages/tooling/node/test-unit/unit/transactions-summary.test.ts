import { describe, expect, it } from "vitest"

import {
  buildTransactionSummary,
  formatTransactionSummary,
  requireTransactionDigest,
  resolveTransactionDigest
} from "../../src/transactions-summary.ts"

describe("transaction summary helpers", () => {
  it("builds a transaction summary", () => {
    const summary = buildTransactionSummary(
      {
        digest: "0x1",
        effects: { status: { status: "success" } },
        objectChanges: [
          {
            type: "created",
            objectId: "0x2",
            objectType: "0x3::shop::Shop"
          }
        ],
        balanceChanges: [
          { owner: "0x1", coinType: "0x2::sui::SUI", amount: "5" }
        ]
      } as never,
      "label"
    )

    expect(summary.status).toBe("success")
    expect(summary.digest).toBe("0x1")
    expect(formatTransactionSummary(summary)).toContain("label")
    expect(resolveTransactionDigest({ digest: "0x1" } as never)).toBe("0x1")
    expect(requireTransactionDigest({ digest: "0x1" } as never)).toBe("0x1")
  })
})
