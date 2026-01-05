export type ConsoleMethodName = "log" | "warn" | "error" | "info" | "debug"

export type ConsoleCaptureRecords = Record<ConsoleMethodName, unknown[][]>

export type ConsoleCapture = {
  records: ConsoleCaptureRecords
  restore: () => void
}

const DEFAULT_CONSOLE_METHODS: ConsoleMethodName[] = ["log", "warn", "error"]

const createConsoleRecords = (): ConsoleCaptureRecords => ({
  log: [],
  warn: [],
  error: [],
  info: [],
  debug: []
})

const normalizeConsoleMethods = (methods: ConsoleMethodName[]) =>
  Array.from(new Set(methods))

export const captureConsole = (
  methods: ConsoleMethodName[] = DEFAULT_CONSOLE_METHODS
): ConsoleCapture => {
  const records = createConsoleRecords()
  const consoleTarget = console as Record<
    ConsoleMethodName,
    (...args: unknown[]) => void
  >
  const originals = new Map<ConsoleMethodName, (...args: unknown[]) => void>()

  for (const method of normalizeConsoleMethods(methods)) {
    originals.set(method, consoleTarget[method])
    consoleTarget[method] = (...args: unknown[]) => {
      records[method].push(args)
    }
  }

  const restore = () => {
    for (const [method, original] of originals) {
      consoleTarget[method] = original
    }
  }

  return {
    records,
    restore
  }
}

export const withCapturedConsole = async <T>(
  action: () => Promise<T> | T,
  methods?: ConsoleMethodName[]
): Promise<{ result: T; records: ConsoleCaptureRecords }> => {
  const capture = captureConsole(methods)

  try {
    const result = await action()
    return { result, records: capture.records }
  } finally {
    capture.restore()
  }
}
