import { readFile } from "node:fs/promises"

import {
  decodeSuiPrivateKey,
  SIGNATURE_SCHEME_TO_FLAG
} from "@mysten/sui/cryptography"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils"
import type { SuiAccountConfig } from "./config.ts"

/**
 * Loads an Ed25519 keypair from env/config (private key, mnemonic, or Sui keystore).
 * Sui uses explicit key material for signing PTBs, and the CLI keystore is the common local source.
 */
export const loadKeypair = async ({
  accountPrivateKey,
  accountMnemonic,
  keystorePath,
  accountIndex,
  accountAddress
}: SuiAccountConfig) => {
  if (accountPrivateKey) return keypairFromSecret(accountPrivateKey)
  if (accountMnemonic) return Ed25519Keypair.deriveKeypair(accountMnemonic)

  if (keystorePath) {
    const keystoreEntries = await readKeystoreEntries(keystorePath)

    if (accountAddress) {
      const keypair = await getKeystoreKeypairByAddress(
        keystoreEntries,
        accountAddress
      )

      if (keypair) return keypair

      const availableEntries = await listKeystoreAddresses(keystoreEntries)

      throw new Error(
        `Address ${accountAddress} not found in ${keystorePath}.\nAvailable keystore entries:\n${availableEntries.join(
          "\n"
        )}`
      )
    }

    if (accountIndex?.toString())
      return keypairFromSecret(
        getKeystoreEntry(keystoreEntries, accountIndex, keystorePath)
      )
  }

  throw new Error(
    `Could not get keypair from\nPrivate Key: ${accountPrivateKey}\nMnemonic: ${accountMnemonic}\nKeystore path: ${keystorePath}\nAccount Index: ${accountIndex}\nAccount Address: ${accountAddress}\nEnsure you are using either a private key, mnemonic or keystore to properly load keypair`
  )
}

/**
 * Retrieves a specific entry from the Sui keystore by index.
 */
const getKeystoreEntry = (
  keystoreEntries: string[],
  accountIndex: number,
  keystorePath?: string
) => {
  const accountEntry = keystoreEntries[accountIndex]

  if (!accountEntry)
    throw new Error(
      `Keystore entry at index ${accountIndex} not found in ${
        keystorePath || "keystore"
      }.`
    )

  return accountEntry
}

/**
 * Reads and parses the Sui keystore JSON file.
 */
export const readKeystoreEntries = async (
  keystorePath: string
): Promise<string[]> => {
  const contents = await readFile(keystorePath, "utf8")
  const parsed = JSON.parse(contents)

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Unexpected keystore format at ${keystorePath}; expected JSON array.`
    )
  }

  return parsed
}

/**
 * Builds a base64 keystore entry for the provided keypair.
 */
export const buildKeystoreEntry = (keypair: Ed25519Keypair): string => {
  const decoded = decodeSuiPrivateKey(keypair.getSecretKey())
  const schemeFlag = SIGNATURE_SCHEME_TO_FLAG[decoded.scheme]

  if (typeof schemeFlag !== "number")
    throw new Error(`Unsupported key scheme ${decoded.scheme}.`)

  const payload = new Uint8Array(decoded.secretKey.length + 1)
  payload[0] = schemeFlag
  payload.set(decoded.secretKey, 1)

  return Buffer.from(payload).toString("base64")
}

/**
 * Finds a keystore entry matching a target Sui address.
 */
const getKeystoreKeypairByAddress = async (
  keystoreEntries: string[],
  accountAddress: string
) => {
  const normalizedTarget = normalizeSuiAddress(accountAddress)

  for (const entry of keystoreEntries) {
    const keypair = await keypairFromSecret(entry)
    if (normalizeSuiAddress(keypair.toSuiAddress()) === normalizedTarget)
      return keypair
  }

  return undefined
}

/**
 * Lists available keystore addresses with their index.
 */
const listKeystoreAddresses = async (keystoreEntries: string[]) => {
  const entriesWithAddress = await Promise.all(
    keystoreEntries.map(async (entry, index) => {
      const keypair = await keypairFromSecret(entry)
      return `[${index}] ${normalizeSuiAddress(keypair.toSuiAddress())}`
    })
  )

  return entriesWithAddress
}

/**
 * Detects the bech32-encoded Sui private key format.
 */
const isBech32PrivateKey = (value: string): boolean =>
  value.startsWith("suiprivkey1")

/**
 * Detects a hex-encoded private key (plain or 0x-prefixed).
 */
const isHexPrivateKey = (value: string): boolean =>
  /^(0x)?[0-9a-fA-F]+$/.test(value)

/**
 * Builds an Ed25519 keypair from a bech32 Sui private key.
 */
const keypairFromBech32 = (bech32Key: string): Ed25519Keypair => {
  const decoded = decodeSuiPrivateKey(bech32Key.trim())
  if (decoded.scheme !== "ED25519")
    throw new Error(`Unsupported key scheme ${decoded.scheme}.`)

  return Ed25519Keypair.fromSecretKey(decoded.secretKey)
}

/**
 * Builds an Ed25519 keypair from a hex-encoded private key.
 * Accepts 32-byte raw secret keys or 33-byte scheme+secret payloads.
 */
const keypairFromHex = (hexKey: string): Ed25519Keypair => {
  const stripped = hexKey.startsWith("0x") ? hexKey.slice(2) : hexKey

  if (stripped.length % 2 !== 0)
    throw new Error(`Invalid hex private key length ${stripped.length}.`)

  const bytes = Uint8Array.from(Buffer.from(stripped, "hex"))

  if (bytes.length === 32) return Ed25519Keypair.fromSecretKey(bytes)

  if (bytes.length === 33) {
    if (bytes[0] !== SIGNATURE_SCHEME_TO_FLAG.ED25519)
      throw new Error(`Unsupported key scheme ${bytes[0]}.`)

    return Ed25519Keypair.fromSecretKey(bytes.slice(1))
  }

  throw new Error(
    `Invalid hex private key length ${bytes.length}; expected 32 or 33 bytes.`
  )
}

/**
 * Builds an Ed25519 keypair from either bech32, hex, or base64 secret key material.
 */
const keypairFromSecret = async (secret: string) => {
  const normalizedSecret = secret.trim()

  if (isBech32PrivateKey(normalizedSecret))
    return keypairFromBech32(normalizedSecret)

  if (isHexPrivateKey(normalizedSecret))
    return keypairFromHex(normalizedSecret)

  const decoded = fromBase64(normalizedSecret)
  const scheme = decoded[0]

  if (scheme !== SIGNATURE_SCHEME_TO_FLAG.ED25519)
    throw new Error(`Unsupported key scheme ${scheme}.`)

  return Ed25519Keypair.fromSecretKey(decoded.slice(1))
}
