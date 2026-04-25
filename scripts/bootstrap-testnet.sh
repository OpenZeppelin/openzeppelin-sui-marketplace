#!/usr/bin/env bash
# bootstrap-testnet.sh
#
# One-command fresh-clone setup for running Sui Oracle Market against testnet.
# The oracle-market contract is already deployed on testnet, so this script
# only seeds a shop for your owner account and wires the IDs into the UI.
#
# Assumes you've already run `pnpm install`.
#
# What it does:
#   1. Verifies prerequisites (node, pnpm, sui)
#   2. Ensures packages/dapp/.env exists with SUI_NETWORK=testnet and owner creds
#      (buyer creds are NOT needed — the buyer uses Slush in the browser)
#   3. Runs owner:shop:seed against the canonical testnet package
#   4. Extracts the created shop ID from deployment artifacts
#   5. Writes/updates packages/ui/.env.local with the package + shop IDs
#
# Options:
#   PUBLISH_OWN=1 pnpm bootstrap:testnet
#     → Publish a fresh copy of oracle-market under YOUR owner address before seeding.
#       Costs ~0.5–1 testnet SUI in gas. The resulting packageId replaces the canonical
#       one for both the shop seed and the UI env write.
#
#   TESTNET_PACKAGE_ID=0x... pnpm bootstrap:testnet
#     → Pin a specific pre-existing package ID (e.g. your previously-published copy).
#
# Run:   ./scripts/bootstrap-testnet.sh
# Or:    pnpm bootstrap:testnet

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { printf "${BLUE}[info]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[ok]${NC}   %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
err()   { printf "${RED}[err]${NC}  %s\n" "$*" >&2; }

# ── Run from repo root ───────────────────────────────────────────────────────
if [ ! -f pnpm-workspace.yaml ]; then
  err "Run this script from the repo root (where pnpm-workspace.yaml lives)."
  exit 1
fi

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
for cmd in node pnpm sui; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd not found on PATH. Install it and re-run."
    exit 1
  fi
done
ok "Prerequisites found."

# ── 2. packages/dapp/.env ────────────────────────────────────────────────────
DAPP_ENV="packages/dapp/.env"
if [ ! -f "$DAPP_ENV" ]; then
  info "Creating $DAPP_ENV from example…"
  cp packages/dapp/.env.example "$DAPP_ENV"
  cat >&2 <<'EOF'

[warn] packages/dapp/.env was just created — fill it in, then re-run this script.

  Step-by-step:
    1) If you don't have an owner Sui address yet:
         sui client new-address ed25519   # save the recovery phrase

    2) Fund it from the public faucet:
         https://faucet.testnet.sui.io

    3) Edit packages/dapp/.env:
         SUI_NETWORK=testnet
         SUI_ACCOUNT_ADDRESS=<owner-0x...>

         # Provide owner credentials — EITHER the 12-word recovery phrase:
         SUI_ACCOUNT_MNEMONIC="word1 word2 ... word12"
         # OR export the private key:
         #   sui keytool export --key-identity <owner-0x...>
         # then paste into:
         #   SUI_ACCOUNT_PRIVATE_KEY=suiprivkey1...

       NOTE: Leave SUI_BUYER_ACCOUNT_* empty on testnet.
       The buyer uses the browser wallet (Slush), not the CLI.

    4) Re-run:  ./scripts/bootstrap-testnet.sh
EOF
  exit 1
fi

# Validate .env contents (owner only)
require_var() {
  local var="$1"
  local line val
  line=$(grep -E "^$var=" "$DAPP_ENV" || true)
  val=${line#*=}
  val=${val%\"}; val=${val#\"}
  [ -n "$val" ]
}

if ! grep -qE "^SUI_NETWORK=testnet" "$DAPP_ENV"; then
  warn "SUI_NETWORK is not set to 'testnet' in $DAPP_ENV. Continuing — scripts will use --network testnet explicitly."
fi

if ! require_var SUI_ACCOUNT_ADDRESS; then
  err "SUI_ACCOUNT_ADDRESS is empty in $DAPP_ENV. Fill it in and re-run."
  exit 1
fi

if ! (require_var SUI_ACCOUNT_PRIVATE_KEY || grep -qE "^SUI_ACCOUNT_MNEMONIC=..+" "$DAPP_ENV"); then
  err "Neither SUI_ACCOUNT_PRIVATE_KEY nor SUI_ACCOUNT_MNEMONIC is set for the owner. Fill one in."
  exit 1
fi

ok "$DAPP_ENV looks filled (owner credentials present)."

# ── 3. Resolve the testnet package ID ────────────────────────────────────────
# Priority:
#   1. PUBLISH_OWN=1  → publish oracle-market under your owner address, use the resulting packageId.
#   2. TESTNET_PACKAGE_ID env var (if set) → use that literal value.
#   3. Default — read the canonical package ID from packages/ui/.env.example.
if [ "${PUBLISH_OWN:-}" = "1" ]; then
  info "PUBLISH_OWN=1 — publishing a fresh oracle-market package under your owner account…"
  info "  (Costs ~0.5–1 testnet SUI. If this fails on gas, fund your owner at https://faucet.testnet.sui.io.)"
  pnpm script move:publish --package-path oracle-market --network testnet
  TESTNET_PACKAGE_ID=$(node -e '
    const d = require("./packages/dapp/deployments/deployment.testnet.json");
    // Find the LATEST entry with packageName === "sui_oracle_market"
    // (deployment.testnet.json can accumulate over multiple publishes).
    const matches = d.filter(x => x.packageName === "sui_oracle_market");
    const pick = matches[matches.length - 1];
    if (!pick) process.exit(1);
    console.log(pick.packageId);
  ') || { err "Could not find sui_oracle_market entry in deployment.testnet.json after publish"; exit 1; }
  ok "Published. Using your package ID: $TESTNET_PACKAGE_ID"
else
  TESTNET_PACKAGE_ID="${TESTNET_PACKAGE_ID:-$(grep -E '^NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID=' packages/ui/.env.example | sed -E 's/^[^=]+=//' | tr -d '"')}"
  if [ -z "$TESTNET_PACKAGE_ID" ]; then
    err "Could not resolve testnet package ID. Set TESTNET_PACKAGE_ID, set PUBLISH_OWN=1, or update packages/ui/.env.example."
    exit 1
  fi
  ok "Using testnet package ID: $TESTNET_PACKAGE_ID"
fi

# ── 4. Seed shop on testnet ──────────────────────────────────────────────────
info "Seeding shop on testnet against package $TESTNET_PACKAGE_ID …"
info "  (If your owner has no SUI, grab some from https://faucet.testnet.sui.io and re-run.)"
pnpm script owner:shop:seed --shop-package-id "$TESTNET_PACKAGE_ID" --network testnet
ok "Shop seeded."

# ── 5. Extract shop ID and write packages/ui/.env.local ──────────────────────
info "Reading deployment artifacts…"
SHOP_ID=$(node -e '
  const o = require("./packages/dapp/deployments/objects.testnet.json");
  const s = o.find(x => x.objectType && x.objectType.endsWith("::shop::Shop"));
  if (!s) process.exit(1);
  console.log(s.objectId);
') || { err "Could not find shared Shop object in objects.testnet.json"; exit 1; }

UI_ENV="packages/ui/.env.local"
if [ ! -f "$UI_ENV" ]; then
  info "Creating $UI_ENV from example…"
  cp packages/ui/.env.example "$UI_ENV"
fi

PACKAGE_ID="$TESTNET_PACKAGE_ID" SHOP_ID="$SHOP_ID" UI_ENV="$UI_ENV" node -e '
  const fs = require("fs");
  const path = process.env.UI_ENV;
  let content = fs.readFileSync(path, "utf8");
  const upsert = (key, val) => {
    const re = new RegExp("^" + key + "=.*$", "m");
    const line = key + "=" + val;
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content = content + (content.endsWith("\n") ? "" : "\n") + line + "\n";
    }
  };
  upsert("NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID", process.env.PACKAGE_ID);
  upsert("NEXT_PUBLIC_TESTNET_SHOP_ID", process.env.SHOP_ID);
  fs.writeFileSync(path, content);
'

ok "$UI_ENV updated:"
ok "  NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID=$TESTNET_PACKAGE_ID"
ok "  NEXT_PUBLIC_TESTNET_SHOP_ID=$SHOP_ID"

# ── 6. Done ──────────────────────────────────────────────────────────────────
echo ""
ok "Bootstrap complete."
echo ""
info "Next steps:"
info "  1. Import your owner mnemonic into Slush to browse as the shop owner."
info "  2. Create a second Slush account to play as the buyer — fund it from https://faucet.testnet.sui.io."
info "  3. Start the UI:  pnpm ui dev"
info "     Open http://localhost:3000 and select 'Testnet' in the network selector."
info ""
info "Running both localnet and testnet? That's fine — the UI selector toggles between them"
info "without restarting, as long as both NEXT_PUBLIC_LOCALNET_* and NEXT_PUBLIC_TESTNET_* are set."
