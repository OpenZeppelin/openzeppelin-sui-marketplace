import fs from 'node:fs/promises';
import path from 'node:path';
import type { PublishArtifact } from './types';

export async function writeArtifact(filePath: string, artifact: PublishArtifact) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(artifact, null, 2));
}
