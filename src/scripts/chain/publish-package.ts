import "dotenv/config";
import path from "node:path";

import { resolveAccountsConfig, selectNetworkConfig } from "../utils/config";
import { resolveRpcUrl } from "../utils/network";
import { loadDeployerKeypair } from "../utils/keypair";
import { publishPackageWithLog } from "../utils/publish";
import type { NetworkName } from "../utils/types";
import { runSuiScript } from "../utils/process";
import { DEFAULT_KEYSTORE_PATH } from "../utils/constants";

runSuiScript(async (config) => {
  const { networkName, networkConfig } = selectNetworkConfig(config);
  const fullNodeUrl = resolveRpcUrl(
    networkName as NetworkName,
    networkConfig.url
  );

  const packagePath =
    networkConfig.move?.packagePath ?? config.paths.move;
  const gasBudget = networkConfig.gasBudget ?? 200_000_000;
  const withUnpublishedDependencies =
    networkConfig.move?.withUnpublishedDependencies ?? false;

  const accounts = resolveAccountsConfig(networkConfig, {
    keystorePath: DEFAULT_KEYSTORE_PATH,
    accountIndex: 0,
    accountAddress: undefined,
  });

  const keypair = await loadDeployerKeypair(accounts);

  await publishPackageWithLog({
    network: networkName as NetworkName,
    packagePath,
    fullNodeUrl,
    keypair,
    gasBudget,
    withUnpublishedDependencies,
    keystorePath: accounts.keystorePath,
  });
});
