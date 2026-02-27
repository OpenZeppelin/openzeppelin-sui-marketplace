import type { Transaction } from "@mysten/sui/transactions"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import { normalizeListingId } from "../models/item-listing.ts"

export const normalizeObjectIdArgument = (
  objectId: string,
  label: string
): string => normalizeIdOrThrow(objectId, `Missing ${label}.`)

export const normalizeOptionalObjectIdArgument = (
  objectId: string | undefined,
  label: string
): string | null =>
  objectId ? normalizeObjectIdArgument(objectId, label) : null

export const buildObjectIdArgument = (
  transaction: Transaction,
  objectId: string,
  label: string
) => transaction.pure.address(normalizeObjectIdArgument(objectId, label))

export const buildOptionalObjectIdArgument = (
  transaction: Transaction,
  objectId: string | undefined,
  label: string
) =>
  transaction.pure.option(
    "address",
    normalizeOptionalObjectIdArgument(objectId, label)
  )

export const buildListingIdArgument = (
  transaction: Transaction,
  listingId: string,
  label = "listingId"
) => transaction.pure.address(normalizeListingId(listingId, label))

export const buildOptionalListingIdArgument = (
  transaction: Transaction,
  listingId: string | undefined,
  label = "listingId"
) =>
  transaction.pure.option(
    "address",
    listingId ? normalizeListingId(listingId, label) : null
  )
