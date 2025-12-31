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

export const mockExecFile = () => {
  const queue: ExecFileResult[] = []

  const execFile = vi.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === "function") as
      | ExecFileCallback
      | undefined

    const next = queue.shift() ?? { error: null, stdout: "", stderr: "" }
    if (callback) {
      callback(next.error ?? null, next.stdout ?? "", next.stderr ?? "")
    }

    return undefined
  }) as (
    file: string,
    args?: string[] | ExecFileOptions,
    options?: ExecFileOptions | ExecFileCallback,
    callback?: ExecFileCallback
  ) => void

  vi.mock("node:child_process", () => ({ execFile }))

  return {
    execFile,
    queueResult: (result: ExecFileResult) => queue.push(result),
    clearQueue: () => queue.splice(0, queue.length)
  }
}
