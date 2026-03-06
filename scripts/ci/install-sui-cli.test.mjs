#!/usr/bin/env node
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const currentFilePath = fileURLToPath(import.meta.url)
const currentDirectoryPath = path.dirname(currentFilePath)
const repositoryRoot = path.resolve(currentDirectoryPath, "..", "..")
const installerScriptPath = path.join(
  repositoryRoot,
  "scripts",
  "ci",
  "install-sui-cli.mjs"
)

const resolveOperatingSystemAssetHint = () => {
  switch (process.platform) {
    case "linux":
      return "linux"
    case "darwin":
      return "darwin"
    default:
      return process.platform
  }
}

const resolveArchitectureAssetHint = () => {
  switch (process.arch) {
    case "x64":
      return "x86_64"
    case "arm64":
      return "arm64"
    default:
      return process.arch
  }
}

const normalizeTagForFileName = (tag) => tag.replaceAll(/[^a-zA-Z0-9._-]/g, "-")

const createReleaseAssets = async ({
  workspaceDirectoryPath,
  releaseTag
}) => {
  const releaseDirectoryPath = path.join(
    workspaceDirectoryPath,
    normalizeTagForFileName(releaseTag)
  )
  const archiveStagingDirectoryPath = path.join(releaseDirectoryPath, "archive")
  const archiveBinaryDirectoryPath = path.join(archiveStagingDirectoryPath, "bin")
  await mkdir(archiveBinaryDirectoryPath, { recursive: true })

  const binaryPayload = `#!/usr/bin/env sh\necho "${releaseTag}"\n`
  const binaryPath = path.join(archiveBinaryDirectoryPath, "sui")
  await writeFile(binaryPath, binaryPayload)
  await chmod(binaryPath, 0o755)

  const archiveName = `sui-${normalizeTagForFileName(
    releaseTag
  )}-${resolveOperatingSystemAssetHint()}-${resolveArchitectureAssetHint()}.tgz`
  const archivePath = path.join(releaseDirectoryPath, archiveName)
  await execFileAsync("tar", ["-czf", archivePath, "-C", archiveStagingDirectoryPath, "."])

  const archiveBuffer = await readFile(archivePath)
  const archiveChecksum = createHash("sha256").update(archiveBuffer).digest("hex")
  const checksumName = `${archiveName}.sha256`
  const checksumPath = path.join(releaseDirectoryPath, checksumName)
  await writeFile(checksumPath, `${archiveChecksum}  ${archiveName}\n`)

  return {
    releaseTag,
    archiveName,
    archivePath,
    archiveChecksum,
    checksumName,
    checksumPath,
    binaryPayload
  }
}

const createJsonResponseWriter =
  (response) =>
  (statusCode, payload) => {
    response.statusCode = statusCode
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify(payload))
  }

const createMockReleaseServer = async ({
  releaseAssetRecords,
  releasesFeedTags,
  includeChecksumAssets = true,
  includeAssetDigest = false
}) => {
  const releaseAssetRecordByTag = new Map(
    releaseAssetRecords.map((record) => [record.releaseTag, record])
  )

  const downloadPayloadByFileName = new Map()
  for (const record of releaseAssetRecords) {
    downloadPayloadByFileName.set(record.archiveName, await readFile(record.archivePath))
    if (includeChecksumAssets) {
      downloadPayloadByFileName.set(
        record.checksumName,
        await readFile(record.checksumPath)
      )
    }
  }

  let serverBaseUrl = ""
  const buildReleasePayloadForTag = (releaseTag) => {
    const record = releaseAssetRecordByTag.get(releaseTag)
    if (!record) return null
    const archiveDownloadUrl = `${serverBaseUrl}/downloads/${encodeURIComponent(
      record.archiveName
    )}`
    const checksumDownloadUrl = `${serverBaseUrl}/downloads/${encodeURIComponent(
      record.checksumName
    )}`
    const archiveAsset = {
      name: record.archiveName,
      browser_download_url: archiveDownloadUrl
    }
    if (includeAssetDigest) {
      archiveAsset.digest = `sha256:${record.archiveChecksum}`
    }

    const assets = [archiveAsset]
    if (includeChecksumAssets) {
      assets.push({
        name: record.checksumName,
        browser_download_url: checksumDownloadUrl
      })
    }

    return {
      tag_name: releaseTag,
      draft: false,
      prerelease: false,
      assets
    }
  }

  const server = createServer((request, response) => {
    const writeJsonResponse = createJsonResponseWriter(response)
    const requestUrl = new URL(request.url || "/", serverBaseUrl || "http://127.0.0.1")

    if (request.method !== "GET") {
      writeJsonResponse(405, { error: "Method not allowed." })
      return
    }

    if (requestUrl.pathname.startsWith("/repos/MystenLabs/sui/releases/tags/")) {
      const requestedTag = decodeURIComponent(
        requestUrl.pathname.replace("/repos/MystenLabs/sui/releases/tags/", "")
      )
      const releasePayload = buildReleasePayloadForTag(requestedTag)
      if (!releasePayload) {
        writeJsonResponse(404, { error: "Release not found." })
        return
      }

      writeJsonResponse(200, releasePayload)
      return
    }

    if (requestUrl.pathname === "/repos/MystenLabs/sui/releases") {
      const releasesPayload = releasesFeedTags
        .map((releaseTag) => buildReleasePayloadForTag(releaseTag))
        .filter(Boolean)
      writeJsonResponse(200, releasesPayload)
      return
    }

    if (requestUrl.pathname.startsWith("/downloads/")) {
      const requestedFileName = decodeURIComponent(
        requestUrl.pathname.replace("/downloads/", "")
      )
      const filePayload = downloadPayloadByFileName.get(requestedFileName)
      if (!filePayload) {
        response.statusCode = 404
        response.end("Not found")
        return
      }

      response.statusCode = 200
      response.setHeader("content-type", "application/octet-stream")
      response.end(filePayload)
      return
    }

    response.statusCode = 404
    response.end("Not found")
  })

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })

  const serverAddress = server.address()
  if (!serverAddress || typeof serverAddress === "string") {
    throw new Error("Failed to start mock release server.")
  }

  serverBaseUrl = `http://127.0.0.1:${serverAddress.port}`

  return {
    releaseApiBaseUrl: `${serverBaseUrl}/repos/MystenLabs/sui`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}

const runInstallerScript = async ({
  releaseApiBaseUrl,
  installDirectoryPath,
  selector
}) => {
  const commandEnvironment = {
    ...process.env,
    HOME: installDirectoryPath,
    SUI_CLI_INSTALL_DIR: installDirectoryPath,
    SUI_CLI_GITHUB_API_BASE_URL: releaseApiBaseUrl
  }

  if (selector !== undefined) {
    commandEnvironment.SUI_CLI_VERSION = selector
  } else {
    delete commandEnvironment.SUI_CLI_VERSION
  }

  return execFileAsync("node", [installerScriptPath], {
    cwd: repositoryRoot,
    env: commandEnvironment
  })
}

const createTestContext = async ({
  releaseTags,
  releasesFeedTags,
  includeChecksumAssets,
  includeAssetDigest
}) => {
  const workspaceDirectoryPath = await mkdtemp(
    path.join(tmpdir(), "install-sui-cli-test-")
  )
  const releaseAssetRecords = await Promise.all(
    releaseTags.map((releaseTag) =>
      createReleaseAssets({ workspaceDirectoryPath, releaseTag })
    )
  )
  const mockReleaseServer = await createMockReleaseServer({
    releaseAssetRecords,
    releasesFeedTags,
    includeChecksumAssets,
    includeAssetDigest
  })

  const cleanup = async () => {
    await mockReleaseServer.close()
    await rm(workspaceDirectoryPath, { recursive: true, force: true })
  }

  return {
    workspaceDirectoryPath,
    releaseApiBaseUrl: mockReleaseServer.releaseApiBaseUrl,
    cleanup
  }
}

test("installs a specific Sui CLI version selector", async () => {
  const requestedVersion = "1.2.3"
  const releaseTag = `sui-v${requestedVersion}`
  const testContext = await createTestContext({
    releaseTags: [releaseTag],
    releasesFeedTags: [releaseTag]
  })

  try {
    const installDirectoryPath = path.join(
      testContext.workspaceDirectoryPath,
      "specific-version-install"
    )
    await mkdir(installDirectoryPath, { recursive: true })

    const { stdout } = await runInstallerScript({
      releaseApiBaseUrl: testContext.releaseApiBaseUrl,
      installDirectoryPath,
      selector: requestedVersion
    })
    const installedBinaryPath = path.join(installDirectoryPath, "sui")
    const installedBinaryContents = await readFile(installedBinaryPath, "utf8")

    assert.match(installedBinaryContents, new RegExp(releaseTag))
    assert.match(stdout, new RegExp(`\\(${releaseTag}\\)`))
  } finally {
    await testContext.cleanup()
  }
})

test("installs the latest mainnet Sui CLI release", async () => {
  const latestMainnetTag = "mainnet-v9.8.7"
  const newerTestnetTag = "testnet-v99.0.0"
  const olderMainnetTag = "mainnet-v9.8.6"

  const testContext = await createTestContext({
    releaseTags: [latestMainnetTag, newerTestnetTag, olderMainnetTag],
    releasesFeedTags: [newerTestnetTag, latestMainnetTag, olderMainnetTag]
  })

  try {
    const installDirectoryPath = path.join(
      testContext.workspaceDirectoryPath,
      "latest-mainnet-install"
    )
    await mkdir(installDirectoryPath, { recursive: true })

    const { stdout } = await runInstallerScript({
      releaseApiBaseUrl: testContext.releaseApiBaseUrl,
      installDirectoryPath,
      selector: "latest-mainnet"
    })
    const installedBinaryPath = path.join(installDirectoryPath, "sui")
    const installedBinaryContents = await readFile(installedBinaryPath, "utf8")

    assert.match(installedBinaryContents, new RegExp(latestMainnetTag))
    assert.match(stdout, new RegExp(`\\(${latestMainnetTag}\\)`))
    assert.doesNotMatch(installedBinaryContents, new RegExp(olderMainnetTag))
  } finally {
    await testContext.cleanup()
  }
})

test("defaults to latest mainnet when selector is omitted", async () => {
  const latestMainnetTag = "mainnet-v10.1.0"
  const nonMainnetTag = "testnet-v100.0.0"

  const testContext = await createTestContext({
    releaseTags: [latestMainnetTag, nonMainnetTag],
    releasesFeedTags: [nonMainnetTag, latestMainnetTag]
  })

  try {
    const installDirectoryPath = path.join(
      testContext.workspaceDirectoryPath,
      "default-mainnet-install"
    )
    await mkdir(installDirectoryPath, { recursive: true })

    const { stdout } = await runInstallerScript({
      releaseApiBaseUrl: testContext.releaseApiBaseUrl,
      installDirectoryPath
    })
    const installedBinaryPath = path.join(installDirectoryPath, "sui")
    const installedBinaryContents = await readFile(installedBinaryPath, "utf8")

    assert.match(installedBinaryContents, new RegExp(latestMainnetTag))
    assert.match(stdout, new RegExp(`\\(${latestMainnetTag}\\)`))
  } finally {
    await testContext.cleanup()
  }
})

test("installs when release provides digest metadata without checksum assets", async () => {
  const releaseTag = "testnet-v1.67.1"
  const testContext = await createTestContext({
    releaseTags: [releaseTag],
    releasesFeedTags: [releaseTag],
    includeChecksumAssets: false,
    includeAssetDigest: true
  })

  try {
    const installDirectoryPath = path.join(
      testContext.workspaceDirectoryPath,
      "digest-only-install"
    )
    await mkdir(installDirectoryPath, { recursive: true })

    const { stdout } = await runInstallerScript({
      releaseApiBaseUrl: testContext.releaseApiBaseUrl,
      installDirectoryPath,
      selector: releaseTag
    })
    const installedBinaryPath = path.join(installDirectoryPath, "sui")
    const installedBinaryContents = await readFile(installedBinaryPath, "utf8")

    assert.match(installedBinaryContents, new RegExp(releaseTag))
    assert.match(stdout, new RegExp(`\\(${releaseTag}\\)`))
  } finally {
    await testContext.cleanup()
  }
})

test("fails when no checksum asset and no digest metadata is available", async () => {
  const releaseTag = "testnet-v1.67.2"
  const testContext = await createTestContext({
    releaseTags: [releaseTag],
    releasesFeedTags: [releaseTag],
    includeChecksumAssets: false,
    includeAssetDigest: false
  })

  try {
    const installDirectoryPath = path.join(
      testContext.workspaceDirectoryPath,
      "missing-integrity-install"
    )
    await mkdir(installDirectoryPath, { recursive: true })

    await assert.rejects(
      runInstallerScript({
        releaseApiBaseUrl: testContext.releaseApiBaseUrl,
        installDirectoryPath,
        selector: releaseTag
      }),
      /No checksum asset or digest metadata was found/
    )
  } finally {
    await testContext.cleanup()
  }
})
