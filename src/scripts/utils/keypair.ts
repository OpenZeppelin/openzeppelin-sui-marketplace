import { readFile } from "node:fs/promises";

import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";

type LoadKeypairOptions = {
  keystorePath?: string;
  accountIndex?: number;
  privateKey?: string;
  mnemonic?: string;
};

export const loadKeypair = async ({
  privateKey,
  mnemonic,
  keystorePath,
  accountIndex,
}: LoadKeypairOptions) => {
  if (privateKey) return keypairFromSecret(privateKey);
  if (mnemonic) return Ed25519Keypair.deriveKeypair(mnemonic);

  if (keystorePath && accountIndex?.toString())
    return keypairFromSecret(
      await getKeystoreEntry(keystorePath, accountIndex)
    );

  throw new Error(
    `Could not get keypair from\nPrivate Key: ${privateKey}\nMnemonic: ${mnemonic}\nKeystore path: ${keystorePath}\nAccount Index: ${accountIndex}\nEnsure you are using either a private key, mnemonic or keystore to properly load keypair`
  );
};

const getKeystoreEntry = async (keystorePath: string, accountIndex: number) => {
  const keystoreRaw = await readFile(keystorePath, "utf8");

  const keystoreEntries: string[] = JSON.parse(keystoreRaw);
  const accountEntry = keystoreEntries[accountIndex];

  if (!accountEntry)
    throw new Error(
      `Keystore entry at index ${accountIndex} not found in ${keystorePath}.`
    );

  return accountEntry;
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
