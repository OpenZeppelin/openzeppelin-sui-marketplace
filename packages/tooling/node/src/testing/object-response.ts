import type { ObjectResponseError } from "@mysten/sui/client"

export const formatObjectResponseError = (
  error: ObjectResponseError | null | undefined
): string | undefined => {
  if (!error) return undefined
  switch (error.code) {
    case "displayError":
      return error.error
    case "notExists":
      return `Object ${error.object_id} does not exist.`
    case "deleted":
      return `Object ${error.object_id} was deleted at version ${error.version}.`
    case "dynamicFieldNotFound":
      return `Dynamic field parent ${error.parent_object_id} was not found.`
    case "unknown":
    default:
      return "Unknown object error."
  }
}
