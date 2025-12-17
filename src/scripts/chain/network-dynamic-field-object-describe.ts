import yargs from "yargs"

import { logKeyValueBlue, logKeyValueGreen } from "../../tooling/log.ts"
import { getSuiDynamicFieldObject } from "../../tooling/dynamic-fields.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  buildObjectInformation,
  createSuiClient,
  logInspectionContext,
  logObjectInformation,
  normalizeTargetObjectId
} from "../../utils/describe-object.ts"

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const normalizedParentId = normalizeTargetObjectId(cliArguments.parentId)
    const normalizedChildId = normalizeTargetObjectId(cliArguments.childId)

    const suiClient = createSuiClient(network.url)

    logDynamicFieldInspectionContext({
      childId: normalizedChildId,
      parentId: normalizedParentId,
      networkName: currentNetwork,
      rpcUrl: network.url
    })

    const { object, dynamicFieldId, error } = await getSuiDynamicFieldObject(
      {
        parentObjectId: normalizedParentId,
        childObjectId: normalizedChildId
      },
      suiClient
    )

    logKeyValueGreen("Field")(dynamicFieldId)

    const objectInformation = buildObjectInformation({ object, error })
    logObjectInformation(objectInformation)
  },
  yargs()
    .option("parentId", {
      alias: ["parent-id"],
      type: "string",
      demandOption: true,
      description: "Parent shared object ID that owns the dynamic field"
    })
    .option("childId", {
      alias: ["child-id", "name"],
      type: "string",
      demandOption: true,
      description: "Dynamic field name (object ID) to inspect"
    })
    .strict()
)

const logDynamicFieldInspectionContext = ({
  parentId,
  childId,
  rpcUrl,
  networkName
}: {
  parentId: string
  childId: string
  rpcUrl: string
  networkName: string
}) => {
  logInspectionContext({
    objectId: childId,
    rpcUrl,
    networkName
  })
  logKeyValueBlue("Parent")(parentId)
  logKeyValueBlue("Child")(childId)
}
