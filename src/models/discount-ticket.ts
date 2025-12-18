import type { SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import {
  normalizeIdOrThrow,
  normalizeOptionalAddress,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../tooling/object.ts"
import { requireValue } from "../utils/utility.ts"

export const DISCOUNT_TICKET_TYPE_FRAGMENT = "::shop::DiscountTicket"

export const formatDiscountTicketStructType = (packageId: string): string =>
  `${normalizeSuiObjectId(packageId)}${DISCOUNT_TICKET_TYPE_FRAGMENT}`

export type DiscountTicketDetails = {
  discountTicketId: string
  discountTemplateId: string
  shopAddress: string
  listingId?: string
  claimer: string
}

export const parseDiscountTicketFromObject = (
  discountTicketObject: SuiObjectData
): DiscountTicketDetails => {
  const discountTicketId = normalizeIdOrThrow(
    discountTicketObject.objectId,
    "DiscountTicket object is missing an id."
  )

  const discountTicketFields = unwrapMoveObjectFields<{
    discount_template_id: unknown
    shop_address: unknown
    listing_id: unknown
    claimer: unknown
  }>(discountTicketObject)

  const listingId = normalizeOptionalIdFromValue(
    discountTicketFields.listing_id
  )

  return {
    discountTicketId,
    discountTemplateId: normalizeIdOrThrow(
      normalizeOptionalIdFromValue(discountTicketFields.discount_template_id),
      `Missing discount_template_id for DiscountTicket ${discountTicketId}.`
    ),
    shopAddress: normalizeIdOrThrow(
      normalizeOptionalIdFromValue(discountTicketFields.shop_address),
      `Missing shop_address for DiscountTicket ${discountTicketId}.`
    ),
    listingId: listingId ? normalizeSuiObjectId(listingId) : undefined,
    claimer: requireValue(
      normalizeOptionalAddress(discountTicketFields.claimer),
      `Missing claimer for DiscountTicket ${discountTicketId}.`
    )
  }
}
