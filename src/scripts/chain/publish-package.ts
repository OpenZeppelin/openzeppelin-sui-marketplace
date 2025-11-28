import 'dotenv/config';
import path from 'node:path';

import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { SuiClient } from '@mysten/sui.js/client';
import { ensureSuiCli } from '../utils/suiCli';
import { resolveRpcUrl, buildExplorerUrl } from '../utils/network';
import { loadKeypair } from '../utils/keypair';
import { buildMovePackage } from '../utils/move';
import { publishPackage } from '../utils/publish';
import { writeArtifact } from '../utils/artifacts';
import { formatKV } from '../utils/log';
import type { NetworkName, PublishArtifact } from '../utils/types';

async function main() {
  const args = await yargs(hideBin(process.argv))
    .scriptName('publish-package')
    .option('network', {
      type: 'string',
      description: 'Target Sui network',
      choices: ['localnet', 'devnet', 'testnet', 'mainnet', 'custom'],
      default: process.env.SUI_NETWORK ?? 'localnet',
    })
    .option('rpc-url', {
      type: 'string',
      description: 'Custom RPC URL (required when network=custom)',
      default: process.env.SUI_RPC_URL,
    })
    .option('package-path', {
      alias: ['path', 'p'],
      type: 'string',
      description: 'Path to the Move package to publish',
      default: path.join(process.cwd(), 'move'),
    })
    .option('gas-budget', {
      type: 'number',
      description: 'Gas budget (in MIST) for the publish transaction',
      default: 200_000_000,
    })
    .option('keystore', {
      type: 'string',
      description: 'Path to a Sui keystore file (defaults to CLI keystore)',
      default: process.env.SUI_KEYSTORE_PATH,
    })
    .option('account-index', {
      type: 'number',
      description: 'Account index to use from the keystore when no env key is set',
      default: 0,
    })
    .option('artifact', {
      type: 'string',
      description: 'Path to write deployment artifact JSON',
    })
    .strict()
    .help()
    .parseAsync();

  const rpcUrl = resolveRpcUrl(args.network as NetworkName, args['rpc-url']);
  const packagePath = path.resolve(args['package-path']);
  const gasBudget = args['gas-budget'];
  const artifactPath =
    args.artifact ??
    path.join(process.cwd(), 'chain', 'deployments', `deployment.${args.network}.json`);

  console.log(chalk.cyan('🚀 Publishing package'));
  console.log(formatKV('network', args.network));
  console.log(formatKV('rpc', rpcUrl));
  console.log(formatKV('package', packagePath));
  console.log(formatKV('artifact', artifactPath));

  await ensureSuiCli();

  const keypair = await loadKeypair({
    keystorePath: args.keystore,
    accountIndex: args['account-index'],
    envPrivateKey:
      process.env.SUI_DEPLOYER_PRIVATE_KEY ??
      process.env.SUI_PRIVATE_KEY ??
      process.env.PRIVATE_KEY ??
      null,
    envMnemonic:
      process.env.SUI_DEPLOYER_MNEMONIC ??
      process.env.SUI_MNEMONIC ??
      process.env.MNEMONIC ??
      null,
  });
  const publisher = keypair.toSuiAddress();
  console.log(formatKV('publisher', publisher));

  const buildOutput = await buildMovePackage(packagePath);
  console.log(formatKV('modules', buildOutput.modules.length));

  const client = new SuiClient({ url: rpcUrl });
  const publishResult = await publishPackage({
    client,
    keypair,
    buildOutput,
    gasBudget,
  });

  const artifact: PublishArtifact = {
    network: args.network,
    rpcUrl,
    packagePath,
    packageId: publishResult.packageId,
    upgradeCap: publishResult.upgradeCap,
    sender: publisher,
    digest: publishResult.digest,
    publishedAt: new Date().toISOString(),
    modules: buildOutput.modules,
    dependencies: buildOutput.dependencies,
    explorerUrl: buildExplorerUrl(publishResult.digest, args.network as NetworkName),
  };

  await writeArtifact(artifactPath, artifact);

  console.log(chalk.green('\n✅ Publish succeeded'));
  console.log(formatKV('packageId', publishResult.packageId));
  if (publishResult.upgradeCap) {
    console.log(formatKV('upgradeCap', publishResult.upgradeCap));
  }
  console.log(formatKV('digest', publishResult.digest));
  if (artifact.explorerUrl) {
    console.log(formatKV('explorer', artifact.explorerUrl));
  }
}

main().catch((error) => {
  console.error(chalk.red('\nPublish failed'));
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
