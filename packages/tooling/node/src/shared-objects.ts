import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import type { ToolingContext } from "./factory.ts"

export const getMutableSharedObject = async (
  { objectId }: { objectId: string },
  toolingContext: ToolingContext
) =>
  getSuiSharedObject(
    {
      objectId,
      mutable: true
    },
    toolingContext
  )

export const getImmutableSharedObject = async (
  { objectId }: { objectId: string },
  toolingContext: ToolingContext
) =>
  getSuiSharedObject(
    {
      objectId,
      mutable: false
    },
    toolingContext
  )
