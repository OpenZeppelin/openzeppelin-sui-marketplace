import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import { deriveCurrencyObjectId } from "@sui-oracle-market/tooling-core/coin-registry"
import { SUI_COIN_TYPE } from "@sui-oracle-market/tooling-core/constants"
import { objectTypeMatches } from "@sui-oracle-market/tooling-core/object"
import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import {
  DEFAULT_TX_GAS_BUDGET,
  SUI_COIN_REGISTRY_ID
} from "@sui-oracle-market/tooling-node/constants"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  logKeyValueBlue,
  logKeyValueGreen
} from "@sui-oracle-market/tooling-node/log"
import { newTransaction } from "@sui-oracle-market/tooling-node/transactions"

const CURRENCY_TYPE = `0x2::coin_registry::Currency<${SUI_COIN_TYPE}>`

let nativeSuiCurrencyRegistered = false

export const ensureNativeSuiCurrencyRegistration = async (
  tooling: Tooling,
  {
    coinRegistryObject,
    signer = tooling.loadedEd25519KeyPair
  }: {
    coinRegistryObject?: WrappedSuiSharedObject
    signer?: Ed25519Keypair
  } = {}
): Promise<void> => {
  if (nativeSuiCurrencyRegistered) return
  if (!signer)
    throw new Error(
      "Missing signer while ensuring native SUI currency registration. Provide a keypair in tooling configuration."
    )

  const currencyObjectId = deriveCurrencyObjectId(
    SUI_COIN_TYPE,
    SUI_COIN_REGISTRY_ID
  )
  const existingCurrency = await tooling.getObjectSafe({
    objectId: currencyObjectId,
    options: { showType: true, showBcs: true }
  })

  if (objectTypeMatches(existingCurrency, CURRENCY_TYPE)) {
    nativeSuiCurrencyRegistered = true
    logKeyValueBlue("Currency")(
      `Native SUI registry entry present ${currencyObjectId}`
    )
    return
  }

  const metadata = await tooling.suiClient.getCoinMetadata({
    coinType: SUI_COIN_TYPE
  })
  const metadataId = metadata?.id
    ? normalizeSuiObjectId(metadata.id)
    : undefined

  if (!metadataId)
    throw new Error(
      "CoinMetadata<SUI> not found. Ensure your local validator exposes native metadata or rerun `pnpm --filter dapp mock:setup`."
    )

  const registryObject =
    coinRegistryObject ??
    (await tooling.getSuiSharedObject({
      objectId: SUI_COIN_REGISTRY_ID,
      mutable: true
    }))

  const gasBudget = tooling.network.gasBudget ?? DEFAULT_TX_GAS_BUDGET
  const transaction = newTransaction(gasBudget)

  transaction.moveCall({
    target: "0x2::coin_registry::migrate_legacy_metadata",
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      transaction.sharedObjectRef(registryObject.sharedRef),
      transaction.object(metadataId)
    ]
  })

  await tooling.withTestnetFaucetRetry(
    {
      signerAddress: signer.toSuiAddress(),
      signer
    },
    async () =>
      await tooling.signAndExecute({
        transaction,
        signer
      })
  )

  const migratedCurrency = await tooling.getObjectSafe({
    objectId: currencyObjectId,
    options: { showType: true, showBcs: true }
  })

  if (!objectTypeMatches(migratedCurrency, CURRENCY_TYPE))
    throw new Error(
      "Native SUI currency migration completed without creating the expected registry entry."
    )

  nativeSuiCurrencyRegistered = true
  logKeyValueGreen("Currency")(
    `Registered native SUI coin registry entry ${currencyObjectId}`
  )
}
