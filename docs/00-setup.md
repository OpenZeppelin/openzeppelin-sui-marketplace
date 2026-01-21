# 00 - Setup + Quickstart

**Path:** [Learning Path](./) > 00 Setup + Quickstart

This chapter gets your environment ready and walks through a complete localnet run: install tooling, publish packages, seed mocks, and run the UI.

## 1. Learning goals
1. Install the Sui CLI (nightly 1.63.x) and verify it works.
2. Create and fund an address for localnet/testnet use.
3. Install dependencies and publish the Move package.
4. Seed mock coins + Pyth data and run the UI.

## 2. Prerequisites
1. **Node.js 22+** and **pnpm**.
2. **Rust toolchain** (`rustup`) for nightly installs.
3. **Sui CLI** on your `PATH`.

## 3. Install Sui CLI (1.63.x)
This repo is tested against Sui CLI **1.63.x**.

```bash
curl -sSfL https://raw.githubusercontent.com/Mystenlabs/suiup/main/install.sh | sh
suiup install sui@testnet
sui --version
```

## 4. Clone + install dependencies
```bash
git clone git@github.com:OpenZeppelin/sui-oracle-market.git
cd sui-oracle-market
pnpm install
```

## 5. Create or reuse an address (note the recovery phrase to import it later in your browser wallet)
```bash
sui client new-address ed25519
sui client active-address
```

If you have multiple addresses:
```bash
sui client switch --address <0x...>
```

## 6. Configure account env (optional but recommended for scripts)
```bash
export SUI_ACCOUNT_ADDRESS=<0x...>
export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>
```

If you do not set these, scripts fall back to the Sui CLI keystore.

## 7. Start localnet (localnet only)
```bash
pnpm script chain:localnet:start --with-faucet
```

## 8. Seed mocks (localnet only)
This publishes mock coins and Pyth packages, then seeds price feeds.
```bash
pnpm script mock:setup --buyer-address <0x...>
```

## 9. Publish the Move package
```bash
pnpm script move:publish --package-path oracle-market
```

The package ID is written to:
`packages/dapp/deployments/deployment.localnet.json`

## 10. Create a shop (and optionally seed data)
```bash
pnpm script owner:shop:create --name "Oracle Shop"
pnpm script owner:shop:seed
```

## 11. Run the UI
Create `packages/ui/.env.local` with IDs from your deployments:
```bash
NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
NEXT_PUBLIC_LOCALNET_SHOP_ID=0x...
```

Start the app:
```bash
pnpm ui dev
```

## 12. Sanity checks
```bash
pnpm script buyer:shop:view
pnpm script buyer:item-listing:list --shop-id <shopId>
```

## 13. Further reading
- https://docs.sui.io/guides/developer/getting-started/sui-install
- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://docs.sui.io/guides/developer/objects/object-model

## 14. Navigation
1. Next: [01 Repo Layout + How to Navigate](./01-repo-layout.md)
2. Back to map: [Learning Path Map](./)
