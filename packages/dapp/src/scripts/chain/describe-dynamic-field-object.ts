import yargs from "yargs"

import { getSuiDynamicFieldObject } from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  buildObjectInformation,
  createSuiClient,
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
