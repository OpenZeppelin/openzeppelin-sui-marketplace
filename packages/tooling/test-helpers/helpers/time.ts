import { vi } from "vitest"

export const withFakeTimers = async <T>(
  action: () => Promise<T> | T
): Promise<T> => {
  vi.useFakeTimers()

  try {
    return await action()
  } finally {
    vi.useRealTimers()
  }
}

export const withFixedTime = async <T>(
  isoTimestamp: string,
  action: () => Promise<T> | T
): Promise<T> => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(isoTimestamp))

  try {
    return await action()
  } finally {
    vi.useRealTimers()
  }
}
