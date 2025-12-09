import "dotenv/config";
import path from "node:path";

import {
  SuiClient,
  type SuiObjectResponse,
  type SuiTransactionBlockResponse,
} from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ensureFoundedAddress } from "../utils/address";
import { readArtifact } from "../utils/artifacts";
import { DEFAULT_KEYSTORE_PATH, getDeploymentArtifactPath } from "../utils/constants";
import { hexToBytes } from "../utils/hex";
import { loadKeypair } from "../utils/keypair";
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
  findCreatedObjectIds,
  newTx,
  signAndExecute,
} from "../utils/transactions";
import type { NetworkName, PublishArtifact } from "../utils/types";
import {
  MockArtifact,
  mockArtifactPath,
  writeMockArtifact,
} from "../utils/mock";

type SetupLocalCliArgs = {
  keystorePath: string;
  accountIndex: number;
  coinContractPath: string;
  existingCoinPackageId?: string;
  pythContractPath: string;
  existingPythPackageId?: string;
  rePublish: boolean;
  shopPackageId?: string;
  shopUpgradeCapId?: string;
  shopPackagePath: string;
  shopPublisherId?: string;
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

// ID of the shared CoinRegistry object.
const COIN_REGISTRY_ID = normalizeSuiObjectId(
  "0x000000000000000000000000000000000000000000000000000000000000000c"
);

type LabeledPriceFeedConfig = MockPriceFeedConfig & { label: string };
type CoinArtifact = NonNullable<MockArtifact["coins"]>[number];
type PriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number];
type ShopArtifact = NonNullable<MockArtifact["shop"]>;
type AcceptedCurrencyArtifact =
  NonNullable<MockArtifact["acceptedCurrencies"]>[number];
type ItemListingArtifact = NonNullable<MockArtifact["itemListings"]>[number];
type CoinSeed = {
  label: string;
  coinType: string;
  initTarget: string;
};
type SharedObjectRef = {
  objectId: string;
  initialSharedVersion: number | string | bigint;
  mutable: boolean;
};
type AcceptedCurrencySeed = {
  label: string;
  coinLabel: string;
  feedLabel: string;
  maxPriceAgeSecsCap?: number;
  maxConfidenceRatioBpsCap?: number;
  maxPriceStatusLagSecsCap?: number;
};
type ItemListingSeed = {
  label: string;
  itemType: string;
  basePriceUsdCents: number;
  stock: number;
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

const DEFAULT_ACCEPTED_CURRENCIES: AcceptedCurrencySeed[] = [
  {
    label: "MockUsdCurrency",
    coinLabel: "LocalMockUsd",
    feedLabel: "MOCK_USD_FEED",
  },
  {
    label: "MockBtcCurrency",
    coinLabel: "LocalMockBtc",
    feedLabel: "MOCK_BTC_FEED",
  },
];

const DEFAULT_ITEM_LISTINGS: ItemListingSeed[] = [
  {
    label: "Cool Bike",
    itemType: "vector<u8>",
    basePriceUsdCents: 125_00,
    stock: 50,
  },
];

const DEFAULT_TX_GAS_BUDGET = 100_000_000;

runSuiScript(async () => {
  const localNetwork: NetworkName = "localnet";

  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {});
  const deploymentArtifacts = await readDeploymentArtifacts(localNetwork);
  const cliOptions = await parseSetupLocalCliArgs(mockArtifact ?? {});
  const fullNodeUrl = resolveRpcUrl(localNetwork);

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

  const sharedRefs = await resolveSharedObjectRefs(suiClient);

  const coins = await ensureMockCoins({
    coinPackageId,
    owner: signerAddress,
    suiClient,
    signer: keypair,
    registryRef: sharedRefs.coinRegistryRef,
  });

  await writeMockArtifact(mockArtifactPath, {
    coins,
  });

  const priceFeeds = await ensurePriceFeeds({
    pythPackageId,
    suiClient,
    signer: keypair,
    clockRef: sharedRefs.clockRef,
    // align with cli output pattern
    existingPriceFeeds:
      cliOptions.rePublish || !mockArtifact?.priceFeeds
        ? []
        : mockArtifact.priceFeeds,
  });

  await writeMockArtifact(mockArtifactPath, {
    priceFeeds,
  });

  const shopConfig = resolveShopConfig({
    cliOptions,
    mockArtifact,
    deploymentArtifacts,
  });

  const publisherId = await ensurePublisher({
    suiClient,
    signerAddress,
    signer: keypair,
    shopPackageId: shopConfig.shopPackageId,
    upgradeCapId: shopConfig.shopUpgradeCapId,
    existingPublisherId: shopConfig.shopPublisherId,
  });

  const shop = await ensureShop({
    suiClient,
    signer: keypair,
    shopPackageId: shopConfig.shopPackageId,
    publisherId,
    existingShop: cliOptions.rePublish ? undefined : mockArtifact?.shop,
  });
  const shopSharedRef = await fetchSharedObjectRef(
    suiClient,
    shop.shopId,
    true
  );

  await writeMockArtifact(mockArtifactPath, {
    shop: {
      packageId: shopConfig.shopPackageId,
      upgradeCapId: shopConfig.shopUpgradeCapId,
      publisherId,
      shopId: shop.shopId,
      shopOwnerCapId: shop.shopOwnerCapId,
      shopInitialSharedVersion: Number(shopSharedRef.initialSharedVersion),
    },
  });

  const acceptedCurrencies = await ensureAcceptedCurrencies({
    suiClient,
    signer: keypair,
    shopPackageId: shopConfig.shopPackageId,
    shopSharedRef,
    ownerCapId: shop.shopOwnerCapId,
    coins,
    priceFeeds,
    rePublish: cliOptions.rePublish,
    existingAcceptedCurrencies: cliOptions.rePublish
      ? []
      : mockArtifact.acceptedCurrencies ?? [],
  });

  await writeMockArtifact(mockArtifactPath, {
    acceptedCurrencies,
    shop: {
      packageId: shopConfig.shopPackageId,
      upgradeCapId: shopConfig.shopUpgradeCapId,
      publisherId,
      shopId: shop.shopId,
      shopOwnerCapId: shop.shopOwnerCapId,
      shopInitialSharedVersion: Number(shopSharedRef.initialSharedVersion),
    },
  });

  const itemListings = await ensureItemListings({
    suiClient,
    signer: keypair,
    shopPackageId: shopConfig.shopPackageId,
    shopSharedRef,
    ownerCapId: shop.shopOwnerCapId,
    rePublish: cliOptions.rePublish,
    existingListings: cliOptions.rePublish
      ? []
      : mockArtifact.itemListings ?? [],
  });

  await writeMockArtifact(mockArtifactPath, {
    itemListings,
    shop: {
      packageId: shopConfig.shopPackageId,
      upgradeCapId: shopConfig.shopUpgradeCapId,
      publisherId,
      shopId: shop.shopId,
      shopOwnerCapId: shop.shopOwnerCapId,
      shopInitialSharedVersion: Number(shopSharedRef.initialSharedVersion),
    },
  });

  logKeyValueGreen("Pyth package")(pythPackageId);
  logKeyValueGreen("Coin package")(coinPackageId);
  logKeyValueBlue("Feeds")(priceFeeds.length);
  logKeyValueBlue("Coins")(coins.length);
  logKeyValueBlue("Accepted currencies")(acceptedCurrencies.length);
  logKeyValueBlue("Listings")(itemListings.length);
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

const resolveShopConfig = ({
  cliOptions,
  mockArtifact,
  deploymentArtifacts,
}: {
  cliOptions: SetupLocalCliArgs;
  mockArtifact: MockArtifact;
  deploymentArtifacts: PublishArtifact[];
}) => {
  const deployment = findDeploymentByPathOrId(
    deploymentArtifacts,
    cliOptions.shopPackagePath,
    cliOptions.shopPackageId ?? mockArtifact.shop?.packageId
  );

  const resolvedPackageId =
    cliOptions.shopPackageId ??
    mockArtifact.shop?.packageId ??
    deployment?.packageId;

  if (!resolvedPackageId)
    throw new Error(
      "Shop package ID is required. Publish the Move package or pass --shop-package-id."
    );

  const normalizedPackageId = normalizeSuiObjectId(resolvedPackageId);
  const resolvedUpgradeCapId =
    cliOptions.shopUpgradeCapId ??
    mockArtifact.shop?.upgradeCapId ??
    deployment?.upgradeCap;
  const resolvedPublisherId =
    cliOptions.shopPublisherId ?? mockArtifact.shop?.publisherId;

  return {
    shopPackageId: normalizedPackageId,
    shopUpgradeCapId: resolvedUpgradeCapId
      ? normalizeSuiObjectId(resolvedUpgradeCapId)
      : undefined,
    shopPublisherId: resolvedPublisherId
      ? normalizeSuiObjectId(resolvedPublisherId)
      : undefined,
  };
};

const resolveSharedObjectRefs = async (suiClient: SuiClient) => {
  const [coinRegistryRef, clockRef] = await Promise.all([
    fetchSharedObjectRef(suiClient, COIN_REGISTRY_ID, true),
    fetchSharedObjectRef(suiClient, SUI_CLOCK_ID, false),
  ]);
  return { coinRegistryRef, clockRef };
};

const ensureMockCoins = async ({
  coinPackageId,
  owner,
  suiClient,
  signer,
  registryRef,
}: {
  coinPackageId: string;
  owner: string;
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  registryRef: SharedObjectRef;
}): Promise<CoinArtifact[]> => {
  const seeds = buildCoinSeeds(coinPackageId);

  const coins: CoinArtifact[] = [];
  for (const seed of seeds) {
    const coin = await ensureCoin({
      seed,
      owner,
      suiClient,
      signer,
      registryRef,
    });
    coins.push(coin);
  }

  return coins;
};

const ensureCoin = async ({
  seed,
  owner,
  suiClient,
  signer,
  registryRef,
}: {
  seed: CoinSeed;
  owner: string;
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  registryRef: SharedObjectRef;
}): Promise<CoinArtifact> => {
  const currencyObjectId = deriveCurrencyId(seed.coinType);
  const [metadata, currencyObject, mintedCoinObjectId] = await Promise.all([
    suiClient.getCoinMetadata({ coinType: seed.coinType }),
    getObjectSafe(suiClient, currencyObjectId),
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

  const tx = newTx(DEFAULT_TX_GAS_BUDGET);
  tx.moveCall({
    target: seed.initTarget,
    arguments: [tx.sharedObjectRef(registryRef), tx.pure.address(owner)],
  });

  const result = await signAndExecute({
    client: suiClient,
    tx,
    signer,
  });
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
  clockRef,
}: {
  pythPackageId: string;
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  existingPriceFeeds: PriceFeedArtifact[];
  clockRef: SharedObjectRef;
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
      clockRef,
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
  clockRef,
}: {
  feedConfig: LabeledPriceFeedConfig;
  pythPackageId: string;
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  clockRef: SharedObjectRef;
}): Promise<PriceFeedArtifact> => {
  const tx = newTx(DEFAULT_TX_GAS_BUDGET);
  publishMockPriceFeed(
    tx,
    pythPackageId,
    feedConfig,
    tx.sharedObjectRef(clockRef)
  );

  const result = await signAndExecute({
    client: suiClient,
    tx,
    signer,
  });
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

const ensurePublisher = async ({
  suiClient,
  signerAddress,
  signer,
  shopPackageId,
  upgradeCapId,
  existingPublisherId,
}: {
  suiClient: SuiClient;
  signerAddress: string;
  signer: Ed25519Keypair;
  shopPackageId: string;
  upgradeCapId?: string;
  existingPublisherId?: string;
}): Promise<string> => {
  const normalizedPackageId = normalizeSuiObjectId(shopPackageId);
  if (existingPublisherId) {
    const existing = await getObjectSafe(suiClient, existingPublisherId, {
      showType: true,
      showOwner: true,
      showContent: true,
    });
    if (
      objectTypeMatches(existing, "0x2::package::Publisher") &&
      publisherMatchesPackage(existing, normalizedPackageId) &&
      ownedByAddress(existing, signerAddress)
    ) {
      logKeyValueBlue("Publisher")(existingPublisherId);
      return normalizeSuiObjectId(existingPublisherId);
    }
    logWarning(
      `Publisher ${existingPublisherId} missing or mismatched; attempting to claim a new one.`
    );
  }

  if (!upgradeCapId)
    throw new Error(
      "Upgrade cap ID is required to claim a Publisher for the shop package."
    );

  const upgradeCap = await getObjectSafe(suiClient, upgradeCapId, {
    showType: true,
    showOwner: true,
    showContent: true,
  });

  if (!upgradeCap)
    throw new Error(`Upgrade cap ${upgradeCapId} not found on chain.`);

  if (!objectTypeMatches(upgradeCap, "0x2::package::UpgradeCap")) {
    logWarning(
      `Upgrade cap ${upgradeCapId} has unexpected type ${upgradeCap.data?.type}`
    );
  }

  assertOwnedBy(upgradeCap, signerAddress, "Upgrade cap");
  assertUpgradeCapMatchesPackage(upgradeCap, normalizedPackageId);

  const tx = newTx(DEFAULT_TX_GAS_BUDGET);
  tx.moveCall({
    target: "0x2::package::claim",
    arguments: [tx.object(upgradeCapId)],
  });

  const result = await signAndExecute({
    client: suiClient,
    tx,
    signer,
  });
  assertTransactionSuccess(result);

  const publisherId = firstCreatedBySuffix(result, "::package::Publisher");
  if (!publisherId)
    throw new Error("Publisher claim succeeded but no Publisher object found.");

  logKeyValueGreen("Publisher")(publisherId);

  return normalizeSuiObjectId(publisherId);
};

const ensureShop = async ({
  suiClient,
  signer,
  shopPackageId,
  publisherId,
  existingShop,
}: {
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  shopPackageId: string;
  publisherId: string;
  existingShop?: ShopArtifact;
}): Promise<{ shopId: string; shopOwnerCapId: string }> => {
  const signerAddress = signer.toSuiAddress();
  const normalizedPackageId = normalizeSuiObjectId(shopPackageId);
  const shopType = `${normalizedPackageId}::shop::Shop`;
  const ownerCapType = `${normalizedPackageId}::shop::ShopOwnerCap`;
  const reusable = await reuseExistingShop({
    suiClient,
    signerAddress,
    existingShop,
    shopType,
    ownerCapType,
  });

  if (reusable) return reusable;

  const tx = newTx(DEFAULT_TX_GAS_BUDGET);
  tx.moveCall({
    target: `${normalizedPackageId}::shop::create_shop`,
    arguments: [tx.object(publisherId)],
  });

  const result = await signAndExecute({
    client: suiClient,
    tx,
    signer,
  });
  assertTransactionSuccess(result);

  const shopId = firstCreatedBySuffix(result, "::shop::Shop");
  const shopOwnerCapId = firstCreatedBySuffix(
    result,
    "::shop::ShopOwnerCap"
  );

  if (!shopId || !shopOwnerCapId)
    throw new Error("Shop creation succeeded without expected objects.");

  logKeyValueGreen("Shop")(shopId);
  logKeyValueGreen("Shop owner cap")(shopOwnerCapId);

  return { shopId, shopOwnerCapId };
};

const ensureAcceptedCurrencies = async ({
  suiClient,
  signer,
  shopPackageId,
  shopSharedRef,
  ownerCapId,
  coins,
  priceFeeds,
  existingAcceptedCurrencies,
  rePublish,
}: {
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  shopPackageId: string;
  shopSharedRef: SharedObjectRef;
  ownerCapId: string;
  coins: CoinArtifact[];
  priceFeeds: PriceFeedArtifact[];
  existingAcceptedCurrencies: AcceptedCurrencyArtifact[];
  rePublish: boolean;
}): Promise<AcceptedCurrencyArtifact[]> => {
  const results: AcceptedCurrencyArtifact[] = [];
  for (const seed of DEFAULT_ACCEPTED_CURRENCIES) {
    const coin = requireCoin(coins, seed.coinLabel);
    const feed = requirePriceFeed(priceFeeds, seed.feedLabel);
    const existing = findMatchingAcceptedCurrency(
      existingAcceptedCurrencies,
      seed,
      shopSharedRef.objectId,
      coin.coinType,
      feed.feedIdHex
    );

    if (existing && !rePublish) {
      const reusable = await reuseAcceptedCurrency({
        suiClient,
        shopPackageId,
        acceptedCurrency: existing,
      });
      if (reusable) {
        results.push(reusable);
        continue;
      }
      logWarning(
        `Accepted currency ${existing.acceptedCurrencyId} missing or mismatched; recreating.`
      );
    }

    const created = await createAcceptedCurrency({
      suiClient,
      signer,
      shopPackageId,
      shopSharedRef,
      ownerCapId,
      seed,
      coin,
      feed,
    });
    results.push(created);
  }

  return results;
};

const ensureItemListings = async ({
  suiClient,
  signer,
  shopPackageId,
  shopSharedRef,
  ownerCapId,
  existingListings,
  rePublish,
}: {
  suiClient: SuiClient;
  signer: Ed25519Keypair;
  shopPackageId: string;
  shopSharedRef: SharedObjectRef;
  ownerCapId: string;
  existingListings: ItemListingArtifact[];
  rePublish: boolean;
}): Promise<ItemListingArtifact[]> => {
  const listings: ItemListingArtifact[] = [];

  for (const seed of DEFAULT_ITEM_LISTINGS) {
    const existing = findExistingListing(
      existingListings,
      shopSharedRef.objectId,
      seed.label,
      seed.itemType
    );

    if (existing && !rePublish) {
      const reusable = await reuseListing({
        suiClient,
        shopPackageId,
        listing: existing,
      });
      if (reusable) {
        listings.push(reusable);
        continue;
      }
      logWarning(
        `Listing ${existing.itemListingId} missing or mismatched; creating a fresh one.`
      );
    }

    const created = await createListing({
      suiClient,
      signer,
      shopPackageId,
      shopSharedRef,
      ownerCapId,
      seed,
    });
    listings.push(created);
  }

  return listings;
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
    COIN_REGISTRY_ID,
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
  objectId: string
): Promise<SuiObjectResponse | undefined> => {
  try {
    return await suiClient.getObject({
      id: objectId,
      options: { showType: true },
    });
  } catch {
    return undefined;
  }
};

const objectTypeMatches = (
  object: SuiObjectResponse | undefined,
  expectedType: string
) => object?.data?.type === expectedType;

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

const fetchSharedObjectRef = async (
  suiClient: SuiClient,
  objectId: string,
  mutable: boolean
): Promise<SharedObjectRef> => {
  const normalizedId = normalizeSuiObjectId(objectId);
  const object = await suiClient.getObject({
    id: normalizedId,
    options: { showOwner: true },
  });
  const owner: any = object.data?.owner;
  const shared = owner?.Shared ?? owner?.shared;

  if (!shared?.initial_shared_version)
    throw new Error(`Object ${objectId} is not shared or missing metadata`);

  return {
    objectId: normalizedId,
    initialSharedVersion: Number(shared.initial_shared_version),
    mutable,
  };
};

const assertTransactionSuccess = (result: SuiTransactionBlockResponse) => {
  const status = result.effects?.status?.status;
  if (status !== "success") {
    const error = result.effects?.status?.error;
    throw new Error(error || "Transaction failed");
  }
};

/**
 * Parses CLI flags and enforces that publish/package ID inputs are provided.
 */
const parseSetupLocalCliArgs = async (
  mockArtifact: MockArtifact
): Promise<SetupLocalCliArgs> => {
  const providedCliArgument = await yargs(hideBin(process.argv))
    .scriptName("setup-local")
    .option("keystore-path", {
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
    existingPythPackageId: providedCliArgument.rePublish
      ? undefined
      : providedCliArgument.pythPackageId || mockArtifact.pythPackageId,
    existingCoinPackageId: providedCliArgument.rePublish
      ? undefined
      : providedCliArgument.coinPackageId || mockArtifact.coinPackageId,
  };
};

/**
 * Loads the keypair used for publishing and seeding mock data.
 */
const loadDeployerKeypair = async ({
  keystorePath,
  accountIndex,
}: SetupLocalCliArgs) => {
  return loadKeypair({
    keystorePath,
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
