import { wait } from "./utility.ts"

export const retryWithDelay = async <T>({
  action,
  shouldRetry,
  maxAttempts,
  delayMs
}: {
  action: () => Promise<T>
  shouldRetry: (error: unknown) => boolean
  maxAttempts: number
  delayMs: number
}): Promise<T> => {
  if (maxAttempts <= 0) throw new Error("maxAttempts must be greater than 0.")

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      const isFinalAttempt = attempt >= maxAttempts - 1
      if (isFinalAttempt || !shouldRetry(error)) throw error
      if (delayMs > 0) await wait(delayMs)
    }
  }

  throw new Error("Retry attempts exhausted without a successful result.")
}
