import type { ExecException } from "node:child_process"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)

export const ensureSuiCli = async () => {
  try {
    await execFile("sui", ["--version"])
  } catch {
    throw new Error(
      "The Sui CLI is required but was not found. Install it and ensure `sui` is on your PATH."
    )
  }
}

export const runSuiCli =
  (baseCliArguments: string[]) =>
  async (complementaryCliArguments: string[]) => {
    try {
      return await execFile(
        "sui",
        [...baseCliArguments, ...complementaryCliArguments],
        { encoding: "utf-8" }
      )
    } catch (error) {
      const executionError = error as ExecException
      // `execFile` rejects on non-zero exit codes. We still want to surface
      // whatever stdout was produced (warnings often go to stdout), so plumb it through.
      return {
        stdout: executionError?.stdout ?? "",
        stderr: executionError?.stderr ?? executionError?.message ?? ""
      }
    }
  }
