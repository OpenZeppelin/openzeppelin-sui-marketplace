import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { NetworkName } from "./types";

export type SuiAccountsConfig =
  | string[]
  | {
      keystorePath?: string;
      accountAddress?: string;
      accountIndex?: number;
      keypairBase64?: string;
    };

export type SuiMoveConfig = {
  packagePath?: string;
  withUnpublishedDependencies?: boolean;
};

export type SuiNetworkConfig = {
  url?: string;
  faucetUrl?: string;
  accounts?: SuiAccountsConfig;
  gasBudget?: number;
  move?: SuiMoveConfig;
};

export type SuiPathsUserConfig = {
  move?: string;
  deployments?: string;
  objects?: string;
  artifacts?: string;
};

export type SuiUserConfig = {
  defaultNetwork?: NetworkName | string;
  networks?: Record<string, SuiNetworkConfig>;
  paths?: SuiPathsUserConfig;
};

export type SuiResolvedConfig = {
  defaultNetwork: NetworkName | string;
  networks: Record<string, SuiNetworkConfig>;
  paths: Required<SuiPathsUserConfig>;
};

const DEFAULT_CONFIG_FILENAMES = [
  "sui.config.ts",
  "sui.config.js",
  "sui.config.cjs",
  "sui.config.mjs",
];

const resolvePaths = (
  pathsConfig?: SuiPathsUserConfig
): Required<SuiPathsUserConfig> => ({
  move: path.resolve(process.cwd(), pathsConfig?.move ?? "move"),
  deployments: path.resolve(
    process.cwd(),
    pathsConfig?.deployments ?? "deployments"
  ),
  objects: path.resolve(process.cwd(), pathsConfig?.objects ?? "deployments"),
  artifacts: path.resolve(
    process.cwd(),
    pathsConfig?.artifacts ?? "deployments"
  ),
});

const resolveConfig = (userConfig: SuiUserConfig): SuiResolvedConfig => ({
  defaultNetwork:
    userConfig.defaultNetwork ??
    (process.env.SUI_NETWORK as NetworkName | string | undefined) ??
    "localnet",
  networks: userConfig.networks ?? {},
  paths: resolvePaths(userConfig.paths),
});

const findConfigPath = () =>
  DEFAULT_CONFIG_FILENAMES.map((filename) =>
    path.join(process.cwd(), filename)
  ).find((candidate) => existsSync(candidate));

export const defineSuiConfig = (config: SuiUserConfig): SuiUserConfig => config;

export const loadSuiConfig = async (): Promise<SuiResolvedConfig> => {
  const configPath = findConfigPath();
  if (!configPath) {
    return resolveConfig({});
  }

  try {
    const importedModule = await import(pathToFileURL(configPath).href);
    const config = (importedModule.default ??
      importedModule.config ??
      {}) as SuiUserConfig;

    return resolveConfig(config);
  } catch (error) {
    throw new Error(
      `Failed to load Sui config from ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

export const selectNetworkConfig = (
  config: SuiResolvedConfig,
  networkName?: string
) => {
  const selectedNetwork = networkName ?? config.defaultNetwork ?? "localnet";
  return {
    networkName: selectedNetwork,
    networkConfig: config.networks[selectedNetwork] ?? {},
  };
};

export const resolveAccountsConfig = (
  networkConfig: SuiNetworkConfig,
  defaults: {
    keystorePath: string;
    accountIndex: number;
    accountAddress?: string;
  }
) => {
  const accounts = networkConfig.accounts;
  if (accounts && !Array.isArray(accounts)) {
    return {
      keystorePath: accounts.keystorePath ?? defaults.keystorePath,
      accountIndex: accounts.accountIndex ?? defaults.accountIndex,
      accountAddress: accounts.accountAddress ?? defaults.accountAddress,
    };
  }

  return defaults;
};
