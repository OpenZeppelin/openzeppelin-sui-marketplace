import yargs from "yargs"

import { getSuiObject } from "@sui-oracle-market/tooling-core/object"
import {
  OBJECT_REQUEST_OPTIONS,
  buildObjectInformation,
  createSuiClient,
  logInspectionContext,
  logObjectInformation,
  normalizeTargetObjectId
} from "@sui-oracle-market/tooling-node/describe-object"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const suiClient = createSuiClient(network.url)
    const normalizedObjectId = normalizeTargetObjectId(cliArguments.objectId)

    logInspectionContext({
      objectId: normalizedObjectId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const { object, error } = await getSuiObject(
      { objectId: normalizedObjectId, options: OBJECT_REQUEST_OPTIONS },
      suiClient
    )

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
