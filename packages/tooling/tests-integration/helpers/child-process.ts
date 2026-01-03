import type { ExecException, ExecFileOptions } from "node:child_process"
import { vi } from "vitest"

type ExecFileCallback = (
  error: ExecException | null,
  stdout?: string,
  stderr?: string
) => void

type ExecFileResult = {
  error?: ExecException | null
  stdout?: string
  stderr?: string
}

const execFileQueue = vi.hoisted(() => [] as ExecFileResult[])

const execFile = vi.hoisted(() => {
  type ExecFileMock = ((
    file: string,
    args?: string[] | ExecFileOptions,
    options?: ExecFileOptions | ExecFileCallback,
    callback?: ExecFileCallback
  ) => void) & {
    [key: symbol]: (
      ...args: unknown[]
    ) => Promise<{ stdout: string; stderr: string }>
  }

  const fn = vi.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === "function") as
      | ExecFileCallback
      | undefined

    const next = execFileQueue.shift() ?? {
      error: null,
      stdout: "",
      stderr: ""
    }
    if (callback) {
      callback(next.error ?? null, next.stdout ?? "", next.stderr ?? "")
    }

    return undefined
  }) as unknown as ExecFileMock

  const customSymbol = Symbol.for("nodejs.util.promisify.custom")
  fn[customSymbol] = (
    ..._args: unknown[]
  ): Promise<{ stdout: string; stderr: string }> => {
    const next = execFileQueue.shift() ?? {
      error: null,
      stdout: "",
      stderr: ""
    }

    if (next.error) {
      return Promise.reject(next.error)
    }

    return Promise.resolve({
      stdout: next.stdout ?? "",
      stderr: next.stderr ?? ""
    })
  }

  return fn
})

vi.mock("node:child_process", () => ({ execFile }))

export const queueExecFileResult = (result: ExecFileResult) => {
  execFileQueue.push(result)
}

export const clearExecFileQueue = () => {
  execFileQueue.splice(0, execFileQueue.length)
}

export const getExecFileMock = () => execFile
