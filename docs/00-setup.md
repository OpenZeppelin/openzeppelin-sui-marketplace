# 00 - Setup + Quickstart

**Path:** [Learning Path](./) > 00 Setup + Quickstart

This chapter gets your environment ready and walks through a complete localnet run: install tooling, publish packages, seed mocks, and run the UI.

## 1. Learning goals

1. Install the Sui CLI (1.67.x) and verify it works.
2. Create and fund an address for localnet/testnet use.
3. Install dependencies and publish the Move package.
4. Seed mock coins + Pyth data and run the UI.

## 2. Prerequisites

- Node.js 22+ [Install](https://nodejs.org/en/download)
- pnpm [Install](https://pnpm.io/installation)
- Sui CLI [Install](https://docs.sui.io/guides/developer/getting-started/sui-install)
- Optional vs code extension [Install](https://docs.sui.io/references/ide/move)

## 3. Install Sui CLI (1.67.x)

This repo is tested against Sui CLI **1.67.x**. Pin a specific patch version so upgrades do not surprise you.

```bash
curl -sSfL https://raw.githubusercontent.com/Mystenlabs/suiup/main/install.sh | sh
suiup list
suiup install sui@testnet
sui --version
```

## 4. Clone + install dependencies

```bash
git clone git@github.com:OpenZeppelin/openzeppelin-sui-marketplace.git
cd openzeppelin-sui-marketplace
pnpm install
```

## 5. Create two addresses — owner and buyer

The localnet workflow uses two identities: an **owner** (deploys contracts, seeds the shop) and a **buyer** (purchases items via CLI). On testnet the buyer uses the browser wallet instead — no buyer key needed there.

```bash
sui client new-address ed25519   # owner — note the recovery phrase; import into Slush later
sui client new-address ed25519   # buyer (localnet only) — same
```

Validate and list addresses:

```bash
sui client addresses
```

## 6. Configure account env

Copy `packages/dapp/.env.example` to `packages/dapp/.env` and fill in both accounts:

```bash
SUI_NETWORK=localnet

# Owner — signs owner scripts (deploy, seed, manage shop)
SUI_ACCOUNT_ADDRESS=<owner-0x...>
SUI_ACCOUNT_PRIVATE_KEY=<owner-key>

# Buyer — signs buyer CLI scripts automatically (buyer:buy)
# Leave empty on testnet; the buyer uses the browser wallet there
SUI_BUYER_ACCOUNT_ADDRESS=<buyer-0x...>
SUI_BUYER_ACCOUNT_PRIVATE_KEY=<buyer-key>
```

If `SUI_BUYER_ACCOUNT_*` is not set, buyer scripts fall back to the owner account (a warning is printed at startup).

> Sections 7–11 below walk through the underlying scripts step by step. For a one-command path that runs steps 8–11 in sequence and writes the UI env automatically, run `pnpm bootstrap:localnet` after starting localnet (step 7). See [`docs/06-scripts-reference.md`](06-scripts-reference.md#bootstrap-scripts-one-command-setup) for what it does internally.

## 7. Start localnet (localnet only)

```bash
pnpm script chain:localnet:start --with-faucet
```

The `--with-faucet` flag will run the faucet runs alongside the localnet allowing to automatically fund address if needed. Note that on first start it will fund your configured address.

If you later want to reset the state of your localnet use (this will update the localnet address registered in your `Move` packages in Move.toml)

```bash
pnpm script chain:localnet:start --with-faucet --force-regenesis
```

## 8. Seed mocks (localnet only)

This publishes mock coins and Pyth packages, then seeds price feeds. As there are no coins or published Pyth oracle on your blank localnet

```bash
pnpm script mock:setup --network localnet
# Buyer address is read from SUI_BUYER_ACCOUNT_ADDRESS automatically.
# Override with --buyer-address <0x...> if needed.
```

## 9. Publish the Move package

```bash
pnpm script move:publish --package-path oracle-market
```

The published package ID is written to:
`packages/dapp/deployments/deployment.localnet.json`

```json
{
  "network": "localnet",
  "rpcUrl": "http://127.0.0.1:9000",
  "packagePath": "../sui-oracle-market/packages/dapp/contracts/oracle-market",
  "packageName": "sui_oracle_market",
  "packageId": "0x9c7be8c6354e23ec59e8d50c755a5f9ccdb08424e82a72f6991afedaa7ae49ec",
  "upgradeCap": "0xcd483668f30a9069075d9513222ebd8b76d9f5ee1909c7f758161805ee03ae96",
  "publisherId": "0x3627f2326fe826b6dc6b8e8f65be066a838f2df18c5fcac204904b0f58adb968",
  "isDependency": false,
  "sender": "0x4f5fd198675da3f90a1cf3006d5cd3576dee4804fb8ca87cb9cfb964772125d1",
  "digest": "54ngfCMuc1n1LrV4F8Y1Bukipuq8HayLBGirTT4LhnYD",
  "publishedAt": "2026-01-27T03:16:49.889Z",
  "modules": ["oRzrCwcAAAUPAQA+Aj7...QIAAgEA"],
  "dependencies": [
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    "0x4fc18b29048e9fe89a104d9b46ba88b7885581484cc5867a3b4374173ce6d3d5",
    "0x0000000000000000000000000000000000000000000000000000000000000002"
  ],
  "dependencyAddresses": {},
  "withUnpublishedDependencies": true,
  "unpublishedDependencies": [],
  "suiCliVersion": "1.63.1-a14d9e8ddadf",
  "explorerUrl": "https://explorer.sui.io/txblock/54ngfCMuc1n1LrV4F8Y1Bukipuq8HayLBGirTT4LhnYD?network=localnet"
}
```

## 10. Create a shop (and/or optionally seed data)

Note that seed will create a store if you did not create one

```bash
pnpm script owner:shop:create --name "Oracle Shop"
pnpm script owner:shop:seed
```

The created objects are saved in:
`packages/dapp/deployments/object.localnet.json`

```json
[
  {
    "packageId": "0xbb2c7e2b22c24e21edd6e65f9220185219c714e0154ded16a5e0197297c59c09",
    "signer": "0x4f5fd198675da3f90a1cf3006d5cd3576dee4804fb8ca87cb9cfb964772125d1",
    "objectId": "0x1c89e11c8d1959a382e3df0615361cec1c5e0b4aeae6a55519274bb96a3accb1",
    "objectType": "0xbb2c7e2b22c24e21edd6e65f9220185219c714e0154ded16a5e0197297c59c09::shop::Shop",
    "owner": {
      "ownerType": "shared",
      "initialSharedVersion": "744066759"
    },
    "initialSharedVersion": "744066759",
    "version": "744114833",
    "digest": "HG3fa84hVQN4FvUhiuAvqtDDkuyRKwCQ4pWAzHrtojCv"
  }
]
```

## 11. Run the UI to see the shop

If you ran `pnpm bootstrap:localnet`, `packages/ui/.env.local` was already written. Skip ahead to `pnpm ui dev`. Otherwise, create the file manually with IDs from your deployment artifacts:

- `NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID` — `packageId` from the `sui_oracle_market` entry in `packages/dapp/deployments/deployment.localnet.json`
- `NEXT_PUBLIC_LOCALNET_SHOP_ID` — `objectId` from the entry whose `objectType` ends with `::shop::Shop` in `packages/dapp/deployments/objects.localnet.json`

```bash
NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
NEXT_PUBLIC_LOCALNET_SHOP_ID=0x...
```

Start the app:

```bash
pnpm ui dev
```

## 12. Sanity checks using scripts

```bash
pnpm script buyer:shop:view
pnpm script buyer:item-listing:list --shop-id <shopId>
```

Find all the scripts references in [06 Scripts reference (CLI)](./06-scripts-reference.md)

## 13. Further reading

- https://docs.sui.io/guides/developer/getting-started/sui-install
- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://docs.sui.io/guides/developer/objects/object-model

## 14. Navigation

1. Next: [01 Repo Layout + How to Navigate](./01-repo-layout.md)
2. Back to map: [Learning Path Map](./)
