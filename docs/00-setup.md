# 00 - Setup + Quickstart

**Path:** [Learning Path](./) > 00 Setup + Quickstart

This chapter gets your environment ready and walks through a complete localnet run: install tooling, publish packages, seed mocks, and run the UI.

## 1. Learning goals
1. Install the Sui CLI (1.63.x) and verify it works.
2. Create and fund an address for localnet/testnet use.
3. Install dependencies and publish the Move package.
4. Seed mock coins + Pyth data and run the UI.

## 2. Prerequisites
- Node.js 22+ [Install](https://nodejs.org/en/download)
- pnpm [Install](https://pnpm.io/installation)
- Sui CLI [Install](https://docs.sui.io/guides/developer/getting-started/sui-install)
- Optional vs code extension [Install](https://docs.sui.io/references/ide/move)
 
## 3. Install Sui CLI (1.63.x)
This repo is tested against Sui CLI **1.63.x**. Pin a specific patch version so upgrades do not surprise you.

```bash
curl -sSfL https://raw.githubusercontent.com/Mystenlabs/suiup/main/install.sh | sh
suiup list
suiup install sui@testnet
sui --version
```

## 4. Clone + install dependencies
```bash
git clone git@github.com:OpenZeppelin/openzeppelin-sui-marketplace.git
cd openzeppelin-sui-marketplace
pnpm install
```

## 5. Create owner + buyer addresses (note the recovery phrase to import it later in your browser wallet)
Create two addresses in your Sui CLI keystore:
- owner: deploys packages and manages the shop
- buyer (optional): tests purchase flows

```bash
# Owner
sui client new-address ed25519

# Buyer
sui client new-address ed25519
```
Review created addresses:
```bash
sui client addresses
```

Validate the active address:
```bash
sui client active-address
```

To switch address when you have multiple ones:
```bash
sui client switch --address <0x...>
```

### 5.1 Import owner + buyer into Slush (browser wallet)
You can import by recovery phrase (printed by `sui client new-address`) or by exported private key.

To export private keys in Sui format:
```bash
sui keytool export --key-identity <OWNER_ADDRESS>
sui keytool export --key-identity <BUYER_ADDRESS>
```

In Slush:
1. Add account -> Import account.
2. Paste the recovery phrase or privatekey.
3. Import both owner and buyer as separate accounts.

Has current EOA don't connect to localnet to the current balance for an address use the provided script 

```bash
# Owner (or any address)
pnpm script chain:describe-coin-balances --network localnet --address <ADDRESS>
```

## 6. Configure account env

Export in your current shell:
```bash
export SUI_NETWORK=localnet
export SUI_ACCOUNT_ADDRESS=<owner 0x...>
export SUI_ACCOUNT_PRIVATE_KEY=<owner suiprivkey... or base64/hex>
```

Use `packages/dapp/.env` for persistent setup between terminals.

```bash
cp packages/dapp/.env.example packages/dapp/.env
```

Set owner account + localnet in `packages/dapp/.env`:
```dotenv
SUI_NETWORK=localnet
SUI_ACCOUNT_ADDRESS=<owner 0x...>
SUI_ACCOUNT_PRIVATE_KEY=<owner suiprivkey... or base64/hex>
```

If you do not set these, scripts fall back to Sui CLI keystore + default network configuration.

Once configured `--network localnet` flag can be omitted when running the scripts.


## 7. Start localnet
```bash
pnpm script chain:localnet:start --with-faucet
```
The `--with-faucet` flag will run the faucet runs alongside the localnet allowing to automatically fund address if needed. Note that on first start it will fund your configured address.

Use `--force-regenesis` only when you need a full local reset:
- faucet/gas state is broken
- you want a deterministic clean chain for a fresh run
- your localnet state is stale/corrupted

It will:
- recreate localnet config/genesis state
- clear `packages/dapp/deployments/*.localnet*`
- clear `localnet`/`test-publish` sections from `packages/dapp/contracts/**/Published.toml`
- produce new object/package IDs

```bash
pnpm script chain:localnet:start --with-faucet --force-regenesis
```


## 8. Seed mocks (localnet only)
This publishes mock coins and Pyth packages, then seeds price feeds. As there are no coins or published Pyth oracle on your blank localnet
```bash
pnpm script mock:setup --buyer-address <0x...> --network localnet
```

## Optional: Inspect per-coin balances on localnet (owner + buyer)
Use the existing inspection script to list each coin type, object count, and total balance.

```bash
# Owner (or any address)
pnpm script chain:describe-coin-balances --network localnet --address <OWNER_ADDRESS>

# Buyer
pnpm script chain:describe-coin-balances --network localnet --address <BUYER_ADDRESS>
```

If `--address` is omitted, the script inspects the configured signer address.

For a broader account snapshot (SUI + coins + stake + owned objects), use:
```bash
pnpm script chain:describe-address --network localnet --address <0x...>
```

## 9. Publish the Move package
```bash
pnpm script move:publish --network localnet --package-path oracle-market
```

If publish fails because a package was already published (can be validated in `Published.toml`), or with an address mismatch error, re-run with:
```bash
pnpm script move:publish --network localnet --package-path oracle-market --re-publish
```

`--re-publish` clears the network's `Published.toml` entry before publishing, then writes a new deployment record.

The published package ID is written to:
`packages/dapp/deployments/deployment.localnet.json`

```json
[
  {
  "network": "localnet",
  "rpcUrl": "http://127.0.0.1:9000",
  "packagePath": "/abs/path/packages/dapp/contracts/oracle-market",
  "packageName": "sui_oracle_market",
  "packageId": "0x...",
  "upgradeCap": "0x...",
  "publisherId": "0x...",
  "isDependency": false,
  "sender": "0x...",
  "digest": "...",
  "publishedAt": "2026-03-05T14:50:19.759Z"
  }
]
```

## 10. Create a shop (and/or optionally seed data)
Note that seed will create a store if you did not create one
```bash
pnpm script owner:shop:create --name "Oracle Shop"
pnpm script owner:shop:seed
```

The created objects are saved in:
`packages/dapp/deployments/objects.localnet.json`

```json
[{
  "packageId": "0xbb2c7e2b22c24e21edd6e65f9220185219c714e0154ded16a5e0197297c59c09",
  "signer": "0x4f5fd198675da3f90a1cf3006d5cd3576dee4804fb8ca87cb9cfb964772125d1",
  "objectId": "0x1c89e11c8d1959a382e3df0615361cec1c5e0b4aeae6a55519274bb96a3accb1",
  "objectType": "0xbb2c7e2b22c24e21edd6e65f9220185219c714e0154ded16a5e0197297c59c09::shop::Shop",
  "owner": {
    "ownerType": "shared",
    "initialSharedVersion": "744066759"
  },
  "initialSharedVersion": "744066759",
  "version": "744114833",
  "digest": "HG3fa84hVQN4FvUhiuAvqtDDkuyRKwCQ4pWAzHrtojCv"
}]
```

## 11. Run the UI to see the shop
Create `packages/ui/.env.local` with contract package ID:
```bash
NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
```

Resolve IDs from artifacts:
```bash
package_id=$(jq -r '.[] | select(.packageName=="sui_oracle_market") | .packageId' packages/dapp/deployments/deployment.localnet.json | tail -n 1)
shop_id=$(jq -r '.[] | select(.objectType | endswith("::shop::Shop")) | .objectId' packages/dapp/deployments/objects.localnet.json | tail -n 1)
```

Start the app:
```bash
pnpm ui dev
```

Then open:
`http://localhost:3000/`

Note:
- The UI reads `NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID` from env.
- Shop selection is driven by URL/query param (`shopId`) or by choosing from the in-app shop picker.

## 12. Sanity checks using scripts
```bash
pnpm script buyer:shop:view
pnpm script buyer:item-listing:list --shop-id <shopId>
```

Find all the scripts references in [06 Scripts reference (CLI)](./06-scripts-reference.md)

## 13. Further reading
- https://docs.sui.io/guides/developer/getting-started/sui-install
- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://docs.sui.io/guides/developer/objects/object-model

## 14. Navigation
1. Next: [01 Repo Layout + How to Navigate](./01-repo-layout.md)
2. Back to map: [Learning Path Map](./)
