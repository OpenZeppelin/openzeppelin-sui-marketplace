import yargs from "yargs"

import { getSuiObject } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  OBJECT_REQUEST_OPTIONS,
  buildObjectInformation,
  createSuiClient,
  logInspectionContext,
  logObjectInformation,
  normalizeTargetObjectId
} from "../../utils/describe-object.ts"

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
