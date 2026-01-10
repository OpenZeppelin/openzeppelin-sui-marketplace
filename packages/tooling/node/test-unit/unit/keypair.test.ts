import { describe, expect, it } from "vitest"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { SIGNATURE_SCHEME_TO_FLAG } from "@mysten/sui/cryptography"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import {
  withTempDir,
  writeFileTree
} from "../../../tests-integration/helpers/fs.ts"
import { buildKeystoreEntry, loadKeypair } from "../../src/keypair.ts"

const buildBase64Secret = (seed: number) => {
  const secretKey = new Uint8Array(32).fill(seed)
  const payload = new Uint8Array(33)
  payload[0] = SIGNATURE_SCHEME_TO_FLAG.ED25519
  payload.set(secretKey, 1)
  return { secretKey, secretBase64: Buffer.from(payload).toString("base64") }
}

describe("loadKeypair", () => {
  it("loads a keypair from a base64 private key", async () => {
    const { secretKey, secretBase64 } = buildBase64Secret(7)
    const expectedAddress =
      Ed25519Keypair.fromSecretKey(secretKey).toSuiAddress()

    const keypair = await loadKeypair({ accountPrivateKey: secretBase64 })

    expect(normalizeSuiAddress(keypair.toSuiAddress())).toBe(
      normalizeSuiAddress(expectedAddress)
    )
  })

  it("loads a keypair from keystore index", async () => {
    const { secretBase64 } = buildBase64Secret(9)

    await withTempDir(async (dir) => {
      const keystorePath = `${dir}/sui.keystore`
      await writeFileTree(dir, {
        "sui.keystore": JSON.stringify([secretBase64], undefined, 2)
      })

      const keypair = await loadKeypair({
        keystorePath,
        accountIndex: 0
      })

      expect(keypair.toSuiAddress()).toMatch(/^0x[0-9a-fA-F]{64}$/)
    })
  })

  it("builds a keystore entry that loads back into a keypair", async () => {
    const secretKey = new Uint8Array(32).fill(13)
    const keypair = Ed25519Keypair.fromSecretKey(secretKey)
    const entry = buildKeystoreEntry(keypair)

    await withTempDir(async (dir) => {
      const keystorePath = `${dir}/sui.keystore`
      await writeFileTree(dir, {
        "sui.keystore": JSON.stringify([entry], undefined, 2)
      })

      const loaded = await loadKeypair({ keystorePath, accountIndex: 0 })

      expect(normalizeSuiAddress(loaded.toSuiAddress())).toBe(
        normalizeSuiAddress(keypair.toSuiAddress())
      )
    })
  })

  it("throws when an unsupported key scheme is provided", async () => {
    const secretKey = new Uint8Array(32).fill(1)
    const payload = new Uint8Array(33)
    payload[0] = 99
    payload.set(secretKey, 1)
    const invalidSecret = Buffer.from(payload).toString("base64")

    await expect(
      loadKeypair({ accountPrivateKey: invalidSecret })
    ).rejects.toThrow("Unsupported key scheme")
  })

  it("throws when the requested keystore address is missing", async () => {
    const { secretBase64 } = buildBase64Secret(11)

    await withTempDir(async (dir) => {
      const keystorePath = `${dir}/sui.keystore`
      await writeFileTree(dir, {
        "sui.keystore": JSON.stringify([secretBase64], undefined, 2)
      })

      await expect(
        loadKeypair({
          keystorePath,
          accountAddress: "0x2"
        })
      ).rejects.toThrow("Address 0x2 not found")
    })
  })
})
