import "dotenv/config";
import path from "node:path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { resolveRpcUrl } from "../utils/network";
import { loadKeypair } from "../utils/keypair";
import { publishPackageWithLog } from "../utils/publish";
import type { NetworkName } from "../utils/types";
import { runSuiScript } from "../utils/process";
import { DEFAULT_KEYSTORE_PATH } from "../utils/constants";

runSuiScript(async () => {
  const {
    network,
    rpcUrl,
    packagePath,
    keystore,
    accountIndex,
    gasBudget,
    withUnpublishedDependencies,
  } = await parsePublishPackageCliArgs();

  const suiNetwork = network as NetworkName;
  const fullNodeUrl = resolveRpcUrl(suiNetwork, rpcUrl);

  const keypair = await loadKeypair({
    keystorePath: keystore,
    accountIndex: accountIndex,
    privateKey:
      process.env.SUI_DEPLOYER_PRIVATE_KEY ??
      process.env.SUI_PRIVATE_KEY ??
      process.env.PRIVATE_KEY,
    mnemonic:
      process.env.SUI_DEPLOYER_MNEMONIC ??
      process.env.SUI_MNEMONIC ??
      process.env.MNEMONIC,
  });

  await publishPackageWithLog({
    network: suiNetwork,
    packagePath,
    fullNodeUrl,
    keypair,
    gasBudget,
    withUnpublishedDependencies,
    keystorePath: keystore,
  });
});

const parsePublishPackageCliArgs = async () =>
  await yargs(hideBin(process.argv))
    .scriptName("publish-package")
    .option("network", {
      type: "string",
      description: "Target Sui network",
      choices: ["localnet", "devnet", "testnet", "mainnet", "custom"],
      default: process.env.SUI_NETWORK ?? "localnet",
    })
    .option("rpc-url", {
      type: "string",
      description: "Custom RPC URL (required when network=custom)",
      default: process.env.SUI_RPC_URL,
    })
    .option("package-path", {
      alias: ["path", "p"],
      type: "string",
      description: "Path to the Move package to publish",
      default: path.join(process.cwd(), "move"),
    })
    .option("gas-budget", {
      type: "number",
      description: "Gas budget (in MIST) for the publish transaction",
      default: 200_000_000,
    })
    .option("with-unpublished-dependencies", {
      type: "boolean",
      description:
        "Allow publishing even when dependencies do not have published addresses (passes --with-unpublished-dependencies to sui move build).",
      default: false,
    })
    .option("keystore", {
      type: "string",
      description: "Path to a Sui keystore file (defaults to CLI keystore)",
      default: DEFAULT_KEYSTORE_PATH,
    })
    .option("account-index", {
      type: "number",
      description:
        "Account index to use from the keystore when no env key is set",
      default: 0,
    })
    .strict()
    .help()
    .parseAsync();
