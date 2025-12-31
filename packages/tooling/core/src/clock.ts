import type { SuiClient } from "@mysten/sui/client"

import { SUI_CLOCK_ID } from "./constants.ts"
import { unwrapMoveObjectFields } from "./object.ts"

/**
 * Reads the current on-chain clock timestamp (ms).
 */
export const getClockTimestampMs = async (
  suiClient: SuiClient
): Promise<number | undefined> => {
  try {
    const response = await suiClient.getObject({
      id: SUI_CLOCK_ID,
      options: { showContent: true }
    })
    const object = response.data
    if (!object) return undefined

    const clockFields = unwrapMoveObjectFields<{
      timestamp_ms?: string | number | bigint
    }>(object)
    const rawTimestamp = clockFields.timestamp_ms

    if (typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp))
      return rawTimestamp
    if (typeof rawTimestamp === "bigint") {
      const parsed = Number(rawTimestamp)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    if (typeof rawTimestamp === "string") {
      const parsed = Number(rawTimestamp)
      return Number.isFinite(parsed) ? parsed : undefined
    }
  } catch {
    return undefined
  }

  return undefined
}
