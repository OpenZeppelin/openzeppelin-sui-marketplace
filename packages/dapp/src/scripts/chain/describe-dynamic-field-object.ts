import yargs from "yargs"

import {
  buildObjectInformation,
  logInspectionContext,
  logObjectInformation,
  normalizeTargetObjectId
} from "@sui-oracle-market/tooling-node/describe-object"
import {
  logKeyValueBlue,
  logKeyValueGreen
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

runSuiScript(
  async (
    tooling,
    { parentId, childId }: { parentId: string; childId: string }
  ) => {
    const normalizedParentId = normalizeTargetObjectId(parentId)
    const normalizedChildId = normalizeTargetObjectId(childId)

    logDynamicFieldInspectionContext({
      childId: normalizedChildId,
      parentId: normalizedParentId,
      networkName: tooling.network.networkName,
      rpcUrl: tooling.network.url
    })

    const { object, dynamicFieldId, error } =
      await tooling.getSuiDynamicFieldObject({
        parentObjectId: normalizedParentId,
        childObjectId: normalizedChildId
      })

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
