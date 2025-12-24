/**
 * Inspects a single Sui object by ID and prints its type, owner, and contents.
 * Sui is object-centric: state lives in objects, and each object has an owner and a version.
 * If you come from EVM, this replaces "read storage at a slot" with "fetch the object itself."
 * Use this to debug any on-chain object, including shared, owned, or immutable objects.
 */
import yargs from "yargs"

import {
  OBJECT_REQUEST_OPTIONS,
  buildObjectInformation,
  logInspectionContext,
  logObjectInformation,
  normalizeTargetObjectId
} from "@sui-oracle-market/tooling-node/describe-object"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

runSuiScript(
  async (tooling, cliArguments) => {
    const {
      suiConfig: { network, currentNetwork }
    } = tooling
    const normalizedObjectId = normalizeTargetObjectId(cliArguments.objectId)

    logInspectionContext({
      objectId: normalizedObjectId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const { object, error } = await tooling.getSuiObject({
      objectId: normalizedObjectId,
      options: OBJECT_REQUEST_OPTIONS
    })

    const objectInformation = buildObjectInformation({ object, error })

    logObjectInformation(objectInformation)
  },
  yargs()
    .option("objectId", {
      alias: ["object-id", "id"],
      type: "string",
      demandOption: true,
      description: "Object ID to inspect"
    })
    .strict()
)
