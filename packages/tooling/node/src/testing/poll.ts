import { setTimeout as delay } from "node:timers/promises"

import { formatErrorMessage } from "@sui-oracle-market/tooling-core/utils/errors"

export type PollAttemptResult<T> = {
  done: boolean
  result?: T
  errorMessage?: string
}

export type PollResult<T> = {
  timedOut: boolean
  result?: T
  errorMessage?: string
}

export const pollWithTimeout = async <T>({
  attempt,
  timeoutMs,
  intervalMs,
  shouldAbortOnError
}: {
  attempt: () => Promise<PollAttemptResult<T>>
  timeoutMs: number
  intervalMs: number
  shouldAbortOnError?: (error: unknown) => boolean
}): Promise<PollResult<T>> => {
  const start = Date.now()
  let lastResult: T | undefined
  let lastErrorMessage: string | undefined

  while (Date.now() - start < timeoutMs) {
    try {
      const { done, result, errorMessage } = await attempt()
      if (result !== undefined) lastResult = result
      if (done) {
        return {
          timedOut: false,
          result: result ?? lastResult
        }
      }
      if (errorMessage) lastErrorMessage = errorMessage
    } catch (error) {
      if (shouldAbortOnError?.(error)) throw error
      lastErrorMessage = formatErrorMessage(error)
    }

    await delay(intervalMs)
  }

  return {
    timedOut: true,
    result: lastResult,
    errorMessage: lastErrorMessage
  }
}
