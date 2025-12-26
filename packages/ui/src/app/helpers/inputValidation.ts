import {
  resolveValidationMessage,
  validateMoveType,
  validateOptionalSuiAddress,
  validateOptionalSuiObjectId,
  validateRequiredHexBytes,
  validateRequiredSuiObjectId
} from "@sui-oracle-market/tooling-core/utils/validation"

export {
  resolveValidationMessage,
  validateMoveType,
  validateOptionalSuiAddress,
  validateOptionalSuiObjectId,
  validateRequiredHexBytes,
  validateRequiredSuiObjectId
}

export const resolveCoinTypeInput = (value: string) => value.trim()

export const validateCoinType = (value: string, label: string) =>
  validateMoveType(value, label)

export const validateItemType = (value: string, label: string) =>
  validateMoveType(value, label)
