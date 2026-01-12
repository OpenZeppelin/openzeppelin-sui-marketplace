# 19 - Moving to Testnet/Mainnet

**Path:** [Learning Path](./) > 19 Moving to Testnet/Mainnet

This chapter is the checklist for leaving localnet. It covers how to harden your configuration, acquire the right assets, and publish with the real dependency graph in mind.

## 1. Goals
- Promote a localnet build to testnet or mainnet without drifting package IDs.
- Fund the accounts that will publish packages, seed objects, and operate the shop.
- Verify accepted currencies and oracle feeds before buyers spend a single SUI.

## 2. Pre-flight prerequisites
1. Deploy the package on testnet `pnpm script move:publish --package-path oracle-market --network testnet`
2. Optionally run the seeds `pnpm script owner:shop:seed --network testnet`
3. Update UI + domain config: set `NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID`
4. Gather owner/buyer addresses: make sure the wallet that will hold `ShopOwnerCap` is ready and funded with some SUI.

## 3. (Only testnet) Acquire some SUI
- Official faucet: https://faucet.sui.io/
- Community faucets:
  - http://faucet.n1stake.com/
  - http://faucet.suilearn.io/

💡 Keep at least two SUI coins in every wallet (one for gas, one for payment) even when paying with another token.

One coin type currently registered in the Sui coin registry is `0xa7f7382f67ef48972ad6a92677f2a764201041f5e29c7a9e0389b75e61038cdf::usdc::USDC`. Network upgrades can change this ID—double-check it against the registry or your published artifacts before seeding the shop.

## 4. Publish + seed checklist
1. Publish packages with real dependencies: remove `--with-unpublished-deps` flags and ensure every dependency already lives on the target network.
2. Claim the `UpgradeCap` and persist it securely once publish succeeds.
3. Run the owner scripts in order (`packages/dapp/src/scripts`):
   - `owner:shop:create` 
4. Review resulting object IDs (Shop, AcceptedCurrency, Oracle config) inside `deployment.<network>.json`.

## 5. Buyer + oracle validation
1. Run `pnpm script buyer:shop:view --network <testnet|mainnet>` and ensure every listing resolves.
2. Execute `pnpm script buyer:item-listing:quote` with the same coin/oracle pair the UI will use; the PTB should succeed via dev-inspect even before real buys.
3. Trigger a price update via your oracle feed (or rely on upstream testnet cadence) and confirm `price_info::PriceInfoObject` freshness in logs.

## 6. Navigation
1. Previous: [18 Data Access + Indexing](./18-data-access.md)
2. Next: [20 Security & Gotchas](./20-security.md)
3. Back to map: [Learning Path Map](./)
