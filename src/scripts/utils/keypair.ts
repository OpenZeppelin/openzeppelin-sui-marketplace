import { readFile } from "node:fs/promises";

import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";

type LoadKeypairOptions = {
  keystorePath?: string;
  accountIndex?: number;
  accountAddress?: string;
  privateKey?: string;
  mnemonic?: string;
};
/**
 * Loads the keypair used for publishing and seeding mock data.
 */
export const loadDeployerKeypair = async ({
  keystorePath,
  accountIndex,
  accountAddress,
}: {
  keystorePath: string;
  accountIndex: number;
  accountAddress?: string;
}) => {
  return loadKeypair({
    keystorePath,
    accountIndex,
    accountAddress,
    privateKey:
      process.env.SUI_DEPLOYER_PRIVATE_KEY ??
      process.env.SUI_PRIVATE_KEY ??
      process.env.PRIVATE_KEY,
    mnemonic:
      process.env.SUI_DEPLOYER_MNEMONIC ??
      process.env.SUI_MNEMONIC ??
      process.env.MNEMONIC,
  });
};

export const loadKeypair = async ({
  privateKey,
  mnemonic,
  keystorePath,
  accountIndex,
  accountAddress,
}: LoadKeypairOptions) => {
  if (privateKey) return keypairFromSecret(privateKey);
  if (mnemonic) return Ed25519Keypair.deriveKeypair(mnemonic);

  if (keystorePath) {
    const keystoreEntries = await readKeystoreEntries(keystorePath);

    if (accountAddress) {
      const keypair = await getKeystoreKeypairByAddress(
        keystoreEntries,
        accountAddress
      );

      if (keypair) return keypair;

      const availableEntries = await listKeystoreAddresses(keystoreEntries);
      throw new Error(
        `Address ${accountAddress} not found in ${keystorePath}.\nAvailable keystore entries:\n${availableEntries.join(
          "\n"
        )}`
      );
    }

    if (accountIndex?.toString())
      return keypairFromSecret(
        getKeystoreEntry(keystoreEntries, accountIndex, keystorePath)
      );
  }

  throw new Error(
    `Could not get keypair from\nPrivate Key: ${privateKey}\nMnemonic: ${mnemonic}\nKeystore path: ${keystorePath}\nAccount Index: ${accountIndex}\nAccount Address: ${accountAddress}\nEnsure you are using either a private key, mnemonic or keystore to properly load keypair`
  );
};

const getKeystoreEntry = (
  keystoreEntries: string[],
  accountIndex: number,
  keystorePath?: string
) => {
  const accountEntry = keystoreEntries[accountIndex];

  if (!accountEntry)
    throw new Error(
      `Keystore entry at index ${accountIndex} not found in ${
        keystorePath || "keystore"
      }.`
    );

  return accountEntry;
};

const readKeystoreEntries = async (keystorePath: string): Promise<string[]> => {
  const keystoreRaw = await readFile(keystorePath, "utf8");
  return JSON.parse(keystoreRaw);
};

const getKeystoreKeypairByAddress = async (
  keystoreEntries: string[],
  accountAddress: string
) => {
  const normalizedTarget = normalizeSuiAddress(accountAddress);

  for (const entry of keystoreEntries) {
    const keypair = await keypairFromSecret(entry);
    if (normalizeSuiAddress(keypair.toSuiAddress()) === normalizedTarget)
      return keypair;
  }

  return undefined;
};

const listKeystoreAddresses = async (keystoreEntries: string[]) => {
  const entriesWithAddress = await Promise.all(
    keystoreEntries.map(async (entry, index) => {
      const keypair = await keypairFromSecret(entry);
      return `[${index}] ${normalizeSuiAddress(keypair.toSuiAddress())}`;
    })
  );

  return entriesWithAddress;
};

const isBech32PrivateKey = (value: string): boolean =>
  value.startsWith("suiprivkey1");

const keypairFromBech32 = (bech32Key: string): Ed25519Keypair => {
  const decoded = decodeSuiPrivateKey(bech32Key.trim());

  return Ed25519Keypair.fromSecretKey(decoded.secretKey);
};

const keypairFromSecret = async (secret: string) => {
  if (isBech32PrivateKey(secret)) return keypairFromBech32(secret);

  return Ed25519Keypair.fromSecretKey(fromBase64(secret.trim().slice(1)));
};
