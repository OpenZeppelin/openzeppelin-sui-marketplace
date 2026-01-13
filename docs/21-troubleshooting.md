# 21 - Troubleshooting

**Path:** [Learning Path](./) > 21 Troubleshooting

## Localnet refuses to start or keeps regenesis
- Check `pnpm script chain:localnet:start --check-only`.
- Localnet version handling is in `packages/dapp/src/scripts/chain/localnet-start.ts`.

**Code spotlight: localnet health check**
`packages/dapp/src/scripts/chain/localnet-start.ts`
```ts
if (checkOnly) {
  if (probeResult.status === "running") {
    logSimpleGreen("Localnet running")
    logRpcSnapshot(probeResult.snapshot, withFaucet)
    return
  }

  throw new Error(
    `Localnet RPC unavailable at ${tooling.network.url}: ${probeResult.error}`
  )
}
```

## Auto-funding fails on localnet ("Faucet request failed" / "Failed to execute transaction after 2 retries")
- This means the local faucet cannot execute its funding transaction, so auto-funding will fail too.
- Fix by regenesis (resets faucet treasury objects):
  - `pnpm script chain:localnet:stop`
  - `pnpm script chain:localnet:start --with-faucet --force-regenesis`
  - Re-run your script (e.g. `pnpm script mock:setup --buyer-address <0x...>`).
- If you need to preserve state, start localnet with a fresh config dir instead:
  - `SUI_LOCALNET_CONFIG_DIR=~/.sui/localnet-fresh pnpm script chain:localnet:start --with-faucet`
- Optional sanity check for the local faucet endpoint:
  ```bash
  curl -s -X POST http://127.0.0.1:9123/v2/gas \
    -H 'Content-Type: application/json' \
    -d '{"FixedAmountRequest":{"recipient":"<0x...>"}}'
  ```

## "Failed to publish the Move module(s), reason: No modules found in the package" on publish
- You need to re publish the package with --re-publish

## "No ShopOwnerCap found"
- Ensure the owner cap is in your wallet. See `packages/domain/core/src/models/shop.ts`.

## "No accepted currency registered for coin type ..."
- Register with `pnpm script owner:currency:add` or re-run `pnpm script owner:shop:seed`.

## Buying with SUI fails: "requires at least two SUI coin objects"
- Split SUI so one coin can be gas and one can be payment. See `packages/domain/core/src/flows/buy.ts`.

## Price feed mismatch or stale price
- Re-run `pnpm script mock:update-prices` on localnet.
- Guardrails are implemented in `packages/dapp/move/oracle-market/sources/shop.move`.

**Code spotlight: guardrails clamp buyer overrides**
`packages/dapp/move/oracle-market/sources/shop.move`
```move
fun resolve_effective_guardrails(
  max_price_age_secs: &Option<u64>,
  max_confidence_ratio_bps: &Option<u64>,
  accepted_currency: &AcceptedCurrency,
): (u64, u64) {
  let requested_max_age = unwrap_or_default(
    max_price_age_secs,
    accepted_currency.max_price_age_secs_cap,
  );
  let requested_confidence_ratio = unwrap_or_default(
    max_confidence_ratio_bps,
    accepted_currency.max_confidence_ratio_bps_cap,
  );
  let effective_max_age = clamp_max(
    requested_max_age,
    accepted_currency.max_price_age_secs_cap,
  );
  let effective_confidence_ratio = clamp_max(
    requested_confidence_ratio,
    accepted_currency.max_confidence_ratio_bps_cap,
  );
  (effective_max_age, effective_confidence_ratio)
}
```

## 2. Navigation
1. Previous: [20 Security & Gotchas](./20-security.md)
2. Next: [22 Glossary](./22-glossary.md)
3. Back to map: [Learning Path Map](./)
