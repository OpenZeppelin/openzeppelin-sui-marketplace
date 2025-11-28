import { SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import type { SuiTransactionBlockResponse } from '@mysten/sui.js/client';
import type { BuildOutput, PublishResult } from './types';

type PublishParams = {
  client: SuiClient;
  keypair: Ed25519Keypair;
  buildOutput: BuildOutput;
  gasBudget: number;
};

export async function publishPackage(params: PublishParams) {
  const tx = new TransactionBlock();
  const [upgradeCap] = tx.publish({
    modules: params.buildOutput.modules,
    dependencies: params.buildOutput.dependencies,
  });

  tx.transferObjects([upgradeCap], tx.pure(params.keypair.toSuiAddress()));
  tx.setGasBudget(params.gasBudget);

  const result = await params.client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
    signer: params.keypair,
    options: {
      showEffects: true,
      showObjectChanges: true,
      showEvents: true,
    },
    requestType: 'WaitForLocalExecution',
  });

  if (result.effects?.status.status !== 'success') {
    throw new Error(`Publish failed: ${result.effects?.status.error ?? 'unknown error'}`);
  }

  const publishInfo = extractPublishResult(result);
  if (!publishInfo.packageId) {
    throw new Error('Publish succeeded but no packageId was returned.');
  }

  return publishInfo;
}

function extractPublishResult(result: SuiTransactionBlockResponse): PublishResult {
  const packageChange = result.objectChanges?.find(
    (change) => change.type === 'published',
  ) as { packageId?: string } | undefined;

  const upgradeCapChange = result.objectChanges?.find(
    (change) =>
      change.type === 'created' &&
      'objectType' in change &&
      typeof change.objectType === 'string' &&
      change.objectType.endsWith('::package::UpgradeCap'),
  ) as { objectId?: string } | undefined;

  return {
    packageId: packageChange?.packageId,
    upgradeCap: upgradeCapChange?.objectId,
    digest: result.digest,
  };
}
