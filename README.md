> [!Warning]
> This is experimental UN-AUDITED code

# Sui Oracle Market

End-to-end example of a small on-chain market on **Sui**. Items are priced in **USD cents** (stablecoin-style), buyers pay in **multiple currencies** using **oracle prices** from [Pyth](https://pyth.network/), and the contract layer uses [`openzeppelin_math`](https://docs.openzeppelin.com/contracts-sui/1.x/math) for safe `mul_div` with explicit rounding and overflow handling.

The repo demonstrates five core Sui patterns: the capability pattern, phantom types, Programmable Transaction Blocks (PTBs), Pyth oracle integration, and on-chain enforced limits.

## Resources

- Video walkthrough: [*Sui Marketplace Fullstack Example: Move, Pyth, and OpenZeppelin Math Libraries*](https://youtu.be/n53w3IGLnf8) — ~18 min covering architecture, code, and a live transaction flow on testnet
- Public docs page (overview): [Sui Marketplace dApp Walkthrough](https://docs.openzeppelin.com/contracts-sui/1.x/learn/dapp-1-marketplace)
- In-repo walkthrough (this README's deep counterpart): [`docs/README.md`](docs/README.md) — 23-chapter linear path covering contracts, scripts, UI, testing, and troubleshooting

## Repo layout

This is a pnpm workspace containing:

- `packages/dapp/contracts/oracle-market` — the Move package
- `packages/dapp/src/scripts` — CLI scripts for localnet, seeding, and owner/buyer flows
- `packages/dapp/deployments` — generated artifacts from scripts
- `packages/domain/*` — browser-safe domain models and Node-only helpers
- `packages/tooling/*` — shared infra helpers (browser-safe + Node-only)
- `packages/ui` — Next.js UI

Workspace layering rules and folder layout: [`docs/01-repo-layout.md`](docs/01-repo-layout.md).

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

To publish your own copy of the package on testnet (rather than using the canonical OpenZeppelin deploy), run `PUBLISH_OWN=1 pnpm bootstrap:testnet`. The script publishes a fresh `oracle-market` package under your owner account (~0.5–1 testnet SUI in gas), seeds a shop against it, and writes the resulting IDs to `packages/ui/.env.local`. Useful when testing Move-code changes on testnet or running an isolated copy of the contract.

To run both localnet and testnet, run both bootstrap scripts. `packages/ui/.env.local` will carry both blocks. The UI's network selector toggles between them; switch Slush to match.

## Walkthrough

The deep walkthrough lives in [`docs/`](docs/), starting with [`docs/README.md`](docs/README.md) — a 23-chapter linear path covering the mental model, contracts, oracle integration, UI flows, testing, security, and troubleshooting.

Direct jumps:

- Setup + quickstart: [`docs/00-setup.md`](docs/00-setup.md)
- Localnet end-to-end: [`docs/05-localnet-workflow.md`](docs/05-localnet-workflow.md)
- Script/CLI reference: [`docs/06-scripts-reference.md`](docs/06-scripts-reference.md)
- UI reference: [`docs/11-ui-reference.md`](docs/11-ui-reference.md)
- Moving to testnet/mainnet: [`docs/19-moving-to-testnet.md`](docs/19-moving-to-testnet.md)
- Security + gotchas: [`docs/20-security.md`](docs/20-security.md)
- Troubleshooting: [`docs/21-troubleshooting.md`](docs/21-troubleshooting.md)
- Glossary: [`docs/22-glossary.md`](docs/22-glossary.md)

Companion overview on the public docs site: [Sui Marketplace dApp Walkthrough](https://docs.openzeppelin.com/contracts-sui/1.x/learn/dapp-1-marketplace). The public page is a shorter overview that points back to this folder for depth.

Move and Sui language references for newcomers:

- [Sui Move Concepts](https://docs.sui.io/concepts/sui-move-concepts) — official Sui-flavored Move primer
- [The Move Book](https://move-book.com/) — language reference, abilities, generics, phantom types
- [Programmable Transaction Blocks](https://docs.sui.io/concepts/transactions/prog-txn-blocks) — PTB structure on Sui
- [Pyth on Sui](https://docs.pyth.network/price-feeds/use-real-time-data/sui) — oracle feed integration
- [OpenZeppelin Sui Contracts](https://docs.openzeppelin.com/contracts-sui) — `openzeppelin_math`, `openzeppelin_access`

## Tests

- Integration (localnet): `pnpm dapp test:integration`
- Testing guide: [`docs/15-testing.md`](docs/15-testing.md)

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
