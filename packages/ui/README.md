# UI: Sui Oracle Market Dashboard

This UI is a Next.js 16 app that talks directly to Sui via Mysten dapp-kit. It mirrors the on-chain object model: shared objects for storefront data, owned objects for wallet receipts and tickets.

## 1. Prereqs
1. Localnet running (or a target network RPC).
2. A published `sui_oracle_market` package and a Shop ID.
3. A wallet with the right network selected.

## 2. Run it
```bash
pnpm ui dev
```

Docs site:
```bash
pnpm --filter learn dev
```

## 3. Configure networks (.env.local)
Create `packages/ui/.env.local` and set package + shop IDs:
```bash
NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
NEXT_PUBLIC_LOCALNET_SHOP_ID=0x...
NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID=0x...
NEXT_PUBLIC_TESTNET_SHOP_ID=0x...
```

Optional UI labels:
```bash
NEXT_PUBLIC_APP_NAME="Sui Oracle Market"
NEXT_PUBLIC_APP_DESCRIPTION="Sui Oracle Market"
```

## 4. Localnet signing vs execution
On localnet, the UI **signs** with the wallet but **executes** via the app RPC client to avoid wallet network mismatches. On non-local networks, it uses the wallet's `signAndExecuteTransaction` as usual. This logic lives in `src/app/hooks/useBuyFlowModalState.ts` and uses the localnet helpers in `src/app/helpers/localnet.ts`.

## 5. Useful files
1. `src/app/hooks/useShopDashboardData.tsx` (shared vs owned queries)
2. `src/app/hooks/useBuyFlowModalState.ts` (PTB execution)
3. `src/app/components/BuyFlowModal.tsx` (transaction recap UI)
4. `src/app/config/network.ts` (network defaults)

## 6. Common issues
1. Package ID shows as `0xNOTDEFINED` in the UI
   - Set the `NEXT_PUBLIC_*_CONTRACT_PACKAGE_ID` variables.
2. UI loads but no shop data appears
   - Set `NEXT_PUBLIC_*_SHOP_ID` or select a shop in the UI.
3. Localnet buys fail but testnet works
   - Confirm you are running localnet at `http://127.0.0.1:9000`.
