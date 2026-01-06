# 20 - Troubleshooting

**Path:** [Learning Path](./) > 20 Troubleshooting

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
  max_price_age_secs: &opt::Option<u64>,
  max_confidence_ratio_bps: &opt::Option<u64>,
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
1. Previous: [19 Security & Gotchas](./19-security.md)
2. Next: [21 Glossary](./21-glossary.md)
3. Back to map: [Learning Path Map](./)
