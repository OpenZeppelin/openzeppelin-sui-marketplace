import { vi } from "vitest"

type ConsoleRecord = {
  log: unknown[][]
  warn: unknown[][]
  error: unknown[][]
}

export const captureConsole = () => {
  const records: ConsoleRecord = {
    log: [],
    warn: [],
    error: []
  }

  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      records.log.push(args)
    })
  const warnSpy = vi
    .spyOn(console, "warn")
    .mockImplementation((...args: unknown[]) => {
      records.warn.push(args)
    })
  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      records.error.push(args)
    })

  return {
    records,
    restore: () => {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  }
}
