import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';

type LoadKeypairOptions = {
  keystorePath?: string;
  accountIndex: number;
  envPrivateKey?: string | null;
  envMnemonic?: string | null;
};

export async function loadKeypair(options: LoadKeypairOptions) {
  const envPrivateKey = options.envPrivateKey ?? null;
  if (envPrivateKey) {
    return keypairFromSecret(envPrivateKey);
  }

  const envMnemonic = options.envMnemonic ?? null;
  if (envMnemonic) {
    return Ed25519Keypair.deriveKeypair(envMnemonic);
  }

  const keystorePath =
    options.keystorePath ?? path.join(os.homedir(), '.sui', 'sui_config', 'sui.keystore');

  const keystoreRaw = await fs.readFile(keystorePath, 'utf8');
  const entries: string[] = JSON.parse(keystoreRaw);
  const entry = entries[options.accountIndex];
  if (!entry) {
    throw new Error(
      `Keystore entry at index ${options.accountIndex} not found in ${keystorePath}.`,
    );
  }

  return keypairFromSecret(entry);
}

function keypairFromSecret(secret: string) {
  const decoded = decodeSuiPrivateKey(secret.trim());
  if (decoded.schema !== 'ED25519') {
    throw new Error('Only ED25519 keys are supported for publishing.');
  }
  return Ed25519Keypair.fromSecretKey(decoded.secretKey);
}
