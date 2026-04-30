#!/usr/bin/env bash
# bootstrap-localnet.sh
#
# One-command fresh-clone setup for running Sui Oracle Market against localnet.
# Assumes you've already run `pnpm install`.
#
# What it does:
#   1. Verifies prerequisites (node, pnpm, sui, curl)
#   2. Ensures packages/dapp/.env exists and is filled in
#   3. Verifies localnet is reachable (you start it separately)
#   4. Runs mock:setup, move:publish, owner:shop:seed
#   5. Extracts package + shop IDs from deployment artifacts
#   6. Writes/updates packages/ui/.env.local with those IDs
#
# Run:   ./scripts/bootstrap-localnet.sh
# Or:    pnpm bootstrap:localnet

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
for cmd in node pnpm sui curl; do
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
    1) If you don't have two Sui addresses yet:
         sui client new-address ed25519   # owner  (save the recovery phrase)
         sui client new-address ed25519   # buyer  (save the recovery phrase)

    2) Paste the addresses into packages/dapp/.env:
         SUI_ACCOUNT_ADDRESS=<owner-0x...>
         SUI_BUYER_ACCOUNT_ADDRESS=<buyer-0x...>

    3) Provide credentials — EITHER the 12-word recovery phrases (simplest):
         # in packages/dapp/.env, uncomment and fill:
         SUI_ACCOUNT_MNEMONIC="word1 word2 ... word12"
         SUI_BUYER_ACCOUNT_MNEMONIC="word1 word2 ... word12"

       OR export the private keys with:
         sui keytool export --key-identity <owner-0x...>
         sui keytool export --key-identity <buyer-0x...>
       and paste into:
         SUI_ACCOUNT_PRIVATE_KEY=suiprivkey1...
         SUI_BUYER_ACCOUNT_PRIVATE_KEY=suiprivkey1...

    4) Re-run:  ./scripts/bootstrap-localnet.sh
EOF
  exit 1
fi

# Validate env contents
require_var() {
  local var="$1"
  local line val
  line=$(grep -E "^$var=" "$DAPP_ENV" || true)
  val=${line#*=}
  val=${val%\"}; val=${val#\"}
  if [ -z "$val" ]; then
    return 1
  fi
  return 0
}

if ! grep -qE "^SUI_NETWORK=localnet" "$DAPP_ENV"; then
  warn "SUI_NETWORK is not set to 'localnet' in $DAPP_ENV. Continuing — scripts will use --network localnet explicitly."
fi

for var in SUI_ACCOUNT_ADDRESS SUI_BUYER_ACCOUNT_ADDRESS; do
  if ! require_var "$var"; then
    err "$var is empty in $DAPP_ENV. Fill it in and re-run."
    exit 1
  fi
done

owner_has_cred=false
if require_var SUI_ACCOUNT_PRIVATE_KEY || grep -qE "^SUI_ACCOUNT_MNEMONIC=..+" "$DAPP_ENV"; then
  owner_has_cred=true
fi
if ! $owner_has_cred; then
  err "Neither SUI_ACCOUNT_PRIVATE_KEY nor SUI_ACCOUNT_MNEMONIC is set for the owner. Fill one in."
  exit 1
fi

buyer_has_cred=false
if require_var SUI_BUYER_ACCOUNT_PRIVATE_KEY || grep -qE "^SUI_BUYER_ACCOUNT_MNEMONIC=..+" "$DAPP_ENV"; then
  buyer_has_cred=true
fi
if ! $buyer_has_cred; then
  err "Neither SUI_BUYER_ACCOUNT_PRIVATE_KEY nor SUI_BUYER_ACCOUNT_MNEMONIC is set for the buyer. Fill one in."
  exit 1
fi

ok "$DAPP_ENV looks filled."

# Parse addresses out of .env for the funding step below
extract_env_var() {
  local var="$1"
  local val
  val=$(grep -E "^$var=" "$DAPP_ENV" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  printf "%s" "$val"
}
OWNER_ADDR=$(extract_env_var SUI_ACCOUNT_ADDRESS)
BUYER_ADDR=$(extract_env_var SUI_BUYER_ACCOUNT_ADDRESS)

# ── 3. Localnet reachable ────────────────────────────────────────────────────
info "Checking localnet at http://127.0.0.1:9000…"
if ! curl -s -f -m 3 -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}' \
      http://127.0.0.1:9000 > /dev/null 2>&1; then
  err "Localnet is not reachable. Start it in another terminal and re-run:"
  err "    pnpm script chain:localnet:start --with-faucet"
  exit 1
fi
ok "Localnet is running."

# ── 3.5. Fund owner + buyer from the localnet faucet ─────────────────────────
fund_address() {
  local addr="$1"
  local label="$2"
  if curl -s -f -m 5 -X POST http://127.0.0.1:9123/v2/gas \
       -H "Content-Type: application/json" \
       -d "{\"FixedAmountRequest\":{\"recipient\":\"$addr\"}}" > /dev/null 2>&1; then
    ok "Funded $label ($addr)"
  else
    warn "Faucet call for $label failed (mock:setup will retry on-demand). Address: $addr"
  fi
}

info "Funding owner and buyer from localnet faucet…"
fund_address "$OWNER_ADDR" "owner"
fund_address "$BUYER_ADDR" "buyer"

# ── 4. Seed mocks ────────────────────────────────────────────────────────────
info "Seeding mocks (coins + Pyth stub + price feeds)…"
pnpm script mock:setup --network localnet
ok "Mocks seeded."

# ── 5. Publish oracle-market ─────────────────────────────────────────────────
info "Publishing oracle-market…"
pnpm script move:publish --package-path oracle-market --network localnet
ok "oracle-market published."

# ── 6. Seed shop ─────────────────────────────────────────────────────────────
info "Seeding shop (listings + currencies + discounts)…"
pnpm script owner:shop:seed --network localnet
ok "Shop seeded."

# ── 7. Extract IDs and write packages/ui/.env.local ──────────────────────────
info "Reading deployment artifacts…"
PACKAGE_ID=$(node -e '
  const d = require("./packages/dapp/deployments/deployment.localnet.json");
  const p = d.find(x => x.packageName === "sui_oracle_market");
  if (!p) process.exit(1);
  console.log(p.packageId);
') || { err "Could not find sui_oracle_market in deployment.localnet.json"; exit 1; }

SHOP_ID=$(node -e '
  const o = require("./packages/dapp/deployments/objects.localnet.json");
  const s = o.find(x => x.objectType && x.objectType.endsWith("::shop::Shop"));
  if (!s) process.exit(1);
  console.log(s.objectId);
') || { err "Could not find shared Shop object in objects.localnet.json"; exit 1; }

UI_ENV="packages/ui/.env.local"
if [ ! -f "$UI_ENV" ]; then
  info "Creating $UI_ENV from example…"
  cp packages/ui/.env.example "$UI_ENV"
fi

PACKAGE_ID="$PACKAGE_ID" SHOP_ID="$SHOP_ID" UI_ENV="$UI_ENV" node -e '
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
  upsert("NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID", process.env.PACKAGE_ID);
  upsert("NEXT_PUBLIC_LOCALNET_SHOP_ID", process.env.SHOP_ID);
  fs.writeFileSync(path, content);
'

ok "$UI_ENV updated:"
ok "  NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=$PACKAGE_ID"
ok "  NEXT_PUBLIC_LOCALNET_SHOP_ID=$SHOP_ID"

# ── 8. Done ──────────────────────────────────────────────────────────────────
echo ""
ok "Bootstrap complete."
echo ""
info "Next step: start the UI"
info "    pnpm ui dev"
info "Then open http://localhost:3000 and select 'Localnet' in the network selector."
