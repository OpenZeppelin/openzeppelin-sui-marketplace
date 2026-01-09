import { setTimeout as delay } from "node:timers/promises"

import type {
  SuiClient,
  SuiObjectDataOptions,
  SuiObjectResponse
} from "@mysten/sui/client"
import { formatErrorMessage } from "@sui-oracle-market/tooling-core/utils/errors"
import { formatObjectResponseError } from "./object-response.ts"

export type ObjectStateWaitOptions = {
  suiClient: SuiClient
  objectId: string
  predicate?: (response: SuiObjectResponse) => boolean
  timeoutMs?: number
  intervalMs?: number
  label?: string
  objectOptions?: SuiObjectDataOptions
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_INTERVAL_MS = 250

const resolveObjectOptions = (options?: SuiObjectDataOptions) => ({
  showOwner: true,
  showContent: true,
  showType: true,
  ...options
})

const resolveLastErrorMessage = (response?: SuiObjectResponse) => {
  if (!response?.error) return "Object state did not match expected predicate."
  return formatObjectResponseError(response.error) ?? "Unknown object error."
}

const shouldReturnResponse = (
  response: SuiObjectResponse,
  predicate?: (response: SuiObjectResponse) => boolean
) => {
  if (!response.data) return false
  return predicate ? predicate(response) : true
}

const formatTimeoutError = (
  label: string,
  objectId: string,
  lastError: string
) => `Timed out waiting for ${label} ${objectId}: ${lastError}`

export const waitForObjectState = async ({
  suiClient,
  objectId,
  predicate,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  label = "object",
  objectOptions
}: ObjectStateWaitOptions): Promise<SuiObjectResponse> => {
  const start = Date.now()
  let lastError = "Object not available yet."

  while (true) {
    let response: SuiObjectResponse | undefined

    try {
      response = await suiClient.getObject({
        id: objectId,
        options: resolveObjectOptions(objectOptions)
      })

      if (shouldReturnResponse(response, predicate)) return response
      lastError = resolveLastErrorMessage(response)
    } catch (error) {
      lastError = formatErrorMessage(error)
    }

    if (Date.now() - start >= timeoutMs) break
    await delay(intervalMs)
  }

  throw new Error(formatTimeoutError(label, objectId, lastError))
}
