import { describe, expect, it, vi } from "vitest"
import yargs from "yargs/yargs"
import { addBaseOptions } from "../../src/process.ts"

const withProcessArgv = async <T>(
  nextArgv: string[],
  action: () => Promise<T> | T
): Promise<T> => {
  const previousArgv = process.argv
  process.argv = [...nextArgv]

  try {
    return await action()
  } finally {
    process.argv = previousArgv
  }
}

const silenceStderr = () => {
  const writeSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((() => true) as never)
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  return () => {
    writeSpy.mockRestore()
    errorSpy.mockRestore()
  }
}

describe("addBaseOptions", () => {
  it("parses network arguments after yargs terminator", async () => {
    const result = await withProcessArgv(
      ["node", "script", "--", "--network", "testnet"],
      () => addBaseOptions("script", yargs([]))
    )

    expect(result.network).toBe("testnet")
  })

  it("returns undefined when no network is provided", async () => {
    const result = await withProcessArgv(["node", "script"], () =>
      addBaseOptions("script", yargs([]))
    )

    expect(result.network).toBeUndefined()
  })

  it("rejects unknown options in strict mode", async () => {
    const restoreStderr = silenceStderr()

    await expect(
      withProcessArgv(["node", "script", "--unexpected", "value"], () =>
        addBaseOptions("script", yargs([]).exitProcess(false))
      )
    ).rejects.toThrow(/unknown argument/i)

    restoreStderr()
  })
})
