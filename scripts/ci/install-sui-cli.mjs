#!/usr/bin/env node
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { URL } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const releaseApiBaseUrl =
  process.env.SUI_CLI_GITHUB_API_BASE_URL ||
  "https://api.github.com/repos/MystenLabs/sui"
const configuredVersionSelector = (
  process.env.SUI_CLI_VERSION || "testnet"
).trim()
const homeDirectory = process.env.HOME ?? process.cwd()
const installDir =
  process.env.SUI_CLI_INSTALL_DIR || path.join(homeDirectory, ".local", "bin")
const releaseQueryPageSize = 100
const releaseQueryMaxPages = 10
const suiupGitRepositoryUrl = "https://github.com/MystenLabs/sui.git"
const suiupGitBranch = "main"

const latestMainnetSelectorSet = new Set(["latest", "latest-mainnet"])
const suiupSelectorSet = new Set(["mainnet", "testnet", "devnet"])
const suiupBinarySearchPaths = [
  path.join(homeDirectory, ".cargo", "bin", "suiup"),
  path.join(homeDirectory, ".local", "bin", "suiup")
]

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

const normalizeVersionSelectorInput = (selector) => {
  const normalizedSelector = selector.trim().replace(/^sui@/i, "")
  if (!normalizedSelector) {
    throw new Error("SUI_CLI_VERSION cannot be empty.")
  }

  return normalizedSelector
}

const shouldInstallWithSuiup = (selector) =>
  suiupSelectorSet.has(selector.toLowerCase())

const isLatestMainnetSelector = (selector) =>
  latestMainnetSelectorSet.has(selector.toLowerCase())

const isReleaseTagSelector = (selector) =>
  /^(sui|mainnet|testnet|devnet)-v.+$/i.test(selector)

const normalizeVersionSelector = (selector) => {
  const trimmedSelector = selector.trim()
  if (isReleaseTagSelector(trimmedSelector)) return trimmedSelector
  return trimmedSelector.replace(/^v/i, "")
}

const buildTagCandidatesForVersion = (selector) => {
  const normalizedVersionSelector = normalizeVersionSelector(selector)
  if (isReleaseTagSelector(normalizedVersionSelector)) {
    return [normalizedVersionSelector]
  }

  return [
    `sui-v${normalizedVersionSelector}`,
    `mainnet-v${normalizedVersionSelector}`,
    `testnet-v${normalizedVersionSelector}`,
    `devnet-v${normalizedVersionSelector}`
  ]
}

const isMainnetReleaseTag = (tag) =>
  /^mainnet-v\d+\.\d+\.\d+([-.+].*)?$/i.test(tag)

const extractVersionFromTag = (tag) => {
  const normalizedTag = String(tag || "").trim()
  const markerIndex = normalizedTag.toLowerCase().lastIndexOf("-v")
  if (markerIndex === -1) return normalizedTag
  return normalizedTag.slice(markerIndex + 2)
}

const apiHeaders = () => {
  const headers = {
    "User-Agent": "sui-cli-installer",
    Accept: "application/vnd.github+json"
  }

  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  return headers
}

const fetchReleaseByTag = async (tag) => {
  const response = await fetch(`${releaseApiBaseUrl}/releases/tags/${tag}`, {
    headers: apiHeaders()
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${response.status}`)
  }

  return response.json()
}

const fetchReleasesPage = async (page) => {
  const releasePageUrl = new URL(`${releaseApiBaseUrl}/releases`)
  releasePageUrl.searchParams.set("per_page", String(releaseQueryPageSize))
  releasePageUrl.searchParams.set("page", String(page))

  const response = await fetch(releasePageUrl, { headers: apiHeaders() })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Sui releases page ${page}: ${response.status}`
    )
  }

  const releases = await response.json()
  if (!Array.isArray(releases)) {
    throw new Error(`Unexpected releases payload for page ${page}.`)
  }

  return releases
}

const resolveReleaseForSpecificVersion = async (selector) => {
  const tagCandidates = buildTagCandidatesForVersion(selector)
  for (const candidate of tagCandidates) {
    const release = await fetchReleaseByTag(candidate)
    if (release) return { release, tag: candidate }
  }

  throw new Error(`Unable to find a Sui release for ${selector}.`)
}

const resolveLatestMainnetRelease = async () => {
  for (let page = 1; page <= releaseQueryMaxPages; page += 1) {
    const releases = await fetchReleasesPage(page)
    if (!releases.length) break

    const matchingRelease = releases.find((release) => {
      const tag = String(release?.tag_name || "")
      const isDraft = Boolean(release?.draft)
      return isMainnetReleaseTag(tag) && !isDraft
    })

    if (matchingRelease) {
      return {
        release: matchingRelease,
        tag: matchingRelease.tag_name
      }
    }

    if (releases.length < releaseQueryPageSize) break
  }

  throw new Error("Unable to find the latest mainnet Sui release.")
}

const resolveReleaseForSelector = async (selector) => {
  if (isLatestMainnetSelector(selector)) {
    return resolveLatestMainnetRelease()
  }

  return resolveReleaseForSpecificVersion(selector)
}

const isPathReadable = async (filePath) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const resolveSuiupBinaryPath = async () => {
  for (const binaryPath of suiupBinarySearchPaths) {
    if (await isPathReadable(binaryPath)) return binaryPath
  }

  try {
    const { stdout } = await execFileAsync("which", ["suiup"])
    const detectedPath = stdout.trim()
    if (detectedPath) return detectedPath
  } catch {
    return null
  }

  return null
}

const ensureCargoIsInstalled = async () => {
  try {
    await execFileAsync("cargo", ["--version"])
  } catch (error) {
    throw new Error(
      `Cargo is required to install suiup for selector "${configuredVersionSelector}".`,
      { cause: error }
    )
  }
}

const installSuiup = async () => {
  await ensureCargoIsInstalled()
  await execFileAsync("cargo", [
    "install",
    "--locked",
    "--git",
    suiupGitRepositoryUrl,
    "--branch",
    suiupGitBranch,
    "suiup"
  ])
}

const ensureSuiupBinaryPath = async () => {
  const existingSuiupBinaryPath = await resolveSuiupBinaryPath()
  if (existingSuiupBinaryPath) return existingSuiupBinaryPath

  await installSuiup()
  const installedSuiupBinaryPath = await resolveSuiupBinaryPath()
  if (!installedSuiupBinaryPath) {
    throw new Error("Failed to locate suiup after installing it with Cargo.")
  }

  return installedSuiupBinaryPath
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

const isChecksumAssetName = (name) =>
  name.includes("sha256") || name.includes("checksums")

const pickChecksumAsset = (assets, archiveAssetName) => {
  const normalizedArchiveAssetName = archiveAssetName.toLowerCase()
  const checksumCandidates = assets.filter((asset) =>
    isChecksumAssetName((asset?.name || "").toLowerCase())
  )
  if (!checksumCandidates.length) return null

  const exactMatch = checksumCandidates.find((asset) => {
    const assetName = (asset.name || "").toLowerCase()
    return (
      assetName === `${normalizedArchiveAssetName}.sha256` ||
      assetName === `${normalizedArchiveAssetName}.sha256sum` ||
      assetName === `${normalizedArchiveAssetName}.sha256sums`
    )
  })
  if (exactMatch) return exactMatch

  const likelyGlobalChecksums = checksumCandidates.find((asset) => {
    const assetName = (asset.name || "").toLowerCase()
    return assetName.includes("sha256sums") || assetName.includes("checksums")
  })
  if (likelyGlobalChecksums) return likelyGlobalChecksums

  return checksumCandidates[0]
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

const downloadAssetText = async (asset) => {
  const response = await fetch(asset.browser_download_url)
  if (!response.ok) {
    throw new Error(
      `Failed to download ${asset.browser_download_url}: ${response.status}`
    )
  }

  return response.text()
}

const parseSha256Line = (line) => {
  const trimmedLine = line.trim()
  if (!trimmedLine) return null

  const explicitMatch = trimmedLine.match(/^([a-fA-F0-9]{64})\s+[* ]?(.+)$/)
  if (explicitMatch?.[1] && explicitMatch?.[2]) {
    return {
      checksum: explicitMatch[1].toLowerCase(),
      fileName: path.basename(explicitMatch[2].trim())
    }
  }

  const bsdStyleMatch = trimmedLine.match(
    /^SHA256\s+\((.+)\)\s*=\s*([a-fA-F0-9]{64})$/
  )
  if (bsdStyleMatch?.[1] && bsdStyleMatch?.[2]) {
    return {
      checksum: bsdStyleMatch[2].toLowerCase(),
      fileName: path.basename(bsdStyleMatch[1].trim())
    }
  }

  const checksumOnlyMatch = trimmedLine.match(/^([a-fA-F0-9]{64})$/)
  if (checksumOnlyMatch?.[1]) {
    return {
      checksum: checksumOnlyMatch[1].toLowerCase(),
      fileName: undefined
    }
  }

  return null
}

const extractExpectedChecksum = ({ checksumContents, archiveAssetName }) => {
  const parsedEntries = checksumContents
    .split(/\r?\n/)
    .map(parseSha256Line)
    .filter(Boolean)
  const normalizedArchiveAssetName = archiveAssetName.toLowerCase()

  const matchingEntry = parsedEntries.find(
    (entry) => entry.fileName?.toLowerCase() === normalizedArchiveAssetName
  )
  if (matchingEntry?.checksum) return matchingEntry.checksum

  if (parsedEntries.length === 1 && parsedEntries[0]?.checksum) {
    return parsedEntries[0].checksum
  }

  return null
}

const computeSha256 = async (filePath) => {
  const hash = createHash("sha256")
  const inputStream = createReadStream(filePath)

  for await (const chunk of inputStream) {
    hash.update(chunk)
  }

  return hash.digest("hex")
}

const verifyDownloadedArchiveChecksum = async ({
  releaseAssets,
  archiveAsset,
  archivePath
}) => {
  const checksumAsset = pickChecksumAsset(releaseAssets, archiveAsset.name)
  if (!checksumAsset) {
    throw new Error(
      `No checksum asset was found for ${archiveAsset.name}; refusing to install without integrity verification.`
    )
  }

  const checksumContents = await downloadAssetText(checksumAsset)
  const expectedChecksum = extractExpectedChecksum({
    checksumContents,
    archiveAssetName: archiveAsset.name
  })
  if (!expectedChecksum) {
    throw new Error(
      `Could not resolve SHA256 checksum for ${archiveAsset.name} from ${checksumAsset.name}; refusing to install.`
    )
  }

  const actualChecksum = await computeSha256(archivePath)
  if (actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for ${archiveAsset.name}. Expected ${expectedChecksum}, got ${actualChecksum}.`
    )
  }
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

const installWithReleaseAsset = async (selector) => {
  const { release, tag } = await resolveReleaseForSelector(selector)

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
  await verifyDownloadedArchiveChecksum({
    releaseAssets: release.assets || [],
    archiveAsset: asset,
    archivePath
  })
  await extractArchive(archivePath, extractDir)

  const binaryPath = await findBinary(extractDir)
  if (!binaryPath) {
    throw new Error("Failed to locate sui binary in extracted archive.")
  }

  await mkdir(installDir, { recursive: true })
  const destination = path.join(installDir, "sui")
  await copyFile(binaryPath, destination)
  await chmod(destination, 0o755)

  const resolvedVersion = extractVersionFromTag(tag)
  console.log(
    `Installed Sui CLI ${resolvedVersion} (${tag}) to ${destination}.`
  )
}

const resolveInstalledSuiBinaryPath = async () => {
  const binaryCandidates = [
    path.join(installDir, "sui"),
    path.join(homeDirectory, ".cargo", "bin", "sui")
  ]

  for (const candidate of binaryCandidates) {
    if (await isPathReadable(candidate)) return candidate
  }

  try {
    const { stdout } = await execFileAsync("which", ["sui"])
    const detectedPath = stdout.trim()
    if (detectedPath) return detectedPath
  } catch {
    return "sui"
  }

  return "sui"
}

const ensureSuiBinaryInInstallDirectory = async (binaryPath) => {
  const installDirectoryBinaryPath = path.join(installDir, "sui")
  if (binaryPath === installDirectoryBinaryPath) {
    return installDirectoryBinaryPath
  }

  if (binaryPath === "sui") {
    return binaryPath
  }

  await mkdir(installDir, { recursive: true })
  await copyFile(binaryPath, installDirectoryBinaryPath)
  await chmod(installDirectoryBinaryPath, 0o755)
  return installDirectoryBinaryPath
}

const installWithSuiup = async (selector) => {
  const normalizedSelector = selector.toLowerCase()
  const suiupBinaryPath = await ensureSuiupBinaryPath()
  const suiupTarget = `sui@${normalizedSelector}`

  await execFileAsync(suiupBinaryPath, ["install", "-y", suiupTarget], {
    env: process.env
  })
  await execFileAsync(suiupBinaryPath, ["switch", suiupTarget], {
    env: process.env
  })

  const resolvedSuiBinaryPath = await resolveInstalledSuiBinaryPath()
  const suiBinaryPath = await ensureSuiBinaryInInstallDirectory(
    resolvedSuiBinaryPath
  )
  const { stdout, stderr } = await execFileAsync(suiBinaryPath, ["--version"], {
    env: process.env
  })
  const resolvedVersion = `${stdout}${stderr}`.trim()
  if (!resolvedVersion) {
    throw new Error(
      `Installed Sui CLI with suiup target ${suiupTarget}, but --version produced no output.`
    )
  }

  console.log(
    `Installed Sui CLI via suiup target ${suiupTarget}: ${resolvedVersion}.`
  )
}

const install = async () => {
  const normalizedSelector = normalizeVersionSelectorInput(
    configuredVersionSelector
  )

  if (shouldInstallWithSuiup(normalizedSelector)) {
    await installWithSuiup(normalizedSelector)
    return
  }

  await installWithReleaseAsset(normalizedSelector)
}

install().catch((error) => {
  console.error(error)
  process.exit(1)
})
