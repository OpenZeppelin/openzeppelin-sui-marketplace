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
