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
 * Why: Sui uses explicit key material for signing PTBs; this mirrors EVM-style deployer wallets
 * while supporting the Sui CLI keystore format for local workflows.
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

const readKeystoreEntries = async (keystorePath: string): Promise<string[]> =>
  JSON.parse(await readFile(keystorePath, "utf8"))

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

const listKeystoreAddresses = async (keystoreEntries: string[]) => {
  const entriesWithAddress = await Promise.all(
    keystoreEntries.map(async (entry, index) => {
      const keypair = await keypairFromSecret(entry)
      return `[${index}] ${normalizeSuiAddress(keypair.toSuiAddress())}`
    })
  )

  return entriesWithAddress
}

const isBech32PrivateKey = (value: string): boolean =>
  value.startsWith("suiprivkey1")

const keypairFromBech32 = (bech32Key: string): Ed25519Keypair => {
  const decoded = decodeSuiPrivateKey(bech32Key.trim())
  if (decoded.schema !== "ED25519")
    throw new Error(`Unsupported key scheme ${decoded.schema}.`)

  return Ed25519Keypair.fromSecretKey(decoded.secretKey)
}

const keypairFromSecret = async (secret: string) => {
  const normalizedSecret = secret.trim()

  if (isBech32PrivateKey(normalizedSecret))
    return keypairFromBech32(normalizedSecret)

  const decoded = fromBase64(normalizedSecret)
  const scheme = decoded[0]

  if (scheme !== SIGNATURE_SCHEME_TO_FLAG.ED25519)
    throw new Error(`Unsupported key scheme ${scheme}.`)

  return Ed25519Keypair.fromSecretKey(decoded.slice(1))
}
