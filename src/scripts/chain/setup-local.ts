import "dotenv/config";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

import { SuiClient, type SuiObjectResponse } from "@mysten/sui/client";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { resolveRpcUrl } from "../utils/network";
import { loadKeypair } from "../utils/keypair";
import { logChalkBlue, logChalkGreen, logChalkWarning } from "../utils/log";
import { runSuiScript } from "../utils/process";
import { publishPackage, publishPackageWithLog } from "../utils/publish";
import {
  buildMockPriceInfoObject,
  getPythPriceInfoType,
  type MockPriceFeedConfig,
} from "../utils/pyth";
import {
  findCreatedByType,
  findCreatedObjectIds,
  newTx,
  signAndExecute,
} from "../utils/transactions";
import type { NetworkName } from "../utils/types";
import {
  DEFAULT_KEYSTORE_PATH,
  getDeploymentArtifactPath,
  getMockArtifactPath,
} from "../utils/constants";
import {
  addOrReplacePublishArtifact,
  readArtifact,
  writeArtifact,
} from "../utils/artifacts";
import type { PublishArtifact } from "../utils/types";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { ensureFoundedAddress } from "../utils/address";

// Captures mock data we need for localnet runs (coins + price feeds).
type MockArtifact = Partial<{
  localNetwork: NetworkName;
  rpcUrl: string;
  pythPackageId: string;
  mockCoinPackageId: string;
  priceFeeds: {
    label: string;
    feedIdHex: string;
    priceInfoObjectId: string;
  }[];
  mockCoins: {
    coinType: string;
    currencyId: string;
    treasuryCapId: string;
    mintedCoinIds: string[];
  }[];
  signer: string;
  executedAt: string;
}>;

type DeploymentArtifacts = PublishArtifact[];
type DeploymentArtifactState = {
  artifacts: DeploymentArtifacts;
  markChanged: () => void;
  persistIfChanged: () => Promise<void>;
};

type SetupLocalCliArgs = {
  keystore: string;
  accountIndex: number;
  existingPythPackageId?: string;
  pythContractsPath: string;
  pythPublishGasBudget: number;
  existingMockCoinPackageId?: string;
  mockCoinContractsPath: string;
  mockCoinPublishGasBudget: number;
  coinMockMint: number;
  rePublish: boolean;
};

type LoadedKeypair = Awaited<ReturnType<typeof loadKeypair>>;

// ID of the CoinRegistry shared object on Sui.
const COIN_REGISTRY_ID =
  "0x000000000000000000000000000000000000000000000000000000000000000c";

// Where the patched Pyth contracts live locally.
const DEFAULT_PYTH_CONTRACTS_PATH = path.join(
  process.cwd(),
  "patches",
  "pyth-crosschain",
  "target_chains",
  "sui",
  "contracts"
);

// Standalone mock coin Move package path.
const DEFAULT_MOCK_COIN_CONTRACTS_PATH = path.join(
  process.cwd(),
  "move",
  "local-mock-coin"
);

// Two sample feeds to seed Pyth price objects with.
const DEFAULT_FEEDS: MockPriceFeedConfig[] = [
  {
    feedIdHex:
      "0x000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f",
    price: 1_000n,
    confidence: 10n,
    exponent: -2,
  },
  {
    feedIdHex:
      "0x101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f",
    price: 25_000n,
    confidence: 50n,
    exponent: -2,
  },
];

runSuiScript(async () => {
  const localNetwork: NetworkName = "localnet";
  const mockArtifactPath = getMockArtifactPath(localNetwork);
  const deploymentArtifactPath = getDeploymentArtifactPath(localNetwork);

  const mockArtifacts = await readArtifact<MockArtifact>(mockArtifactPath, {});
  const deploymentArtifacts = await readArtifact<DeploymentArtifacts>(
    deploymentArtifactPath,
    []
  );

  const cliOptions = await parseSetupLocalCliArgs(mockArtifacts);
  const fullNodeUrl = resolveRpcUrl(localNetwork);

  const keypair = await loadDeployerKeypair(cliOptions);
  const signerAddress = keypair.toSuiAddress();

  console.log(cliOptions);
  console.log({ mockArtifacts, deploymentArtifacts });
  console.log({
    pythPackageId: cliOptions.existingPythPackageId,
    mockCoinPackageId: cliOptions.existingMockCoinPackageId,
  });
  console.log({ keypair, signerAddress });

  const suiClient = new SuiClient({ url: fullNodeUrl });

  await ensureFoundedAddress(
    {
      signerAddress,
    },
    suiClient
  );

  const pythPackageId =
    cliOptions.existingPythPackageId ||
    (await publishPackageWithLog(
      {
        network: localNetwork,
        fullNodeUrl,
        packagePath: cliOptions.pythContractsPath,
        keypair,
        gasBudget: cliOptions.pythPublishGasBudget,
        withUnpublishedDependencies: true,
      },
      suiClient
    ));

  console.log({ pythPackageId });

  // const mockCoinPackageId =
  //   cliOptions.existingMockCoinPackageId ||
  //   (await publishPackageWithLog(
  //     {
  //       network: localNetwork,
  //       fullNodeUrl,
  //       packagePath: cliOptions.mockCoinContractsPath,
  //       keypair,
  //       gasBudget: cliOptions.mockCoinPublishGasBudget,
  //     },
  //     suiClient
  //   ));

  // console.log({ mockCoinPackageId });

  // await deploymentArtifacts.persistIfChanged();

  // if (
  //   shouldReuseExistingArtifact({
  //     mockArtifact,
  //     mockCoinPackageId,
  //     pythPackageId,
  //     rePublish: cliOptions.rePublish,
  //   })
  // ) {
  //   await ensureExistingArtifactUsable({
  //     artifact: mockArtifact!,
  //     client,
  //     expectedPythPackageId: pythPackageId,
  //     expectedMockCoinPackageId: mockCoinPackageId,
  //     fullNodeUrl,
  //     localNetwork,
  //     publishPythRequested: shouldPublishPyth,
  //     publishMockCoinRequested: shouldPublishMockCoin,
  //     expectedFeedCount: DEFAULT_FEEDS.length,
  //     expectedMockCoinCount: 2,
  //   });

  //   logChalkGreen("\n✅ Local mock data already seeded");
  //   logChalkBlue("artifact")(mockArtifactPath);
  //   return;
  // }

  // if (cliOptions.rePublish && mockArtifact) {
  //   logChalkWarning(
  //     `--re-publish set; recreating mocks and overwriting ${mockArtifactPath}.`
  //   );
  // }

  // await seedLocalMocks({
  //   client,
  //   coinMockMint: cliOptions.coinMockMint,
  //   fullNodeUrl,
  //   mockArtifactPath,
  //   mockCoinPackageId,
  //   localNetwork,
  //   pythPackageId,
  //   signerAddress,
  //   keypair,
  // });
});

/**
 * Parses CLI flags and enforces that publish/package ID inputs are provided.
 */
const parseSetupLocalCliArgs = async (
  mockArtifact: MockArtifact
): Promise<SetupLocalCliArgs> => {
  const providedCliArgument = await yargs(hideBin(process.argv))
    .scriptName("setup-local")
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
    .option("pyth-package-id", {
      type: "string",
      description:
        "Package ID of the Pyth Move package on the local localNetwork (use the one produced when publishing with --with-unpublished-dependencies).",
    })
    .option("pyth-contracts-path", {
      type: "string",
      description:
        "Path to the patched Pyth Move package to publish when --publish-pyth is set.",
      default: DEFAULT_PYTH_CONTRACTS_PATH,
    })
    .option("pyth-publish-gas-budget", {
      type: "number",
      description: "Gas budget (in MIST) to use when publishing Pyth",
      default: 2_000_000_000,
    })
    .option("mock-coin-package-id", {
      type: "string",
      description:
        "Existing package ID of the mock coin Move package on the local localNetwork.",
    })
    .option("mock-coin-contracts-path", {
      type: "string",
      description:
        "Path to the mock coin Move package to publish when --publish-mock-coin is set.",
      default: DEFAULT_MOCK_COIN_CONTRACTS_PATH,
    })
    .option("mock-coin-publish-gas-budget", {
      type: "number",
      description:
        "Gas budget (in MIST) to use when publishing the mock coin package",
      default: 200_000_000,
    })
    .option("coin-mock-mint", {
      type: "number",
      description: "How many MIST to split from gas for each demo coin object",
      default: 1_000_000_000,
    })
    .option("re-publish", {
      type: "boolean",
      description: `Re-create and overwrite local mock data`,
      default: false,
    })
    .strict()
    .help()
    .parseAsync();

  return {
    ...providedCliArgument,
    existingPythPackageId: providedCliArgument.rePublish
      ? undefined
      : providedCliArgument.pythPackageId || mockArtifact.pythPackageId,
    existingMockCoinPackageId: providedCliArgument.rePublish
      ? undefined
      : providedCliArgument.mockCoinPackageId || mockArtifact.mockCoinPackageId,
  };
};

/**
 * Loads deployment artifacts and exposes helpers to mark and persist changes.
 */
// const loadDeploymentArtifactState = async (
//   deploymentArtifactPath: string
// ): Promise<DeploymentArtifactState> => {
//   const deploymentArtifactsRaw = await readArtifact<
//     DeploymentArtifacts | PublishArtifact
//   >(deploymentArtifactPath);

//   const artifacts: DeploymentArtifacts = Array.isArray(deploymentArtifactsRaw)
//     ? deploymentArtifactsRaw
//     : deploymentArtifactsRaw
//     ? [deploymentArtifactsRaw]
//     : [];

//   let changed = false;

//   const markChanged = () => {
//     changed = true;
//   };

//   const persistIfChanged = async () => {
//     if (!changed) return;
//     await writeArtifact(deploymentArtifactPath, artifacts);
//     logChalkBlue("deployment artifact")(deploymentArtifactPath);
//   };

//   return { artifacts, markChanged, persistIfChanged };
// };

/**
 * Loads the keypair used for publishing and seeding mock data.
 */
const loadDeployerKeypair = async ({
  keystore,
  accountIndex,
}: SetupLocalCliArgs) => {
  return loadKeypair({
    keystorePath: keystore,
    accountIndex,
    privateKey:
      process.env.SUI_DEPLOYER_PRIVATE_KEY ??
      process.env.SUI_PRIVATE_KEY ??
      process.env.PRIVATE_KEY,
    mnemonic:
      process.env.SUI_DEPLOYER_MNEMONIC ??
      process.env.SUI_MNEMONIC ??
      process.env.MNEMONIC,
  });
};

/**
 * Ensures we have a usable mock coin package ID, publishing if necessary.
 */
const prepareMockCoinPackage = async ({
  client,
  fullNodeUrl,
  keypair,
  localNetwork,
  cliOptions,
  signerAddress,
  deploymentArtifacts,
  initialPackageId,
  shouldPublish,
}: {
  client: SuiClient;
  fullNodeUrl: string;
  keypair: LoadedKeypair;
  localNetwork: NetworkName;
  cliOptions: SetupLocalCliArgs;
  signerAddress: string;
  deploymentArtifacts: DeploymentArtifactState;
  initialPackageId?: string;
  shouldPublish: boolean;
}): Promise<string> => {
  let mockCoinPackageId = initialPackageId;

  if (shouldPublish) {
    const resolvedMockCoinPath = path.resolve(cliOptions.mockCoinContractsPath);

    if (cliOptions.existingMockCoinPackageId && !cliOptions.rePublish) {
      logChalkWarning(
        "Ignoring provided --mock-coin-package-id because publish is required for local setup."
      );
    }

    try {
      await fs.access(resolvedMockCoinPath);
    } catch (error) {
      throw new Error(
        `Mock coin contracts not found at ${resolvedMockCoinPath}.`
      );
    }

    logChalkBlue("mock coin publish path")(resolvedMockCoinPath);
    const mockPublishResult = await publishPackage(
      {
        localNetwork,
        packagePath: resolvedMockCoinPath,
        fullNodeUrl,
        gasBudget: cliOptions.mockCoinPublishGasBudget,
        keypair,
      },
      client
    );

    mockCoinPackageId = mockPublishResult.packageId;

    logChalkGreen("mock coin package")(mockPublishResult.packageId);
    if (mockPublishResult.upgradeCap)
      logChalkBlue("mock coin upgrade cap")(mockPublishResult.upgradeCap);
    if (mockPublishResult.digest)
      logChalkBlue("mock coin publish tx")(mockPublishResult.digest);

    const mockCoinPublishArtifact: PublishArtifact = {
      localNetwork,
      rpcUrl: fullNodeUrl,
      packagePath: resolvedMockCoinPath,
      packageId: mockPublishResult.packageId,
      upgradeCap: mockPublishResult.upgradeCap,
      sender: signerAddress,
      digest: mockPublishResult.digest ?? "",
      publishedAt: new Date().toISOString(),
      modules: mockPublishResult.modules,
      dependencies: mockPublishResult.dependencies,
    };

    addOrReplacePublishArtifact(
      deploymentArtifacts.artifacts,
      mockCoinPublishArtifact
    );
    deploymentArtifacts.markChanged();
  }

  if (!mockCoinPackageId) {
    throw new Error(
      "Mock coin package ID missing. Provide --mock-coin-package-id or run with --publish-mock-coin."
    );
  }

  return mockCoinPackageId;
};

/**
 * Returns true when we can reuse an existing artifact without reseeding.
 */
const shouldReuseExistingArtifact = ({
  mockArtifact,
  pythPackageId,
  mockCoinPackageId,
  rePublish,
}: {
  mockArtifact: MockArtifact | null;
  pythPackageId: string;
  mockCoinPackageId: string;
  rePublish: boolean;
}): boolean => {
  if (rePublish || !mockArtifact) return false;

  const hasExistingFeeds =
    mockArtifact.priceFeeds?.length === DEFAULT_FEEDS.length &&
    mockArtifact.pythPackageId === pythPackageId;

  const hasExistingCoins =
    mockArtifact.mockCoins?.length === 2 &&
    mockArtifact.mockCoinPackageId === mockCoinPackageId &&
    mockArtifact.mockCoins.every(
      (coin) =>
        coin.currencyId &&
        coin.treasuryCapId &&
        Array.isArray(coin.mintedCoinIds) &&
        coin.mintedCoinIds.length > 0
    );

  return hasExistingFeeds && hasExistingCoins;
};

/**
 * Seeds local Pyth price objects and mock coins, then writes the artifact.
 */
const seedLocalMocks = async ({
  client,
  coinMockMint,
  fullNodeUrl,
  mockArtifactPath,
  mockCoinPackageId,
  localNetwork,
  pythPackageId,
  signerAddress,
  keypair,
}: {
  client: SuiClient;
  coinMockMint: number;
  fullNodeUrl: string;
  mockArtifactPath: string;
  mockCoinPackageId: string;
  localNetwork: NetworkName;
  pythPackageId: string;
  signerAddress: string;
  keypair: LoadedKeypair;
}) => {
  logChalkBlue("localNetwork")(`${localNetwork} / ${fullNodeUrl}`);
  logChalkBlue("pyth package")(pythPackageId);
  logChalkBlue("mock coin package")(mockCoinPackageId);
  logChalkBlue("signer")(signerAddress);

  const tx = newTx(200_000_000);

  tx.moveCall({
    target: `${mockCoinPackageId}::local_mock_coin::init_local_mock_usd`,
    arguments: [tx.object(COIN_REGISTRY_ID), tx.pure.address(signerAddress)],
  });

  tx.moveCall({
    target: `${mockCoinPackageId}::local_mock_coin::init_local_mock_btc`,
    arguments: [tx.object(COIN_REGISTRY_ID), tx.pure.address(signerAddress)],
  });

  DEFAULT_FEEDS.forEach((feed) => {
    buildMockPriceInfoObject(tx, pythPackageId, feed);
  });

  DEFAULT_FEEDS.forEach(() => {
    tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(coinMockMint))]);
  });

  const execution = await signAndExecute({
    client,
    tx,
    signer: keypair,
  });

  const createdPriceInfos = findCreatedObjectIds(
    execution,
    "::price_info::PriceInfoObject"
  );

  if (createdPriceInfos.length < DEFAULT_FEEDS.length) {
    throw new Error(
      `Expected ${DEFAULT_FEEDS.length} price info objects, found ${createdPriceInfos.length}`
    );
  }

  const usdCurrencyIds = findCreatedByType(
    execution,
    (type) =>
      type.includes("local_mock_coin::LocalMockUsd") &&
      type.startsWith("0x2::coin_registry::Currency")
  );
  const btcCurrencyIds = findCreatedByType(
    execution,
    (type) =>
      type.includes("local_mock_coin::LocalMockBtc") &&
      type.startsWith("0x2::coin_registry::Currency")
  );

  const usdTreasuryCapIds = findCreatedByType(
    execution,
    (type) =>
      type.includes("local_mock_coin::LocalMockUsd") &&
      type.startsWith("0x2::coin::TreasuryCap")
  );
  const btcTreasuryCapIds = findCreatedByType(
    execution,
    (type) =>
      type.includes("local_mock_coin::LocalMockBtc") &&
      type.startsWith("0x2::coin::TreasuryCap")
  );

  const usdCoinIds = findCreatedByType(
    execution,
    (type) =>
      type.includes("local_mock_coin::LocalMockUsd") &&
      type.startsWith("0x2::coin::Coin")
  );
  const btcCoinIds = findCreatedByType(
    execution,
    (type) =>
      type.includes("local_mock_coin::LocalMockBtc") &&
      type.startsWith("0x2::coin::Coin")
  );

  const artifact: MockArtifact = {
    localNetwork,
    rpcUrl: fullNodeUrl,
    pythPackageId,
    mockCoinPackageId,
    priceFeeds: DEFAULT_FEEDS.map((feed, index) => ({
      label: `feed-${index + 1}`,
      feedIdHex: feed.feedIdHex,
      priceInfoObjectId: createdPriceInfos[index],
    })),
    mockCoins: [
      {
        coinType: `${mockCoinPackageId}::local_mock_coin::LocalMockUsd`,
        currencyId: usdCurrencyIds[0] ?? "",
        treasuryCapId: usdTreasuryCapIds[0] ?? "",
        mintedCoinIds: usdCoinIds,
      },
      {
        coinType: `${mockCoinPackageId}::local_mock_coin::LocalMockBtc`,
        currencyId: btcCurrencyIds[0] ?? "",
        treasuryCapId: btcTreasuryCapIds[0] ?? "",
        mintedCoinIds: btcCoinIds,
      },
    ],
    signer: signerAddress,
    executedAt: new Date().toISOString(),
  };

  await writeArtifact(mockArtifactPath, artifact);

  logChalkGreen("\n✅ Local mock data seeded");
  logChalkBlue("price feeds")(createdPriceInfos.join(", "));
  if (usdCoinIds.length) logChalkBlue("mock usd coins")(usdCoinIds.join(", "));
  if (btcCoinIds.length) logChalkBlue("mock btc coins")(btcCoinIds.join(", "));
  logChalkBlue("artifact")(mockArtifactPath);
};

/**
 * Ensures an existing artifact matches the desired localNetwork/config and still exists on-chain.
 */
// const ensureExistingArtifactUsable = async ({
//   artifact,
//   client,
//   expectedPythPackageId,
//   expectedMockCoinPackageId,
//   fullNodeUrl,
//   localNetwork,
//   publishPythRequested,
//   publishMockCoinRequested,
//   expectedFeedCount,
//   expectedMockCoinCount,
// }: {
//   artifact: MockArtifact;
//   client: SuiClient;
//   expectedPythPackageId?: string;
//   expectedMockCoinPackageId?: string;
//   fullNodeUrl: string;
//   localNetwork: NetworkName;
//   publishPythRequested: boolean;
//   publishMockCoinRequested: boolean;
//   expectedFeedCount: number;
//   expectedMockCoinCount: number;
// }) => {
//   if (artifact.localNetwork !== localNetwork) {
//     throw new Error(
//       `Existing artifact targets ${artifact.localNetwork}, expected ${localNetwork}. Run with --re-publish to recreate it.`
//     );
//   }

//   if (artifact.priceFeeds.length < expectedFeedCount) {
//     throw new Error(
//       `Existing artifact only contains ${artifact.priceFeeds.length} price feeds, expected ${expectedFeedCount}. Run with --re-publish to recreate it.`
//     );
//   }

//   if (artifact.mockCoins.length < expectedMockCoinCount) {
//     throw new Error(
//       `Existing artifact only contains ${artifact.mockCoins.length} mock coins, expected ${expectedMockCoinCount}. Run with --re-publish to recreate it.`
//     );
//   }

//   if (artifact.rpcUrl !== fullNodeUrl) {
//     throw new Error(
//       `Existing artifact RPC (${artifact.rpcUrl}) does not match configured ${localNetwork} RPC (${fullNodeUrl}). Run with --re-publish to recreate it.`
//     );
//   }

//   if (
//     expectedPythPackageId &&
//     artifact.pythPackageId !== expectedPythPackageId
//   ) {
//     throw new Error(
//       `Existing artifact uses Pyth package ${artifact.pythPackageId}, but --pyth-package-id=${expectedPythPackageId}. Run with --re-publish to publish or reference the desired package.`
//     );
//   }

//   if (
//     expectedMockCoinPackageId &&
//     artifact.mockCoinPackageId !== expectedMockCoinPackageId
//   ) {
//     throw new Error(
//       `Existing artifact uses mock coin package ${artifact.mockCoinPackageId}, but --mock-coin-package-id=${expectedMockCoinPackageId}. Run with --re-publish to publish or reference the desired package.`
//     );
//   }

//   if (!artifact.mockCoinPackageId) {
//     throw new Error(
//       "Existing artifact is missing a mock coin package ID. Run with --re-publish to recreate local mocks."
//     );
//   }

//   if (publishPythRequested) {
//     logChalkWarning(
//       "Existing artifact found; ignoring --publish-pyth. Use --re-publish to publish again."
//     );
//   }

//   if (publishMockCoinRequested) {
//     logChalkWarning(
//       "Existing artifact found; ignoring --publish-mock-coin. Use --re-publish to publish again."
//     );
//   }

//   const mismatchedCoinTypes = artifact.mockCoins
//     .filter(
//       (coin) => !coin.coinType.startsWith(`${artifact.mockCoinPackageId}::`)
//     )
//     .map((coin) => coin.coinType);

//   if (mismatchedCoinTypes.length) {
//     throw new Error(
//       `Existing artifact coin types (${mismatchedCoinTypes.join(
//         ", "
//       )}) do not belong to mock coin package ${
//         artifact.mockCoinPackageId
//       }. Run with --re-publish to re-initialize.`
//     );
//   }

//   const criticalObjectIds = [
//     ...artifact.priceFeeds.map((feed) => feed.priceInfoObjectId),
//     ...artifact.mockCoins.map((coin) => coin.currencyId),
//     ...artifact.mockCoins.map((coin) => coin.treasuryCapId),
//   ].filter(Boolean);

//   const mintedCoinIds = artifact.mockCoins.flatMap(
//     (coin) => coin.mintedCoinIds
//   );

//   const [criticalObjects, mintedObjects] = await Promise.all([
//     criticalObjectIds.length
//       ? client.multiGetObjects({
//           ids: criticalObjectIds,
//           cliOptions: { showContent: true, showType: true },
//         })
//       : [],
//     mintedCoinIds.length
//       ? client.multiGetObjects({
//           ids: mintedCoinIds,
//           cliOptions: { showContent: true, showType: true },
//         })
//       : [],
//   ]);

//   const missingCritical = findMissingIds(criticalObjectIds, criticalObjects);

//   if (missingCritical.length) {
//     throw new Error(
//       `Existing artifact references missing objects: ${missingCritical.join(
//         ", "
//       )}. Run with --re-publish to recreate local mocks.`
//     );
//   }

//   const objectById = new Map<string, SuiObjectResponse>(
//     criticalObjects.map((response, index) => [
//       criticalObjectIds[index],
//       response,
//     ])
//   );

//   const priceInfoType = getPythPriceInfoType(artifact.pythPackageId);
//   const typeMismatches: string[] = [];

//   artifact.priceFeeds.forEach((feed) => {
//     const response = objectById.get(feed.priceInfoObjectId);
//     if (!isObjectType(response, priceInfoType)) {
//       typeMismatches.push(feed.priceInfoObjectId);
//     }
//   });

//   artifact.mockCoins.forEach((coin) => {
//     const expectedCurrencyType = `0x2::coin_registry::Currency<${coin.coinType}>`;
//     const expectedTreasuryType = `0x2::coin::TreasuryCap<${coin.coinType}>`;

//     const currencyResponse = objectById.get(coin.currencyId);
//     const treasuryResponse = objectById.get(coin.treasuryCapId);

//     if (!isObjectType(currencyResponse, expectedCurrencyType)) {
//       typeMismatches.push(coin.currencyId);
//     }

//     if (!isObjectType(treasuryResponse, expectedTreasuryType)) {
//       typeMismatches.push(coin.treasuryCapId);
//     }
//   });

//   if (typeMismatches.length) {
//     throw new Error(
//       `Existing artifact references objects with unexpected types: ${typeMismatches.join(
//         ", "
//       )}. Run with --re-publish to recreate local mocks.`
//     );
//   }

//   const mintedById = new Map<string, string>();
//   artifact.mockCoins.forEach((coin) => {
//     coin.mintedCoinIds.forEach((id) =>
//       mintedById.set(id, `0x2::coin::Coin<${coin.coinType}>`)
//     );
//   });

//   if (mintedCoinIds.length) {
//     const missingMinted = findMissingIds(mintedCoinIds, mintedObjects);
//     const mintedResponseById = new Map<string, SuiObjectResponse>(
//       mintedObjects.map((response, index) => [mintedCoinIds[index], response])
//     );

//     const mintedTypeMismatches = mintedCoinIds.filter((id) => {
//       const expectedType = mintedById.get(id);
//       const response = mintedResponseById.get(id);
//       return expectedType ? !isObjectType(response, expectedType) : false;
//     });

//     const issues = [...missingMinted, ...mintedTypeMismatches];

//     if (issues.length) {
//       logChalkWarning(
//         `Some minted demo coin objects are missing or have unexpected types: ${issues.join(
//           ", "
//         )}. Run with --re-publish to re-mint demo coins.`
//       );
//     }
//   }

//   logChalkBlue("localNetwork")(`${artifact.localNetwork} / ${fullNodeUrl}`);
//   logChalkBlue("pyth package")(artifact.pythPackageId);
//   logChalkBlue("mock coin package")(artifact.mockCoinPackageId);
// };

/**
 * Filters ids whose responses are missing or errored.
 */
const findMissingIds = (
  ids: string[],
  responses: SuiObjectResponse[]
): string[] => {
  return ids.filter((id, index) => {
    const response = responses[index];
    if (!response) return true;
    if ("error" in response && response.error) return true;
    if (!("data" in response) || !response.data) return true;
    return false;
  });
};

/**
 * Extracts the Move type from a fetched object response.
 */
const extractObjectType = (
  response: SuiObjectResponse | undefined
): string | undefined => {
  if (!response || ("error" in response && response.error)) return undefined;
  if (!("data" in response) || !response.data) return undefined;

  const contentType = (response.data as any).content?.type;
  if (typeof contentType === "string") return contentType;

  const bcsType = (response.data as any).bcs?.type;
  return typeof bcsType === "string" ? bcsType : undefined;
};

/**
 * Checks whether a fetched object matches an expected Move type.
 */
const isObjectType = (
  response: SuiObjectResponse | undefined,
  expectedType: string
): boolean => {
  return extractObjectType(response) === expectedType;
};
