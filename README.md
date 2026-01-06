# Sui Oracle Market

End-to-end example of a small on-chain market on **Sui**: items are priced in **USD cents** (stablecoin-style), while buyers can pay in **multiple currencies** using **oracle prices**.

This repo is a pnpm workspace containing:
- a Move package (`sui_oracle_market`),
- a CLI/script layer for localnet + seeding + owner/buyer flows,
- a Next.js UI,
- a docs site + linear learning path (EVM/Solidity → Sui/Move).

## Start here

- **Learning path hub:** `docs/README.md`
- **Setup + quickstart:** `docs/00-setup.md`
- **Learning chapter:** `docs/01-repo-layout.md`
- **Glossary:** `docs/21-glossary.md`

Docs website (renders `/docs` and selected guides):
```bash
pnpm --filter learn dev
```

## Quickstart (localnet)

Full walkthrough + troubleshooting: `docs/05-localnet-workflow.md`.

```bash
# 1) Install
pnpm install

# 2) Create/fund accounts
sui client new-address ed25519
sui client active-address
sui client faucet --address <0x...>

# 3) Start localnet
pnpm script chain:localnet:start --with-faucet

# 4) Seed mocks (coins + Pyth feeds)
pnpm script mock:setup --buyer-address <0x...>

# 5) Publish + seed a shop
pnpm script move:publish --package-path oracle-market
pnpm script owner:shop:seed

# 6) Run the UI
pnpm ui dev
```

## Frontend UI

- UI setup + localnet execution notes: `packages/ui/README.md`
- UI docs chapters: `docs/12-buyer-ui.md` and `docs/13-owner-ui.md`
- Additional UI reference notes: `docs/11-ui-reference.md`

## Tests

- Integration (localnet): `pnpm test:integration`
- Unit (domain + UI): `pnpm --filter @sui-oracle-market/domain-core test:unit` and `pnpm ui test:unit`
- Full testing guide: `docs/15-testing.md`

## Repo map (high level)

- Move packages: `packages/dapp/move/*`
- CLI scripts + artifacts: `packages/dapp/src/scripts` and `packages/dapp/deployments`
- Domain SDK: `packages/domain/core`
- UI: `packages/ui`
- Tooling/test harness: `packages/tooling`

More detail (workspace layering rules, folder layout): `docs/01-repo-layout.md`.


## Docs (detailed)

The detailed docs live under `docs/`:
- Localnet end-to-end: `docs/05-localnet-workflow.md`
- Script/CLI reference + artifacts: `docs/06-scripts-reference.md`
- UI reference notes: `docs/11-ui-reference.md`
- Testing + script testing framework: `docs/15-testing.md`
- Troubleshooting: `docs/20-troubleshooting.md`
- Security & gotchas: `docs/19-security.md`
- EVM → Sui cheatsheet: `docs/03-evm-to-sui.md`

## Troubleshooting
