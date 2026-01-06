#!/usr/bin/env node
import { execFile } from "node:child_process"
import { createWriteStream } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const version = process.env.SUI_CLI_VERSION || "1.63.0"
const installDir =
  process.env.SUI_CLI_INSTALL_DIR ||
  path.join(process.env.HOME ?? process.cwd(), ".local", "bin")

const osHints = (() => {
  switch (process.platform) {
    case "linux":
      return ["linux", "ubuntu"]
    case "darwin":
      return ["macos", "darwin", "osx"]
    default:
      return [process.platform]
  }
})()

const archHints = (() => {
  switch (process.arch) {
    case "x64":
      return ["x86_64", "amd64"]
    case "arm64":
      return ["arm64", "aarch64"]
    default:
      return [process.arch]
  }
})()

const tagCandidates = [
  `sui-v${version}`,
  `mainnet-v${version}`,
  `testnet-v${version}`,
  `devnet-v${version}`
]

const apiHeaders = () => {
  const headers = {
    "User-Agent": "sui-cli-installer",
    Accept: "application/vnd.github+json"
  }

  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  return headers
}

const fetchRelease = async (tag) => {
  const response = await fetch(
    `https://api.github.com/repos/MystenLabs/sui/releases/tags/${tag}`,
    { headers: apiHeaders() }
  )

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${response.status}`)
  }

  return response.json()
}

const pickAsset = (assets) => {
  const extensionMatch = (name) =>
    name.endsWith(".tgz") || name.endsWith(".tar.gz") || name.endsWith(".zip")

  const osMatch = (name) => osHints.some((hint) => name.includes(hint))
  const archMatch = (name) => archHints.some((hint) => name.includes(hint))

  const candidates = assets.filter((asset) => {
    const name = (asset?.name || "").toLowerCase()
    return extensionMatch(name) && osMatch(name) && archMatch(name)
  })

  if (!candidates.length) return null

  const preferSui = candidates.filter((asset) =>
    (asset.name || "").toLowerCase().includes("sui")
  )

  return (preferSui.length ? preferSui : candidates)[0]
}

const downloadAsset = async (asset, destination) => {
  const response = await fetch(asset.browser_download_url)
  if (!response.ok) {
    throw new Error(
      `Failed to download ${asset.browser_download_url}: ${response.status}`
    )
  }

  const body = response.body
  if (!body) throw new Error("Download response contained no body.")

  await pipeline(Readable.fromWeb(body), createWriteStream(destination))
}

const extractArchive = async (archivePath, outputDir) => {
  if (archivePath.endsWith(".zip")) {
    await execFileAsync("unzip", ["-q", archivePath, "-d", outputDir])
    return
  }

  await execFileAsync("tar", ["-xzf", archivePath, "-C", outputDir])
}

const findBinary = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const match = await findBinary(entryPath)
      if (match) return match
      continue
    }

    if (entry.isFile() && entry.name === "sui") return entryPath
  }

  return null
}

const install = async () => {
  let release = null
  let tag = null

  for (const candidate of tagCandidates) {
    release = await fetchRelease(candidate)
    if (release) {
      tag = candidate
      break
    }
  }

  if (!release || !tag) {
    throw new Error(`Unable to find a Sui release for ${version}.`)
  }

  const asset = pickAsset(release.assets || [])
  if (!asset) {
    throw new Error(
      `No compatible Sui CLI asset found in ${tag}. Available assets: ${(
        release.assets || []
      )
        .map((item) => item.name)
        .join(", ")}`
    )
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "sui-cli-"))
  const archivePath = path.join(tempDir, asset.name)
  const extractDir = path.join(tempDir, "extract")

  await mkdir(extractDir, { recursive: true })
  await downloadAsset(asset, archivePath)
  await extractArchive(archivePath, extractDir)

  const binaryPath = await findBinary(extractDir)
  if (!binaryPath) {
    throw new Error("Failed to locate sui binary in extracted archive.")
  }

  await mkdir(installDir, { recursive: true })
  const destination = path.join(installDir, "sui")
  await copyFile(binaryPath, destination)
  await chmod(destination, 0o755)

  console.log(`Installed Sui CLI ${version} to ${destination}.`)
}

install().catch((error) => {
  console.error(error)
  process.exit(1)
})
