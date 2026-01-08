# 11 - UI Reference (setup + localnet execution)

**Path:** [Learning Path](./) > 11 UI Reference

UI-specific setup notes also live in `packages/ui/README.md`.

## 1. Prerequisite
- Install [Slush Wallet](https://slush.app/) in your browser.
- Create a new key or import a key you have generated with Sui CLI (this will be your buyer address).

The UI lives in `packages/ui` and is a static-exported Next.js app (`output: "export"`) that renders the shop, listings, discounts, and checkout flows.

## 2. Configuration
- Network + contract IDs are read from `packages/ui/src/app/config/network.ts`.
- Use `.env.local` inside `packages/ui` (or env vars):
  ```bash
  NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
  NEXT_PUBLIC_LOCALNET_SHOP_ID=0x...
  NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID=0x...
  NEXT_PUBLIC_TESTNET_SHOP_ID=0x...
  ```

Optional UI metadata:
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_APP_DESCRIPTION`

## 3. Localnet signing + execution (UI)
- On localnet, the UI **signs** in the wallet and **executes** via the app’s local RPC client.
- Localnet RPC is locked to `http://127.0.0.1:9000` and guarded to only allow localhost.
- The buy flow refreshes local mock Pyth feeds in the same PTB (so UI buys don’t require manual `mock:update-prices`).

Key implementation notes:
- The network selection is **app-driven** (not wallet-driven): `useSuiClientContext()` supplies the app `network`, and the buy flow chooses the execution path when `network === localnet`.
- The localnet guards live in `packages/ui/src/app/helpers/localnet.ts` and `packages/ui/src/app/config/network.ts`.
- For localnet you'll see a `Unable to process transaction
No data returned for operation `ApproveTransactionQuery`, got error(s):
Variable "$input" got invalid value "localnet" at "input.signTransaction.network"; Value "localnet" does not exist in "Network" enum.
` error message this is because the wallet can not be configured for localnet but it can be ignored as the execution is app-driven and will go through

Why this matters:
- Wallet Standard distinguishes **sign-only** from **sign+execute**. Using `signTransaction` keeps the wallet from choosing an RPC endpoint.
- For localnet, we must ensure **all reads + writes** target the same local node; otherwise you can sign on localnet but accidentally execute against devnet/testnet.

Where to look in the UI code:
- The buy flow is implemented in `packages/ui/src/app/components/BuyFlowModal.tsx`.
  - Localnet uses `useSignTransaction` + `SuiClient.executeTransactionBlock`.
  - Non-local networks keep `useSignAndExecuteTransaction`.

## 4. UI scripts
Run from the repo root with `pnpm ui ...`:

- `pnpm ui dev`
  - Starts the Next.js dev server (default `http://localhost:3000`).
  - Use this after localnet is running and you have set `NEXT_PUBLIC_*` IDs for the network you want to view.
- `pnpm ui build`
  - Creates a static export of the site into `packages/ui/dist`.
  - Required before any of the deployment scripts.
- `pnpm ui start`
  - Runs `next start` for production-mode preview.
- `pnpm ui lint`
  - Runs ESLint across the UI codebase.
- `pnpm ui format`
  - Formats `packages/ui/src` with Prettier.

## 5. Navigation
1. Previous: [17 PTBs + Gas + Fees](./17-ptb-gas.md)
2. Next: [12 Buyer Flow + UI](./12-buyer-ui.md)
3. Back to map: [Learning Path Map](./)
