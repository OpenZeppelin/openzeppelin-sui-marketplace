
> [!Warning]
> This is experimental UN-AUDITED code

# Sui Oracle Market

End-to-end example of a small on-chain market on **Sui**: items are priced in **USD cents** (stablecoin-style), while buyers can pay in **multiple currencies** using **oracle prices**.

This repo is a pnpm workspace containing:
- a Move package `packages/dapp/contracts/oracle-market`,
- a CLI/script layer for localnet + seeding + owner/buyer flows `packages/dapp/src/scripts`
- state artifacts captured in `packages/dapp/deployments`
- a Next.js UI `packages/ui`,
- a docs site with learning path to help transition from EVM/Solidity to Sui/Move `packages/learn`.
- a tooling layer with integration test harness `packages/tooling`

More detail (workspace layering rules, folder layout): `docs/01-repo-layout.md`.

## Prerequisites
- Node.js 22+ [Install](https://nodejs.org/en/download)
- pnpm [Install](https://pnpm.io/installation)
- Sui CLI [Install](https://docs.sui.io/guides/developer/getting-started/sui-install)
- jq — used to extract IDs from deployment artifacts (`brew install jq` / `apt install jq`)


## Quickstart (Fresh Clone)

Full walkthrough: [docs/05-localnet-workflow.md](docs/05-localnet-workflow.md).

### 1. Clone and install

```bash
git clone git@github.com:OpenZeppelin/openzeppelin-sui-marketplace.git
cd openzeppelin-sui-marketplace
pnpm install
```

### 2. Create owner and buyer accounts

```bash
sui client new-address ed25519 owner
sui client new-address ed25519 buyer
```

Note the printed address and `recoveryPhrase` for each — you will need them in the next step and for importing into your browser wallet.

### 3. Set up environment profile files

```bash
cp packages/dapp/.env.owner.example packages/dapp/.env.owner
cp packages/dapp/.env.buyer.example packages/dapp/.env.buyer
```

Edit each file:

```
SUI_NETWORK=localnet
SUI_ACCOUNT_ADDRESS=<printed address>
# Leave SUI_ACCOUNT_PRIVATE_KEY blank when using a mnemonic
SUI_ACCOUNT_PRIVATE_KEY=
SUI_ACCOUNT_MNEMONIC="<printed recoveryPhrase>"
```

> **Note:** `pnpm script ...` automatically loads `packages/dapp/.env`.
> `pnpm env:owner` / `pnpm env:buyer` copy the named profile file into `packages/dapp/.env`.

### 4. Activate the owner profile

```bash
pnpm env:owner
pnpm env:status   # verify network + address
```

### 5. Start localnet

In a separate terminal:

```bash
pnpm script chain:localnet:start --with-faucet
```

`--with-faucet` is recommended; scripts auto-fund addresses when balance is low.

### 6. Publish oracle-market

```bash
pnpm script move:publish --package-path oracle-market --network localnet
```

> Localnet publish defaults to the SDK path in this repo's scripted bootstrap.
> Pass `--use-cli-publish` to use the Sui CLI instead.

### 7. Seed localnet mocks

```bash
BUYER_ADDRESS=$(grep SUI_ACCOUNT_ADDRESS packages/dapp/.env.buyer | cut -d= -f2)
pnpm script mock:setup --buyer-address "$BUYER_ADDRESS" --network localnet
```

> If oracle-market is re-published, re-run this step before seeding the shop.
> mock:setup automatically aligns price feeds with the oracle-market package you just published.

Then fund both addresses from the localnet faucet so they have SUI for gas and purchases:

```bash
OWNER_ADDRESS=$(grep SUI_ACCOUNT_ADDRESS packages/dapp/.env.owner | cut -d= -f2)
curl -X POST http://127.0.0.1:9123/gas -H "Content-Type: application/json" \
  -d "{\"FixedAmountRequest\":{\"recipient\":\"$OWNER_ADDRESS\"}}"
curl -X POST http://127.0.0.1:9123/gas -H "Content-Type: application/json" \
  -d "{\"FixedAmountRequest\":{\"recipient\":\"$BUYER_ADDRESS\"}}"
```

### 8. Seed the shop

```bash
pnpm -s script owner:shop:seed --network localnet --json | tee /tmp/shop-seed.json
```

### 9. Capture package and shop IDs

```bash
PACKAGE_ID=$(jq -r '[.[] | select(.packageName == "sui_oracle_market")] | last | .packageId' packages/dapp/deployments/deployment.localnet.json)
SHOP_ID=$(jq -r '.shopOverview.shopId' /tmp/shop-seed.json)
```

### 10. Configure the UI

Create `packages/ui/.env.local` (see `packages/ui/.env.example` for all variables):

```bash
cat > packages/ui/.env.local <<EOF
NEXT_PUBLIC_APP_NAME="Sui Oracle Market"
NEXT_PUBLIC_APP_DESCRIPTION="Local dev instance"
NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=$PACKAGE_ID
EOF
```

> The shop ID is passed via the URL query parameter, not an env variable.

### 11. Optional: buyer sanity check

```bash
pnpm env:buyer
pnpm script buyer:shop:view --network localnet --shop-id "$SHOP_ID" --json
pnpm env:owner   # switch back when done
```

### 12. Run the UI

```bash
pnpm ui dev
```

Then open the URL printed by:

```bash
echo "http://localhost:3000/?network=localnet&shopId=${SHOP_ID}"
```


## Existing Setup Migration

If you have a legacy single-account `packages/dapp/.env`, split it into profiles with:

```bash
pnpm env:bootstrap   # creates .env.owner and .env.buyer, then activates owner
pnpm env:status      # confirm active network + address
```

## Learning path

Start the docs website and follow along based on your goal:
```bash
pnpm --filter learn dev
```
and navigate to `localhost:30006` on your browser

Quick gotos:
- **Learning path hub:** [docs/README.md](docs/README.md)
- **Setup + quickstart:** [docs/00-setup.md](docs/00-setup.md)
- **Glossary:** [docs/22-glossary.md](docs/22-glossary.md)


## Frontend UI

- UI setup + localnet execution notes: [/reading/ui-readme](/reading/ui-readme)
- UI docs chapters: [docs/12-buyer-ui.md](docs/12-buyer-ui.md) and [docs/13-owner-ui.md](docs/13-owner-ui.md)
- Additional UI reference notes: [docs/11-ui-reference.md](docs/11-ui-reference.md)


## Tests

- Integration (localnet): `pnpm dapp test:integration`
- Full testing guide: [docs/15-testing.md](docs/15-testing.md)


## Docs (detailed)

The detailed docs live under `docs/`:
- Localnet end-to-end: [docs/05-localnet-workflow.md](docs/05-localnet-workflow.md)
- Script/CLI reference + artifacts: [docs/06-scripts-reference.md](docs/06-scripts-reference.md)
- UI reference notes: [docs/11-ui-reference.md](docs/11-ui-reference.md)
- Testing + script testing framework: [docs/15-testing.md](docs/15-testing.md)
- Troubleshooting: [docs/21-troubleshooting.md](docs/21-troubleshooting.md)
- Security & gotchas: [docs/20-security.md](docs/20-security.md)
- Moving to testnet/mainnet: [docs/19-moving-to-testnet.md](docs/19-moving-to-testnet.md)
- EVM → Sui cheatsheet: [docs/03-evm-to-sui.md](docs/03-evm-to-sui.md)

## Repository layout

```
.
├── packages/
│   ├── dapp/
│   │   ├── contracts/                 # Move packages (oracle-market + mocks + examples)
│   │   │   ├── oracle-market/         # Main Move package (sui_oracle_market)
│   │   │   ├── pyth-mock/             # Local-only Pyth stub (dev/localnet)
│   │   │   ├── coin-mock/             # Local-only mock coins (dev/localnet)
│   │   │   └── item-examples/         # Example item types for listings/receipts
│   │   ├── src/
│   │   │   ├── scripts/               # CLI scripts (chain, owner, buyer)
│   │   │   └── utils/                 # Script-only helpers (e.g. CLI output formatting)
│   │   ├── deployments/               # Generated artifacts from scripts
│   │   ├── sui.config.ts              # Network + paths config for scripts
│   │   └── package.json               # Script entry points
│   ├── domain/
│   │   ├── core/                      # Browser-safe domain models + queries
│   │   └── node/                      # Node-only domain helpers (if needed)
│   ├── tooling/
│   │   ├── core/                      # Browser-safe utilities + types
│   │   └── node/                      # Node-only script helpers (fs/process/yargs/etc)
│   └── ui/
│       ├── src/app/                   # Next.js app router UI
│       ├── public/                    # Static assets
│       ├── dist/                      # Static export output (from `pnpm ui build`)
│       └── package.json               # UI scripts
├── pnpm-workspace.yaml                # Workspace definition
├── package.json                       # Root wrappers (`pnpm script`, `pnpm ui`)
├── tsconfig.json                      # TS project references
├── tsconfig.base.json                 # Shared TS config
├── tsconfig.node.json                 # Shared TS config for Node-only packages
└── eslint.config.mjs                  # Root lint config
```

What this means in practice:
- **`packages/dapp`** owns Move packages, CLI scripts, and generated artifacts under `packages/dapp/deployments`.
- **`packages/domain/*`** is the domain SDK split into browser-safe `core` and Node-only `node`.
- **`packages/tooling/*`** is shared infra helpers split into browser-safe `core` and Node-only `node`.
- **`packages/ui`** is a Next.js UI that uses the same package IDs and Shop objects created by scripts.
