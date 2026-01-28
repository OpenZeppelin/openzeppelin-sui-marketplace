
> [!Warning]
> This is experimental UN-AUDITED code

# Sui Oracle Market

End-to-end example of a small on-chain market on **Sui**: items are priced in **USD cents** (stablecoin-style), while buyers can pay in **multiple currencies** using **oracle prices**.

This repo is a pnpm workspace containing:
- a Move package `packages/dapp/move/oracle-market`,
- a CLI/script layer for localnet + seeding + owner/buyer flows `dapp/scripts`
- state artefact captured in (`packages/dapp/deployments`) 
- a Next.js UI `packages/ui`,
- a docs site with learning path to help transition from EVM/Solidity to Sui/Move `packages/learn`.
- a tooling layer with integration test harness `packages/tooling`

More detail (workspace layering rules, folder layout): `docs/01-repo-layout.md`.

## Prerequisites
- Node.js 22+ [Install](https://nodejs.org/en/download)
- pnpm [Install](https://pnpm.io/installation)
- Sui CLI [Install](https://docs.sui.io/guides/developer/getting-started/sui-install)


## Environment Setup
Set up your environment so you have active address and localnet running so you can publish and interact with the oracle-market package

Full walkthrough: [docs/05-localnet-workflow.md](docs/05-localnet-workflow.md).

```bash
# 1) Clone and install
git clone git@github.com:OpenZeppelin/openzeppelin-sui-marketplace.git && cd openzeppelin-sui-marketplace
# (pnpm workspace install from the repo root)
pnpm install

# Create an address (this will be your shop owner address) (note the recovery phrase to import it later in your browser wallet)
sui client new-address ed25519

# Configure this address in dapp/.env , Sui config file or export
export SUI_NETWORK=localnet
export SUI_ACCOUNT_ADDRESS=<0x...>
export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>

# Optionally create a second address to represent the buyer (the owner address can also buy items) (take note of the recovery phrase)
sui client new-address ed25519

# Start localnet (new terminal) (--with-faucet is recommended as some script auto fund address if fund is missing, on first start it will fund your configured address)
pnpm script chain:localnet:start --with-faucet

# Seed mocks (coins + Pyth stub + price feeds) on localnet as there is no coins or published Pyth oracle on your blank localnet
pnpm script mock:setup --buyer-address <0x...> --network localnet
```


## Publish and Seed
Load some shop data

```bash
# Publish oracle-market
pnpm script move:publish --package-path oracle-market

# To continue setting up the shop, listings, discounts, accepted currencies follow appropriate scripts (find the list here docs/06-scripts-reference.md) or run the seed script that will load data for each model
pnpm script owner:shop:seed

# Run the UI
pnpm ui dev

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
│   │   ├── move/                      # Move packages (oracle-market + mocks + examples)
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