# Sui Oracle Market — Video Walkthrough Script

Target runtime: 5–7 minutes  
Network: Testnet  
Audience: Developers building on Sui, or evaluating Sui seriously. Not an EVM comparison — all framing is Sui-native.

---

## Learning Objectives

These are woven into the opening narration so viewers know upfront exactly what they'll learn:

1. **The object model in practice** — the shop, the owner's authority, and the buyer's receipt are all first-class on-chain objects with identity and ownership
2. **The capability pattern** — Move's answer to access control: authority is an object you hold, not an address you are
3. **Phantom types as on-chain provenance** — type-level encoding of what was purchased, enforced by the compiler
4. **Programmable Transaction Blocks (PTBs)** — composing multiple contract calls into one atomic transaction
5. **Oracle integration with guardrails** — live Pyth price feeds validated on-chain at transaction time, with seller-controlled freshness and volatility limits
6. **What production-grade Move looks like** — OpenZeppelin's reference for clean module separation, explicit capability passing, and typed receipts

---

## [0:00–0:50] Opening: What You'll Learn

*[Screen: split view — running storefront UI on the left, shop.move open on the right]*

"If you're building on Sui, there are a handful of patterns that show up in
every serious contract — and getting them right early makes everything else
easier. This video walks through a fully working on-chain marketplace that puts
all of them together in one place.

It's a reference implementation from OpenZeppelin — not a tutorial that stops
at 'hello world', but a production-structured codebase you can clone, run, and
pattern-match your own contracts against.

Here's what you're going to walk away understanding:

The object model in practice — in Sui, the shop, the owner's authority, and
the buyer's receipt are all first-class on-chain objects. We'll see what that
actually looks like in code, not just in diagrams.

The capability pattern — how Move handles authorization by requiring you to
pass an object as proof of authority, instead of checking an address.

Phantom types as on-chain provenance — how to encode what was purchased
directly into the type of the receipt, so the compiler enforces correctness.

Programmable Transaction Blocks — how to compose multiple contract calls into
one atomic transaction, and why this marketplace uses it to bundle an oracle
update and a purchase into a single block.

And oracle integration — how Pyth price feeds get validated on-chain at
transaction time, with freshness and volatility guardrails the seller controls.

Let's get into it."

---

## [0:50–1:30] Repo Tour (~40 sec)

*[Screen: VS Code, tree view of repo root → open packages/dapp/contracts/oracle-market/sources/]*

"Clone the repo — it's a pnpm workspace with three meaningful layers.

The Move contracts live in packages/dapp/contracts/oracle-market. This is the
on-chain logic — the source of truth for everything we'll look at.

packages/dapp/src/scripts is a CLI layer: TypeScript scripts for deploying
contracts, seeding shops, and running owner and buyer flows. Useful for seeing
exactly what transactions look like before you build a UI on top.

packages/ui is the Next.js storefront — the full buyer and owner experience.

There's also a 23-chapter learning path in the docs folder if you want to go
deeper after this video. Link in the description."

---

## [1:30–3:15] Contract Walk-Through (~105 sec)

*[Screen: packages/dapp/contracts/oracle-market/sources/shop.move]*

### Pattern 1 — Object model + capability [1:30–2:10]

"Here's the Shop struct. It's a shared object — any transaction can read it,
and any transaction with the right capability can write it. The shop stores
listings, accepted currencies, and discounts in on-chain tables.

Now look at create_shop. It returns two things: the Shop object, and a
ShopOwnerCap. The cap is what proves you own this shop. It's an address-owned
object — only the holder can use it.

Here's add_item_listing. The first argument after the shop is a ShopOwnerCap.
You can't call this without passing the cap. There's no address check, no
modifier. The type system enforces authorization. If you don't hold the cap,
the transaction won't even build.

This is the capability pattern. Authority is something you hold, not something
you are. You can transfer the cap to a new address, delegate it to a multisig,
or wrap it in custom access logic — all without touching the contract."

*[Highlight: `struct Shop`, `fun create_shop(...): (Shop, ShopOwnerCap)`, `fun add_item_listing(shop: &mut Shop, owner_cap: &ShopOwnerCap, ...)`]*

### Pattern 2 — Phantom types [2:10–2:45]

"When a purchase completes, the buyer receives a ShopItem<T>. See the phantom
keyword — T is a type parameter that carries no runtime data, but it's part of
the type identity.

ShopItem<Car> and ShopItem<ConcertTicket> are different types. You can build
logic that only accepts ShopItem<VIPTicket> as proof of access. The type system
makes counterfeiting structurally impossible — not policy, but compiler enforcement.

This pattern is directly useful for loyalty points systems, tiered memberships,
typed access passes — any time you want to encode what something is into its
type and have Move guarantee it."

*[Highlight: `struct ShopItem<phantom T: store>`, `fun buy_item<T: store, C>(...)`]*

### Pattern 3 — Oracle buy + PTB [2:45–3:15]

"Items are priced in USD cents — a stable unit of account. The buyer passes a
Coin<C> for whatever currency they want to pay in. The contract takes a
PriceInfoObject from Pyth, reads the live exchange rate, calculates how much
of C equals the USD price, deducts it, and returns change.

The key detail: the PriceInfoObject must be fresh. The shop owner configures a
max price age per currency. Stale feed — transaction reverts. Too wide a
confidence interval — transaction reverts. The seller controls these guardrails.

In the actual buy transaction we'll see shortly, the PTB calls
pyth::update_price_feeds first to push a fresh price attestation on-chain, then
immediately calls buy_item using that feed. Both in one atomic block. Either
both succeed or neither does."

*[Highlight: `fun buy_item<T: store, C>(shop: &mut Shop, price_info_object: &PriceInfoObject, payment: Coin<C>, ...)`, price freshness assertion]*

---

## [3:15–3:50] Setup (~35 sec)

*[Screen: terminal]*

```bash
git clone git@github.com:OpenZeppelin/openzeppelin-sui-marketplace.git
cd openzeppelin-sui-marketplace
pnpm install

# Copy env examples
cp packages/dapp/.env.example packages/dapp/.env
cp packages/ui/.env.example packages/ui/.env.local
# Fill in SUI_ACCOUNT_ADDRESS + SUI_ACCOUNT_PRIVATE_KEY in packages/dapp/.env
# Get testnet SUI from the faucet (link in description)

# Contract is already deployed on testnet — seed a shop
export TESTNET_PKG=0x2c1bfd7e255adc2170ca1e8adfc93c094881acd8ec7e80e4686b686f432b4a07
pnpm script owner:shop:seed --shop-package-id $TESTNET_PKG

# Copy the Shop ID from the seed output
# Add to packages/ui/.env.local:  NEXT_PUBLIC_TESTNET_SHOP_ID=0x...

pnpm ui dev
```

"One seed command creates a shop with SUI, USDC, and WAL as accepted currencies,
four item listings, and two discounts. It's idempotent — re-run it and it
detects what already exists and skips it."

---

## [3:50–5:15] UI Walkthrough (~85 sec)

*[Screen: browser at localhost:3000 — switch to Testnet, connect Slush wallet as shop owner]*

### Owner view

"This is the owner console. Four listings — a Car at $10, a Metro Bike at $7.25
with a $1 spotlight discount, a Concert Ticket, a Digital Pass.

Go to Currencies — three accepted currencies, each showing a live Pyth price.
The owner registered each one with a feed ID and configured guardrails. If a
price is older than the max age, or the confidence interval is too wide, the
purchase reverts automatically. The shop is protected from volatile or stale
oracle conditions without any manual intervention.

Go to Discounts — a 10% global discount, and a $1 fixed discount on the Bike
capped at 25 total redemptions. Once 25 people claim it, it's gone on-chain.
Not a frontend check — a contract check."

### Add a listing (optional, ~15 sec)

*[Click Add Item, show the form briefly, then cancel]*

"Adding a listing from the UI builds a PTB that passes the ShopOwnerCap into
add_item_listing. If the connected wallet doesn't hold the cap, this button
doesn't appear — the UI detects ownership by reading the Shop object on-chain."

---

## [5:15–6:20] Buy Flow (~65 sec)

*[Switch to buyer wallet (or same wallet as a buyer)]*

"Now the buyer side. Click Metro Bike — $7.25. I'll pay in USDC."

*[Show price quote: "7.25 USD → X USDC at current oracle price"]*

"Apply the $1 spotlight discount."

*[Show updated quote: ~$6.25 converted to USDC]*

"Confirm in wallet."

"That PTB executed two calls: pyth::update_price_feeds pushed a fresh price
attestation from Hermes, then buy_item_with_discount used it immediately. The
oracle price is guaranteed to be seconds old at most by the time the purchase
settles."

*[ShopItem receipt appears in UI / wallet panel]*

"Here's the ShopItem<Bike> receipt — an on-chain owned object with a listing ID,
acquisition timestamp, and item name snapshot."

*[Open testnet.suivision.xyz, navigate to the transaction, click into the ShopItem object]*

"It's fully inspectable. A downstream contract — an events venue, a loyalty
program, an access control gate — could check for ShopItem<ConcertTicket> as
proof of purchase. The type carries the provenance."

---

## [6:20–7:00] Wrap-Up

"Five patterns from one contract.

The object model — everything is a first-class on-chain object.

The capability pattern — authority is something you hold, not something you
are. One of the most important ideas in Move.

Phantom types — the type system enforces what was purchased. No runtime checks,
no way to fake it.

PTBs — whole workflows, atomic. This changes how you design contract interfaces.

Oracle integration with guardrails — live prices, validated on-chain, with
controls the seller sets.

These aren't patterns just for marketplaces. Capabilities power access control
in DeFi vaults, DAOs, and lending protocols. Phantom types power loyalty
systems, ticket access, and asset receipts. PTBs are how complex on-chain
workflows stay atomic and composable. This repo puts them all in one place you
can run, read, and build from.

The full repo is open source — link below. The docs folder has a 23-chapter
learning path that goes deep on every concept here.

More coming on building with Sui and Move. Subscribe so you don't miss it."

---

## Production Notes

- Record on testnet with a seeded shop (run `owner:shop:seed` beforehand and have NEXT_PUBLIC_TESTNET_SHOP_ID set)
- Have two browser profiles ready: one with the owner wallet, one with a buyer wallet funded with testnet USDC
- Testnet USDC faucet: https://faucet.circle.com (for testnet USDC)
- Testnet SUI faucet: https://faucet.testnet.sui.io
- Explorer: https://testnet.suivision.xyz
- The "Unable to process transaction... localnet" wallet warning on localnet is expected and can be ignored — use testnet to avoid it entirely
