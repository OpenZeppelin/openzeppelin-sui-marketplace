import "dotenv/config";
import path from "node:path";
import os from "node:os";

import chalk from "chalk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { resolveRpcUrl, buildExplorerUrl } from "../utils/network";
import { loadKeypair } from "../utils/keypair";
import { buildMovePackage } from "../utils/move";
import { publishPackage } from "../utils/publish";
import { writeArtifact } from "../utils/artifacts";
import { logChalkBlue, logChalkGreen } from "../utils/log";
import type { NetworkName, PublishArtifact } from "../utils/types";
import { runSuiScript } from "../utils/process";

runSuiScript(async () => {
  const { network, rpcUrl, packagePath, keystore, accountIndex, gasBudget } =
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
      .option("keystore", {
        type: "string",
        description: "Path to a Sui keystore file (defaults to CLI keystore)",
        default: path.join(os.homedir(), ".sui", "sui_config", "sui.keystore"),
      })
      .option("gas-budget", {
        type: "number",
        description: "Gas budget (in MIST) for the publish transaction",
        default: 200_000_000,
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

  const fullNodeUrl = resolveRpcUrl(network as NetworkName, rpcUrl);

  const resolvedPackagePath = path.resolve(packagePath);

  const artifactPath = path.join(
    process.cwd(),
    "deployments",
    `deployment.${network}.json`
  );

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

  console.log({ keypair });

  const publisher = keypair.toSuiAddress();
  const buildOutput = await buildMovePackage(resolvedPackagePath);

  logChalkBlue("Publishing package 💧");
  logChalkBlue("network")(`${network} / ${fullNodeUrl}`);
  logChalkBlue("package")(resolvedPackagePath);
  logChalkBlue("publisher")(publisher);
  logChalkBlue("modules")(buildOutput.modules.length);

  const publishResult = await publishPackage({
    fullNodeUrl,
    keypair,
    buildOutput,
    gasBudget,
  });

  console.log({ publishResult });

  // const artifact: PublishArtifact = {
  //   network: network,
  //   rpcUrl: fullNodeUrl,
  //   packagePath: resolvedPackagePath,
  //   packageId: publishResult.packageId,
  //   upgradeCap: publishResult.upgradeCap,
  //   sender: publisher,
  //   digest: publishResult.digest,
  //   publishedAt: new Date().toISOString(),
  //   modules: buildOutput.modules,
  //   dependencies: buildOutput.dependencies,
  //   explorerUrl: buildExplorerUrl(publishResult.digest, network as NetworkName),
  // };

  // await writeArtifact(artifactPath, artifact);

  // logChalkGreen("\n✅ Publish succeeded");
  // logChalkBlue("packageId")(publishResult.packageId);
  // if (publishResult.upgradeCap)
  //   logChalkBlue("upgradeCap")(publishResult.upgradeCap);

  // logChalkBlue("digest")(publishResult.digest);
  // if (artifact.explorerUrl) logChalkBlue("explorer")(artifact.explorerUrl););
});
