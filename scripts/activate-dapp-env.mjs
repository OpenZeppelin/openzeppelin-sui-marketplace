#!/usr/bin/env node
/**
 * Developer workflow for switching between owner and buyer account profiles.
 *
 * Usage:
 *   pnpm env:owner     — activate packages/dapp/.env.owner
 *   pnpm env:buyer     — activate packages/dapp/.env.buyer
 *   pnpm env:status    — show active network + address from packages/dapp/.env
 *   pnpm env:bootstrap — split a legacy packages/dapp/.env into profiles
 */
import { copyFile, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DAPP = path.join(ROOT, "packages", "dapp")

const ENV = path.join(DAPP, ".env")
const ENV_OWNER = path.join(DAPP, ".env.owner")
const ENV_BUYER = path.join(DAPP, ".env.buyer")

/**
 * Matches literal placeholder values like <base64 or hex> that should not be
 * treated as real credentials.
 */
const PLACEHOLDER = /^<[^>]+>$/

const isRealValue = (value) =>
  value !== undefined && value !== "" && !PLACEHOLDER.test(value)

const parseEnv = (contents) => {
  const entries = {}
  for (const line of contents.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    entries[key] = value
  }
  return entries
}

const serializeEnv = (entries) =>
  Object.entries(entries)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n"

const commands = {
  async owner() {
    if (!existsSync(ENV_OWNER)) {
      console.error(
        "packages/dapp/.env.owner not found.\n" +
          "Copy packages/dapp/.env.owner.example, fill in your credentials, then retry."
      )
      process.exit(1)
    }
    await copyFile(ENV_OWNER, ENV)
    console.log("Activated owner profile  (packages/dapp/.env.owner → packages/dapp/.env)")
  },

  async buyer() {
    if (!existsSync(ENV_BUYER)) {
      console.error(
        "packages/dapp/.env.buyer not found.\n" +
          "Copy packages/dapp/.env.buyer.example, fill in your credentials, then retry."
      )
      process.exit(1)
    }
    await copyFile(ENV_BUYER, ENV)
    console.log("Activated buyer profile  (packages/dapp/.env.buyer → packages/dapp/.env)")
  },

  async status() {
    if (!existsSync(ENV)) {
      console.log("No active profile — packages/dapp/.env not found.")
      console.log("Run `pnpm env:owner` or `pnpm env:buyer` to activate a profile.")
      return
    }
    const entries = parseEnv(await readFile(ENV, "utf8"))
    console.log(`Network : ${entries.SUI_NETWORK || "(not set)"}`)
    console.log(`Address : ${entries.SUI_ACCOUNT_ADDRESS || "(not set)"}`)
  },

  async bootstrap() {
    if (!existsSync(ENV)) {
      console.error(
        "packages/dapp/.env not found — nothing to bootstrap from.\n" +
          "Create it from a legacy single-account .env first."
      )
      process.exit(1)
    }

    const src = parseEnv(await readFile(ENV, "utf8"))
    const network = src.SUI_NETWORK ?? ""

    // Primary account → owner profile
    const owner = {
      SUI_NETWORK: network,
      SUI_ACCOUNT_ADDRESS: src.SUI_ACCOUNT_ADDRESS ?? "",
      SUI_ACCOUNT_PRIVATE_KEY: isRealValue(src.SUI_ACCOUNT_PRIVATE_KEY)
        ? src.SUI_ACCOUNT_PRIVATE_KEY
        : "",
      SUI_ACCOUNT_MNEMONIC: isRealValue(src.SUI_ACCOUNT_MNEMONIC)
        ? src.SUI_ACCOUNT_MNEMONIC
        : ""
    }

    // _2 account → buyer profile (keys renamed to primary names)
    const buyer = {
      SUI_NETWORK: network,
      SUI_ACCOUNT_ADDRESS: src.SUI_ACCOUNT_ADDRESS_2 ?? "",
      SUI_ACCOUNT_PRIVATE_KEY: isRealValue(src.SUI_ACCOUNT_PRIVATE_KEY_2)
        ? src.SUI_ACCOUNT_PRIVATE_KEY_2
        : "",
      SUI_ACCOUNT_MNEMONIC: isRealValue(src.SUI_ACCOUNT_MNEMONIC_2)
        ? src.SUI_ACCOUNT_MNEMONIC_2
        : ""
    }

    await writeFile(ENV_OWNER, serializeEnv(owner), "utf8")
    console.log("Created packages/dapp/.env.owner")

    await writeFile(ENV_BUYER, serializeEnv(buyer), "utf8")
    console.log("Created packages/dapp/.env.buyer")

    await commands.owner()
  }
}

const [, , command] = process.argv

if (!command || !Object.hasOwn(commands, command)) {
  const available = Object.keys(commands).join(" | ")
  console.error(`Usage: activate-dapp-env.mjs <${available}>`)
  process.exit(1)
}

commands[command]().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
