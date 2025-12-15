import type { MoveStruct } from "@mysten/sui/client"
import {
  type ObjectResponseError,
  SuiClient,
  type SuiObjectData,
  type SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow,
  logStructuredJson
} from "../../tooling/log.ts"
import {
  formatOptionalNumber,
  mapOwnerToLabel
} from "../../tooling/object-info.ts"
import { getSuiObject } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"

type GetObjectInfoCliArgs = {
  objectId: string
}

type ObjectInformation = {
  objectId: string
  objectType?: string
  version?: string
  digest?: string
  storageRebate?: string
  ownerLabel?: string
  previousTransaction?: string
  hasPublicTransfer?: boolean
  contentSummary?: ObjectContentSummary
  displayData?: Record<string, string>
  bcsSummary?: ObjectBcsSummary
  errorMessage?: string
}

type ObjectContentSummary =
  | {
      dataType: "moveObject"
      type: string
      fields: MoveStruct
    }
  | {
      dataType: "package"
      moduleNames: string[]
    }

type ObjectBcsSummary = {
  dataType: string
  type?: string
  bytesLength?: number
  bytesPreview?: string
}

const OBJECT_REQUEST_OPTIONS: SuiObjectDataOptions = {
  showBcs: true,
  showContent: true,
  showDisplay: true,
  showOwner: true,
  showPreviousTransaction: true,
  showStorageRebate: true,
  showType: true
}

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

const createSuiClient = (rpcUrl: string) => new SuiClient({ url: rpcUrl })

const normalizeTargetObjectId = (objectId: string) =>
  normalizeSuiObjectId(objectId)

const buildObjectInformation = ({
  object,
  error
}: {
  object: SuiObjectData
  error?: ObjectResponseError
}): ObjectInformation => ({
  objectId: object.objectId,
  objectType: object.type || undefined,
  version: formatOptionalNumber(object.version),
  digest: object.digest,
  storageRebate: formatOptionalNumber(object.storageRebate || undefined),
  ownerLabel: mapOwnerToLabel(object.owner),
  previousTransaction: object.previousTransaction || undefined,
  hasPublicTransfer: extractHasPublicTransfer(object.content),
  contentSummary: extractContentSummary(object.content),
  displayData: extractDisplayData(object.display),
  bcsSummary: extractBcsSummary(object.bcs),
  errorMessage: error ? buildObjectErrorMessage(error) : undefined
})

const extractHasPublicTransfer = (
  content: SuiObjectData["content"]
): boolean | undefined => {
  if (content?.dataType !== "moveObject") return undefined

  return content.hasPublicTransfer
}

const extractContentSummary = (
  content: SuiObjectData["content"]
): ObjectContentSummary | undefined => {
  if (!content) return undefined

  if (content.dataType === "package")
    return {
      dataType: "package",
      moduleNames: Object.keys(content.disassembled || {})
    }

  if (content.dataType === "moveObject")
    return {
      dataType: "moveObject",
      type: content.type,
      fields: content.fields
    }

  return undefined
}

const extractDisplayData = (
  display: SuiObjectData["display"]
): Record<string, string> | undefined => {
  const displayEntries = display?.data
  if (!displayEntries) return undefined

  const displayData = Object.entries(displayEntries).reduce<
    Record<string, string>
  >((entries, [key, value]) => {
    if (typeof value === "string") {
      return { ...entries, [key]: value }
    }

    return entries
  }, {})

  return Object.keys(displayData).length > 0 ? displayData : undefined
}

const extractBcsSummary = (
  bcs: SuiObjectData["bcs"]
): ObjectBcsSummary | undefined => {
  if (!bcs) return undefined

  const baseSummary: ObjectBcsSummary = {
    dataType: bcs.dataType,
    type: "type" in bcs ? bcs.type : undefined
  }

  const bcsBytes = "bcsBytes" in bcs ? bcs.bcsBytes : undefined

  if (!bcsBytes) return baseSummary

  return {
    ...baseSummary,
    bytesLength: bcsBytes.length,
    bytesPreview: truncateString(bcsBytes, 120)
  }
}

const buildObjectErrorMessage = (error: ObjectResponseError) => {
  const parts = [
    "code" in error ? error.code : undefined,
    "error" in error ? (error as { error?: string }).error : undefined
  ]

  const message = parts.filter(Boolean).join(" - ")
  return message || "Unknown object fetch error"
}

const logObjectInformation = (objectInformation: ObjectInformation) => {
  logKeyValueGreen("Object")(objectInformation.objectId)
  if (objectInformation.objectType)
    logKeyValueGreen("Type")(objectInformation.objectType)
  logKeyValueGreen("Version")(objectInformation.version ?? "Unknown")
  if (objectInformation.digest)
    logKeyValueGreen("Digest")(objectInformation.digest)
  if (objectInformation.storageRebate)
    logKeyValueGreen("Storage")(objectInformation.storageRebate)
  if (objectInformation.ownerLabel)
    logKeyValueGreen("Owner")(objectInformation.ownerLabel)
  if (objectInformation.previousTransaction)
    logKeyValueGreen("Previous-tx")(objectInformation.previousTransaction)
  if (objectInformation.hasPublicTransfer !== undefined)
    logKeyValueGreen("Public-transfer")(
      formatBoolean(objectInformation.hasPublicTransfer)
    )
  if (objectInformation.errorMessage)
    logKeyValueYellow("Rpc-warning")(objectInformation.errorMessage)

  console.log("\nContent")
  logObjectContent(objectInformation.contentSummary)

  console.log("\nDisplay")
  logDisplayData(objectInformation.displayData)

  console.log("\nBCS")
  logBcsSummary(objectInformation.bcsSummary)
}

const logObjectContent = (contentSummary: ObjectContentSummary | undefined) => {
  if (!contentSummary) {
    logKeyValueYellow("Content")("No content returned for this object.")
    return
  }

  if (contentSummary.dataType === "package") {
    logKeyValueGreen("Data-type")("package")
    if (contentSummary.moduleNames.length === 0) {
      logKeyValueYellow("Modules")("No modules found.")
      return
    }

    logKeyValueGreen("Modules")(contentSummary.moduleNames.join(", "))
    return
  }

  logKeyValueGreen("Data-type")("moveObject")
  logKeyValueGreen("Move-type")(contentSummary.type)
  logStructuredJson("Fields", contentSummary.fields)
}

const logDisplayData = (displayData?: Record<string, string>) => {
  if (!displayData || Object.keys(displayData).length === 0) {
    logKeyValueYellow("Display")("No display data available.")
    return
  }

  logEachGreen(displayData)
}

const logBcsSummary = (bcsSummary?: ObjectBcsSummary) => {
  if (!bcsSummary) return logKeyValueYellow("Bcs")("No BCS bytes available.")

  logEachGreen({
    dataType: bcsSummary.dataType,
    type: bcsSummary.type || "Unknown",
    bytesLength: bcsSummary.bytesLength ?? 0,
    bytesPreview: bcsSummary.bytesPreview || "N/A"
  })
}

const logInspectionContext = ({
  objectId,
  rpcUrl,
  networkName
}: {
  objectId: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Inspecting")(objectId)
  console.log("\n")
}

const truncateString = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value

const formatBoolean = (value: boolean | undefined) =>
  value !== undefined ? (value ? "true" : "false") : undefined
