## Localnet setup prerequisites (before running `pnpm setup:local`)

1) **Start localnet + account**
   - `sui start` (in another terminal) to run a local node.
   - `sui client new-address ed25519` (or reuse an existing one) and `sui client active-address` to set the publisher/funder account. Keep the address handy.
2) **Install deps**
   - `pnpm install`
   - Ensure `sui` CLI is on PATH.
3) **Patched Pyth (dev-only, already applied here)**
   - A patched clone lives at `patches/pyth-crosschain` and already includes dev constructors for local mocks.
   - Easiest: let `setup:local` publish it and capture the package ID automatically:
     ```bash
     pnpm setup:local --publish-pyth --publish-mock-coin
     ```
   - Manual publish (if you want to reuse an existing package ID):
     ```bash
     sui client publish \
       --gas-budget 2000000000 \
       --skip-dependency-verification \
       --with-unpublished-dependencies \
       --path target_chains/sui/contracts
     ```
     Save the `published` package ID and pass it to `setup:local` via `--pyth-package-id`.

   - **If you reclone/reset and need to reapply the patch:**
     ```bash
     cd patches/pyth-crosschain
     git apply --check ../pyth-dev-entry.patch   # optional sanity check
     git apply ../pyth-dev-entry.patch           # apply once on a clean checkout
     ```
     Only apply once; reapply only after resetting the file/repo to a clean state.
4) **Run local seeding**
   - From the repo root:
     ```bash
     pnpm setup:local \
       --pyth-package-id <patched_pyth_pkg_id>
     ```
     If you run with `--publish-pyth` and `--publish-mock-coin`, you can omit package IDs and the script will publish/record both packages for you.
   - Outputs:
     - `deployments/deployment.localnet.json` containing the published mock coin package info.
     - `deployments/mock.local.json` containing:
       - Mock price feeds (`feedIdHex`, `priceInfoObjectId`)
       - Mock coins (currency IDs, treasury caps, minted coin IDs)

### Why the patched Pyth?
The official Pyth package strips the `new_price_info_object_for_test` helper from published bytecode. For localnet mocks we need a callable constructor to mint `PriceInfoObject`s without a relayer/VAAs. The `pyth-dev-entry.patch` adds dev-only entry functions; publish that patched package once on localnet and reuse its package ID for all subsequent runs.
