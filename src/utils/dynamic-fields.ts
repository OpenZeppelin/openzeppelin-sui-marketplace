import type { DynamicFieldInfo, SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

/**
 * Paginates through all dynamic fields under a parent object.
 * Centralized helper so scripts avoid reimplementing the cursor loop.
 */
export const fetchAllDynamicFields = async (
  parentId: string,
  suiClient: SuiClient
): Promise<DynamicFieldInfo[]> => {
  const allDynamicFields: DynamicFieldInfo[] = []
  let cursor: string | null | undefined

  do {
    const page = await suiClient.getDynamicFields({
      parentId: normalizeSuiObjectId(parentId),
      cursor: cursor ?? null
    })

    allDynamicFields.push(...page.data)
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)

  return allDynamicFields
}
