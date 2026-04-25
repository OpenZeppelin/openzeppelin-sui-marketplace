> [!Warning]
> This is experimental UN-AUDITED code

# Sui Oracle Market

End-to-end example of a small on-chain market on **Sui**: items are priced in **USD cents** (stablecoin-style), while buyers can pay in **multiple currencies** using **oracle prices**. Clone it to explore five core Sui patterns hands-on: the capability pattern, phantom types, Programmable Transaction Blocks (PTBs), Pyth oracle integration, and on-chain enforced limits.

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
- Sui CLI 1.67.x [Install](https://docs.sui.io/guides/developer/getting-started/sui-install)
- Browser wallet — [Slush](https://slush.app/) (or any Sui-compatible wallet extension) for connecting to the UI

## Localnet Quickstart

Full walkthrough: [docs/05-localnet-workflow.md](docs/05-localnet-workflow.md).

```bash
# 1) Clone and install
git clone git@github.com:OpenZeppelin/openzeppelin-sui-marketplace.git && cd openzeppelin-sui-marketplace
pnpm install

# 2) Create two addresses — one owner, one buyer (save the 12-word recovery phrases; you'll import them into Slush later)
sui client new-address ed25519   # owner
sui client new-address ed25519   # buyer

# 3) Start localnet (new terminal; leave it running)
pnpm script chain:localnet:start --with-faucet

# 4) Configure packages/dapp/.env
cp packages/dapp/.env.example packages/dapp/.env
# Then edit packages/dapp/.env and fill in:
#   SUI_NETWORK=localnet
#   SUI_ACCOUNT_ADDRESS=<owner-0x...>
#   SUI_BUYER_ACCOUNT_ADDRESS=<buyer-0x...>
#
# AND supply credentials for each account — choose ONE of:
#   (a) Simplest — paste the 12-word recovery phrase from step 2:
#         SUI_ACCOUNT_MNEMONIC="word1 word2 ... word12"
#         SUI_BUYER_ACCOUNT_MNEMONIC="word1 word2 ... word12"
#       (uncomment those lines in .env)
#   (b) Or export the private keys:
#         sui keytool export --key-identity <owner-0x...>
#         sui keytool export --key-identity <buyer-0x...>
#       then paste into SUI_ACCOUNT_PRIVATE_KEY= and SUI_BUYER_ACCOUNT_PRIVATE_KEY=

# 5) Bootstrap — one command. Seeds mocks, publishes oracle-market, seeds the shop,
#    and writes packages/ui/.env.local with the package + shop IDs automatically.
pnpm bootstrap:localnet

# 6) Run the UI
pnpm ui dev
# Open http://localhost:3000 and select 'Localnet' in the network selector
```

<details>
<summary>Prefer the manual flow? (what <code>pnpm bootstrap:localnet</code> does under the hood)</summary>

```bash
# Replaces step 5 above:
pnpm script mock:setup --network localnet
pnpm script move:publish --package-path oracle-market --network localnet
pnpm script owner:shop:seed --network localnet

# Then edit packages/ui/.env.local:
#   NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=<packageId from packages/dapp/deployments/deployment.localnet.json — the entry where packageName is "sui_oracle_market">
#   NEXT_PUBLIC_LOCALNET_SHOP_ID=<objectId from packages/dapp/deployments/objects.localnet.json — the entry whose objectType ends with "::shop::Shop">
```

</details>

## Testnet

The contract is already deployed on testnet — no publish step needed. Only the owner account is required; the buyer plays via the browser wallet.

```bash
# 1) Create and fund an owner address
sui client new-address ed25519   # save the recovery phrase
# Then fund it: https://faucet.testnet.sui.io

# 2) Configure packages/dapp/.env
cp packages/dapp/.env.example packages/dapp/.env
# Edit packages/dapp/.env and fill in:
#   SUI_NETWORK=testnet
#   SUI_ACCOUNT_ADDRESS=<owner-0x...>
#
# Supply owner credentials — choose ONE of:
#   (a) Simplest — paste the recovery phrase from step 1:
#         SUI_ACCOUNT_MNEMONIC="word1 word2 ... word12"
#       (uncomment that line in .env)
#   (b) Or export the private key:
#         sui keytool export --key-identity <owner-0x...>
#       then paste into SUI_ACCOUNT_PRIVATE_KEY=
#
# Leave SUI_BUYER_ACCOUNT_* empty — the buyer uses Slush in the browser.

# 3) Bootstrap — seeds the shop and writes packages/ui/.env.local automatically
pnpm bootstrap:testnet

# 4) Run the UI — select Testnet in the network selector
pnpm ui dev
# Open http://localhost:3000
```

To play as a buyer, create a second Slush account in the browser, fund it from the faucet, and connect it to the UI.

> **Want to deploy your own package instead of using the canonical one?**
> ```bash
> PUBLISH_OWN=1 pnpm bootstrap:testnet
> ```
> Publishes a fresh `oracle-market` package under your owner account (~0.5–1 testnet SUI in gas), then seeds a shop against YOUR package ID and wires it into `packages/ui/.env.local`. Useful for testing Move-code changes on testnet or running an isolated copy of the contract.

> Running localnet AND testnet? That's fine. After running both `pnpm bootstrap:localnet` and `pnpm bootstrap:testnet`, your `packages/ui/.env.local` has both blocks populated and the UI network selector toggles between them freely — no UI restart needed. Just remember to switch Slush to the matching network when toggling.

## Learning path

Start the docs website and follow along based on your goal:

```bash
pnpm --filter learn dev
```

and navigate to `localhost:30006` on your browser

Quick gotos:

- **Hands-on challenge (6 checkpoints):** [CHALLENGE.md](CHALLENGE.md)
- **Learning path hub:** [docs/README.md](docs/README.md)
- **Setup + quickstart:** [docs/00-setup.md](docs/00-setup.md)
- **EVM → Sui cheatsheet:** [docs/03-evm-to-sui.md](docs/03-evm-to-sui.md)
- **Troubleshooting:** [docs/21-troubleshooting.md](docs/21-troubleshooting.md)
- **Glossary:** [docs/22-glossary.md](docs/22-glossary.md)

## Frontend UI

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
