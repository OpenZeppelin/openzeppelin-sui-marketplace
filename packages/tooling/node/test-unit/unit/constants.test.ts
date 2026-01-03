import path from "node:path"
import os from "node:os"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_KEYSTORE_PATH,
  DEFAULT_PUBLISH_GAS_BUDGET,
  DEFAULT_TX_GAS_BUDGET,
  MINIMUM_ACCOUNT_BALANCE,
  MINIMUM_GAS_COIN_BALANCE,
  MINIMUM_GAS_COIN_OBJECTS,
  ONE_SUI,
  SUI_CLOCK_ID,
  SUI_COIN_REGISTRY_ID
} from "../../src/constants.ts"
import * as coreConstants from "@sui-oracle-market/tooling-core/constants"

describe("tooling constants", () => {
  it("derives the default keystore path from the home directory", () => {
    const expected = path.join(
      os.homedir(),
      ".sui",
      "sui_config",
      "sui.keystore"
    )

    expect(DEFAULT_KEYSTORE_PATH).toBe(expected)
  })

  it("re-exports core constants without mutation", () => {
    expect(ONE_SUI).toBe(coreConstants.ONE_SUI)
    expect(MINIMUM_GAS_COIN_BALANCE).toBe(
      coreConstants.MINIMUM_GAS_COIN_BALANCE
    )
    expect(MINIMUM_GAS_COIN_OBJECTS).toBe(
      coreConstants.MINIMUM_GAS_COIN_OBJECTS
    )
    expect(MINIMUM_ACCOUNT_BALANCE).toBe(coreConstants.MINIMUM_ACCOUNT_BALANCE)
    expect(DEFAULT_TX_GAS_BUDGET).toBe(coreConstants.DEFAULT_TX_GAS_BUDGET)
    expect(DEFAULT_PUBLISH_GAS_BUDGET).toBe(
      coreConstants.DEFAULT_PUBLISH_GAS_BUDGET
    )
    expect(SUI_CLOCK_ID).toBe(coreConstants.SUI_CLOCK_ID)
    expect(SUI_COIN_REGISTRY_ID).toBe(coreConstants.SUI_COIN_REGISTRY_ID)
  })
})
