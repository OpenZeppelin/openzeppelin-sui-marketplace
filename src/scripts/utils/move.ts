import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import type { BuildOutput } from './types';

const execFile = promisify(execFileCallback);

export async function buildMovePackage(pkgPath: string): Promise<BuildOutput> {
  const { stdout, stderr } = await execFile('sui', [
    'move',
    'build',
    '--dump-bytecode-as-base64',
    '--path',
    pkgPath,
    '--json',
  ]);

  if (stderr?.trim()) {
    console.warn(chalk.yellow('sui move build warnings:\n'), stderr.trim());
  }

  const jsonLine = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop();

  if (!jsonLine) {
    throw new Error('No JSON output received from `sui move build`.');
  }

  const parsed = JSON.parse(jsonLine);
  if (!Array.isArray(parsed.modules) || !Array.isArray(parsed.dependencies)) {
    throw new Error('Unexpected build output. Ensure the package builds correctly.');
  }

  return {
    modules: parsed.modules,
    dependencies: parsed.dependencies,
  };
}
