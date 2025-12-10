import "dotenv/config";
import path from "node:path";

import {
  SuiClient,
  type SuiObjectResponse,
  type SuiObjectDataOptions,
  type SuiTransactionBlockResponse,
  SuiObjectData,
} from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ensureFoundedAddress } from "../utils/address";
import { readArtifact } from "../utils/artifacts";
import {
  DEFAULT_KEYSTORE_PATH,
  getDeploymentArtifactPath,
  SUI_COIN_REGISTRY_ID,
} from "../utils/constants";
import { loadDeployerKeypair, loadKeypair } from "../utils/keypair";
import { logKeyValueBlue, logKeyValueGreen, logWarning } from "../utils/log";
import { resolveRpcUrl } from "../utils/network";
import { publishPackageWithLog } from "../utils/publish";
import { runSuiScript } from "../utils/process";
import {
  getPythPriceInfoType,
  publishMockPriceFeed,
  SUI_CLOCK_ID,
  type MockPriceFeedConfig,
} from "../utils/pyth";
import {
  assertTransactionSuccess,
  findCreatedObjectIds,
  newTransaction,
  signAndExecute,
} from "../utils/transactions";
import type { NetworkName, PublishArtifact } from "../utils/types";
import {
  MockArtifact,
  mockArtifactPath,
  writeMockArtifact,
} from "../utils/mock";
import { getSuiSharedObject, WrappedSuiSharedObject } from "../utils/object";
import { resolveAccountsConfig, selectNetworkConfig } from "../utils/config";

type SetupLocalCliArgs = {
  keystorePath: string;
  accountIndex: number;
  accountAddress?: string;
  coinContractPath: string;
  existingCoinPackageId?: string;
  existingCoins?: CoinArtifact[];
  pythContractPath: string;
  existingPythPackageId?: string;
  existingPriceFeeds?: PriceFeedArtifact[];
  rePublish: boolean;
};

// Where the local Pyth stub lives.
const DEFAULT_PYTH_CONTRACT_PATH = path.join(
  process.cwd(),
  "move",
  "pyth-mock"
);
const DEFAULT_COIN_CONTRACT_PATH = path.join(
  process.cwd(),
  "move",
  "coin-mock"
);

type LabeledPriceFeedConfig = MockPriceFeedConfig & { label: string };
type CoinArtifact = NonNullable<MockArtifact["coins"]>[number];
type PriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number];

type CoinSeed = {
  label: string;
  coinType: string;
  initTarget: string;
};

// Two sample feeds to seed Pyth price objects with.
const DEFAULT_FEEDS: LabeledPriceFeedConfig[] = [
  {
    label: "MOCK_USD_FEED",
    feedIdHex:
      "0x000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f",
    price: 1_000n,
    confidence: 10n,
    exponent: -2,
  },
  {
    label: "MOCK_BTC_FEED",
    feedIdHex:
      "0x101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f",
    price: 25_000n,
    confidence: 50n,
    exponent: -2,
  },
];

const DEFAULT_TX_GAS_BUDGET = 100_000_000;

runSuiScript(async (config) => {
  const localNetwork: NetworkName = "localnet";

  const { networkConfig } = selectNetworkConfig(config, localNetwork);
  const accountDefaults = resolveAccountsConfig(networkConfig, {
    keystorePath: DEFAULT_KEYSTORE_PATH,
    accountIndex: 0,
    accountAddress: undefined,
  });
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {});
  const cliOptions = await parseSetupLocalCliArgs(
    mockArtifact ?? {},
    accountDefaults
  );
  const fullNodeUrl = resolveRpcUrl(localNetwork, networkConfig.url);

  const keypair = await loadDeployerKeypair(cliOptions);
  const signerAddress = keypair.toSuiAddress();

  const suiClient = new SuiClient({ url: fullNodeUrl });

  await ensureFoundedAddress(
    {
      signerAddress,
    },
    suiClient
  );

  const { coinPackageId, pythPackageId } = await publishMockPackages(
    { network: localNetwork, fullNodeUrl, keypair, cliOptions },
    suiClient
  );

  const { coinRegistryObject, clockObject } = await resolveRegistryAndClockRefs(
    suiClient
  );

  const coins =
    cliOptions.existingCoins ||
    (await ensureMockCoins(
      {
        coinPackageId,
        owner: signerAddress,

        signer: keypair,
        coinRegistryObject,
      },
      suiClient
    ));

  await writeMockArtifact(mockArtifactPath, {
    coins,
  });

  const priceFeeds =
    cliOptions.existingPriceFeeds ||
    (await ensurePriceFeeds({
      pythPackageId,
      suiClient,
      signer: keypair,
      clockObject,
      existingPriceFeeds: cliOptions.existingPriceFeeds || [],
    }));

  await writeMockArtifact(mockArtifactPath, {
    priceFeeds,
  });

  logKeyValueGreen("Pyth package")(pythPackageId);
  logKeyValueGreen("Coin package")(coinPackageId);
  logKeyValueGreen("Feeds")(JSON.stringify(priceFeeds));
  logKeyValueGreen("Coins")(JSON.stringify(coins));
});

const publishMockPackages = async (
  {
    network,
    fullNodeUrl,
    keypair,
    cliOptions,
  }: {
    network: "localnet";
    fullNodeUrl: string;
    keypair: Ed25519Keypair;
    cliOptions: SetupLocalCliArgs;
  },
  suiClient: SuiClient
) => {
  const pythPackageId =
    cliOptions.existingPythPackageId ??
    (
      await publishPackageWithLog(
        {
          network,
          fullNodeUrl,
          packagePath: path.resolve(cliOptions.pythContractPath),
          keypair,
          withUnpublishedDependencies: true,
          keystorePath: cliOptions.keystorePath,
        },
        suiClient
      )
    ).packageId;

  if (pythPackageId !== cliOptions.existingPythPackageId)
    await writeMockArtifact(mockArtifactPath, {
      pythPackageId,
    });

  const coinPackageId =
    cliOptions.existingCoinPackageId ||
    (
      await publishPackageWithLog(
        {
          network,
          fullNodeUrl,
          packagePath: path.resolve(cliOptions.coinContractPath),
          keypair,
          keystorePath: cliOptions.keystorePath,
        },
        suiClient
      )
    ).packageId;

  if (coinPackageId !== cliOptions.existingCoinPackageId)
    await writeMockArtifact(mockArtifactPath, {
      coinPackageId,
    });

  return {
    pythPackageId,
    coinPackageId,
  };
};

const readDeploymentArtifacts = async (
  network: NetworkName
): Promise<PublishArtifact[]> => {
  try {
    return await readArtifact<PublishArtifact[]>(
      getDeploymentArtifactPath(network),
      []
    );
  } catch (error) {
    logWarning(
      error instanceof Error
        ? error.message
        : "Unable to read deployment artifacts"
    );
    return [];
  }
};

const resolveRegistryAndClockRefs = async (suiClient: SuiClient) => {
  const [coinRegistryObject, clockObject] = await Promise.all([
    getSuiSharedObject(
      { objectId: SUI_COIN_REGISTRY_ID, mutable: true },
      suiClient
    ),
    getSuiSharedObject({ objectId: SUI_CLOCK_ID }, suiClient),
  ]);
  return { coinRegistryObject, clockObject };
};

const ensureMockCoins = async (
  {
    coinPackageId,
    owner,
    signer,
    coinRegistryObject,
  }: {
    coinPackageId: string;
    owner: string;
    signer: Ed25519Keypair;
    coinRegistryObject: WrappedSuiSharedObject;
  },
  suiClient: SuiClient
): Promise<CoinArtifact[]> =>
  await Promise.all(
    buildCoinSeeds(coinPackageId).map(async (seed) => {
      return await ensureCoin(
        {
          seed,
          owner,
          signer,
          coinRegistryObject,
        },
        suiClient
      );
    })
  );

const ensureCoin = async (
  {
    seed,
    owner,
    signer,
    coinRegistryObject,
  }: {
    seed: CoinSeed;
    owner: string;

    signer: Ed25519Keypair;
    coinRegistryObject: WrappedSuiSharedObject;
  },
  suiClient: SuiClient
): Promise<CoinArtifact> => {
  const currencyObjectId = deriveCurrencyId(seed.coinType);

  const [metadata, currencyObject, mintedCoinObjectId] = await Promise.all([
    suiClient.getCoinMetadata({ coinType: seed.coinType }),
    getObjectSafe(suiClient, currencyObjectId, {
      showType: true,
      showBcs: true,
    }),
    findOwnedCoinObjectId({ suiClient, owner, coinType: seed.coinType }),
  ]);
  const coinTypeSuffix = `<${seed.coinType}>`;
  const currencyType = `0x2::coin_registry::Currency${coinTypeSuffix}`;

  if (metadata || objectTypeMatches(currencyObject, currencyType)) {
    if (!objectTypeMatches(currencyObject, currencyType)) {
      logWarning(
        `Currency object for ${seed.label} not readable; using derived ID ${currencyObjectId}.`
      );
    } else {
      logKeyValueBlue("Coin")(`${seed.label} ${seed.coinType}`);
    }
    return {
      label: seed.label,
      coinType: seed.coinType,
      currencyObjectId,
      mintedCoinObjectId,
    };
  }

  const tx = newTransaction(DEFAULT_TX_GAS_BUDGET);
  tx.moveCall({
    target: seed.initTarget,
    arguments: [
      tx.sharedObjectRef(coinRegistryObject.sharedRef),
      tx.pure.address(owner),
    ],
  });

  const result = await signAndExecute(
    {
      tx,
      signer,
    },
    suiClient
  );
  assertTransactionSuccess(result);

  const created = coinArtifactsFromResult({
    result,
    seed,
    derivedCurrencyId: currencyObjectId,
  });

  logKeyValueGreen("Coin")(`${seed.label} ${created.currencyObjectId}`);

  return {
    ...created,
    mintedCoinObjectId: created.mintedCoinObjectId ?? mintedCoinObjectId,
  };
};

const coinArtifactsFromResult = ({
  result,
  seed,
  derivedCurrencyId,
}: {
  result: Awaited<ReturnType<typeof signAndExecute>>;
  seed: CoinSeed;
  derivedCurrencyId: string;
}): CoinArtifact => {
  const coinTypeSuffix = `<${seed.coinType}>`;
  const currencyObjectId =
    firstCreatedBySuffix(
      result,
      `::coin_registry::Currency${coinTypeSuffix}`
    ) ?? derivedCurrencyId;

  return {
    label: seed.label,
    coinType: seed.coinType,
    currencyObjectId,
    treasuryCapId: firstCreatedBySuffix(
      result,
      `::coin::TreasuryCap${coinTypeSuffix}`
    ),
    metadataObjectId: firstCreatedBySuffix(
      result,
      `::coin::CoinMetadata${coinTypeSuffix}`
    ),
    mintedCoinObjectId: firstCreatedBySuffix(
      result,
      `::coin::Coin${coinTypeSuffix}`
    ),
  };
};

const ensurePriceFeeds = async ({
  pythPackageId,
  suiClient,
  signer,
  existingPriceFeeds,
  clockObject,
}: {
  pythPackageId: string;
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  existingPriceFeeds: PriceFeedArtifact[];
  clockObject: WrappedSuiSharedObject;
}): Promise<PriceFeedArtifact[]> => {
  const priceInfoType = getPythPriceInfoType(pythPackageId);
  const feeds: PriceFeedArtifact[] = [];

  for (const feedConfig of DEFAULT_FEEDS) {
    const matchingExisting = findMatchingFeed(existingPriceFeeds, feedConfig);
    const existingObject = matchingExisting
      ? await getObjectSafe(suiClient, matchingExisting.priceInfoObjectId)
      : undefined;

    if (matchingExisting && objectTypeMatches(existingObject, priceInfoType)) {
      feeds.push(matchingExisting);
      continue;
    }

    if (matchingExisting) {
      logWarning(
        `Feed ${feedConfig.label} not found or mismatched; recreating fresh object.`
      );
    }

    const createdFeed = await publishPriceFeed({
      feedConfig,
      pythPackageId,
      suiClient,
      signer,
      clockObject,
    });
    feeds.push(createdFeed);
  }

  return feeds;
};

const publishPriceFeed = async ({
  feedConfig,
  pythPackageId,
  suiClient,
  signer,
  clockObject,
}: {
  feedConfig: LabeledPriceFeedConfig;
  pythPackageId: string;
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  clockObject: WrappedSuiSharedObject;
}): Promise<PriceFeedArtifact> => {
  const tx = newTransaction(DEFAULT_TX_GAS_BUDGET);
  publishMockPriceFeed(
    tx,
    pythPackageId,
    feedConfig,
    tx.sharedObjectRef(clockObject.sharedRef)
  );

  const result = await signAndExecute(
    {
      tx,
      signer,
    },
    suiClient
  );
  assertTransactionSuccess(result);

  const [priceInfoObjectId] = findCreatedObjectIds(
    result,
    "::price_info::PriceInfoObject"
  );

  if (!priceInfoObjectId)
    throw new Error(`Missing price feed object for ${feedConfig.label}`);

  logKeyValueGreen("Feed")(`${feedConfig.label} ${priceInfoObjectId}`);

  return {
    label: feedConfig.label,
    feedIdHex: feedConfig.feedIdHex,
    priceInfoObjectId,
  };
};

const buildCoinSeeds = (coinPackageId: string): CoinSeed[] => {
  const normalizedPackageId = normalizeSuiObjectId(coinPackageId);
  return [
    {
      label: "LocalMockUsd",
      coinType: `${normalizedPackageId}::mock_coin::LocalMockUsd`,
      initTarget: `${normalizedPackageId}::mock_coin::init_local_mock_usd`,
    },
    {
      label: "LocalMockBtc",
      coinType: `${normalizedPackageId}::mock_coin::LocalMockBtc`,
      initTarget: `${normalizedPackageId}::mock_coin::init_local_mock_btc`,
    },
  ];
};

const deriveCurrencyId = (coinType: string) =>
  deriveObjectID(
    SUI_COIN_REGISTRY_ID,
    `0x2::coin_registry::CurrencyKey<${coinType}>`,
    new Uint8Array()
  );

const findMatchingFeed = (
  existingPriceFeeds: PriceFeedArtifact[],
  feedConfig: LabeledPriceFeedConfig
) =>
  existingPriceFeeds.find(
    (feed) =>
      normalizeHex(feed.feedIdHex) === normalizeHex(feedConfig.feedIdHex) ||
      feed.label === feedConfig.label
  );

const getObjectSafe = async (
  suiClient: SuiClient,
  objectId: string,
  options: SuiObjectDataOptions = { showType: true, showBcs: true }
): Promise<SuiObjectResponse | undefined> => {
  try {
    const normalizedId = normalizeSuiObjectId(objectId);
    return await suiClient.getObject({
      id: normalizedId,
      options: { showType: true, showBcs: true, ...options },
    });
  } catch {
    return undefined;
  }
};

const extractObjectType = (object: SuiObjectResponse | undefined) =>
  object?.data?.type ||
  // Some RPC responses only return the type inside BCS or content.
  (object?.data as any)?.bcs?.type ||
  (object?.data as any)?.content?.type;

const objectTypeMatches = (
  object: SuiObjectResponse | undefined,
  expectedType: string
) => extractObjectType(object)?.toLowerCase() === expectedType.toLowerCase();

const findOwnedCoinObjectId = async ({
  suiClient,
  owner,
  coinType,
}: {
  suiClient: SuiClient;
  owner: string;
  coinType: string;
}) => {
  try {
    const coins = await suiClient.getCoins({ owner, coinType, limit: 1 });
    return coins.data?.[0]?.coinObjectId;
  } catch {
    return undefined;
  }
};

const firstCreatedBySuffix = (
  result: SuiTransactionBlockResponse,
  suffix: string
) => findCreatedObjectIds(result, suffix)[0];

const normalizeHex = (value: string) => value.toLowerCase().replace(/^0x/, "");

/**
 * Parses CLI flags and enforces that publish/package ID inputs are provided.
 */
const parseSetupLocalCliArgs = async (
  mockArtifact: MockArtifact,
  accounts: {
    keystorePath: string;
    accountIndex: number;
    accountAddress?: string;
  }
): Promise<SetupLocalCliArgs> => {
  const providedCliArgument = await yargs(hideBin(process.argv))
    .scriptName("setup-local")
    .option("coin-package-id", {
      type: "string",
      description:
        "Package ID of the Coin Move package on the local localNetwork",
    })
    .option("coin-contract-path", {
      type: "string",
      description: "Path to the local coin stub Move package to publish",
      default: DEFAULT_COIN_CONTRACT_PATH,
    })
    .option("pyth-package-id", {
      type: "string",
      description:
        "Package ID of the Pyth Move package on the local localNetwork",
    })
    .option("pyth-contract-path", {
      type: "string",
      description: "Path to the local Pyth stub Move package to publish",
      default: DEFAULT_PYTH_CONTRACT_PATH,
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
    keystorePath: accounts.keystorePath,
    accountIndex: accounts.accountIndex,
    accountAddress: accounts.accountAddress,
    existingPythPackageId: providedCliArgument.rePublish
      ? undefined
      : providedCliArgument.pythPackageId || mockArtifact.pythPackageId,
    existingCoinPackageId: providedCliArgument.rePublish
      ? undefined
      : providedCliArgument.coinPackageId || mockArtifact.coinPackageId,
    existingPriceFeeds: providedCliArgument.rePublish
      ? undefined
      : mockArtifact.priceFeeds,
    existingCoins: providedCliArgument.rePublish
      ? undefined
      : mockArtifact.coins,
  };
};
