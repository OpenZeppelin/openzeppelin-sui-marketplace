import "dotenv/config";
import { publishPackageWithLog } from "../utils/publish";
import { runSuiScript } from "../utils/process";
import { getAccountConfig } from "../utils/config";
import { loadKeypair } from "../utils/keypair";
import yargs from "yargs";

runSuiScript(
  async (
    { network, currentNetwork, paths },
    { withUnpublishedDependencies, gasBudget }
  ) => {
    const packagePath = network.move?.packagePath ?? paths.move;

    const accounts = getAccountConfig(network);

    const keypair = await loadKeypair(accounts);

    await publishPackageWithLog({
      network: currentNetwork,
      packagePath,
      fullNodeUrl: network.url,
      keypair,
      gasBudget,
      withUnpublishedDependencies,
    });
  },
  yargs()
    .option("withUnpublishedDependencies", {
      alias: "with-unpublished-dependencies",
      type: "boolean",
      description: `Publish package with unpublished dependencies`,
      default: false,
    })
    .option("gasBudget", {
      alias: "gas-budget",
      type: "number",
      description: `Gas budget for publishing`,
    })
    .strict()
);
