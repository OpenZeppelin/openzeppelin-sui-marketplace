import path from "node:path"
import { fileURLToPath } from "node:url"

export const resolveWorkspaceRoot = () =>
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    ".."
  )

export const resolveDappRoot = () =>
  path.join(resolveWorkspaceRoot(), "packages", "dapp")

export const resolveDappConfigPath = () =>
  path.join(resolveDappRoot(), "sui.config.ts")

export const resolveDappMoveRoot = () => path.join(resolveDappRoot(), "contracts")

export const resolveTsNodeEsmPath = () => {
  const binaryName =
    process.platform === "win32" ? "ts-node-esm.cmd" : "ts-node-esm"
  return path.join(resolveWorkspaceRoot(), "node_modules", ".bin", binaryName)
}
