import type { ExecException, ExecFileOptions } from "node:child_process"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)

/**
 * Ensures the Sui CLI is installed and available on PATH.
 */
export const ensureSuiCli = async () => {
  try {
    await execFile("sui", ["--version"])
  } catch {
    throw new Error(
      "The Sui CLI is required but was not found. Install it and ensure `sui` is on your PATH."
    )
  }
}

/**
 * Builds a CLI runner for `sui`, returning stdout/stderr/exitCode even on failure.
 */
export const runSuiCli =
  (baseCliArguments: string[]) =>
  async (
    complementaryCliArguments: string[],
    options: ExecFileOptions = {}
  ) => {
    try {
      const result = await execFile(
        "sui",
        [...baseCliArguments, ...complementaryCliArguments],
        { encoding: "utf-8", ...options }
      )
      return { ...result, exitCode: 0 }
    } catch (error) {
      const executionError = error as ExecException
      // `execFile` rejects on non-zero exit codes. We still want to surface
      // whatever stdout was produced (warnings often go to stdout), so plumb it through.
      return {
        stdout: executionError?.stdout ?? "",
        stderr: executionError?.stderr ?? executionError?.message ?? "",
        exitCode:
          typeof executionError?.code === "number"
            ? executionError.code
            : undefined
      }
    }
  }
