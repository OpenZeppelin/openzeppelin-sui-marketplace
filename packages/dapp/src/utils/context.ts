import {
  logKeyValueBlue,
  logSimpleBlue
} from "@sui-oracle-market/tooling-node/log"

export type ContextEntryValue = string | number | boolean

export type ContextEntry = {
  label: string
  value?: ContextEntryValue
}

type LogContextOptions = {
  includeBlankLine?: boolean
}

const formatContextValue = (value: ContextEntryValue) => String(value)

export const logScriptContext = (
  entries: ContextEntry[],
  options: LogContextOptions = {}
) => {
  const includeBlankLine = options.includeBlankLine ?? true

  entries.forEach(({ label, value }) => {
    if (value === undefined) return
    logKeyValueBlue(label)(formatContextValue(value))
  })

  if (includeBlankLine) console.log("")
}

export type ListContext = {
  networkName: string
  rpcUrl: string
  shopId?: string
  ownerAddress?: string
  packageId?: string
  shopLabel?: string
}

export const logListContext = ({
  networkName,
  rpcUrl,
  shopId,
  ownerAddress,
  packageId,
  shopLabel = "Shop"
}: ListContext) =>
  logScriptContext([
    { label: "Network", value: networkName },
    { label: "RPC", value: rpcUrl },
    { label: "Owner", value: ownerAddress },
    { label: "Package", value: packageId },
    { label: shopLabel, value: shopId }
  ])

export const logListHeader = (label: string, count?: number) => {
  logSimpleBlue(label)
  if (count !== undefined) logKeyValueBlue("Count")(count)
  console.log("")
}

export const logListContextWithHeader = (
  context: ListContext,
  {
    label,
    count
  }: {
    label: string
    count?: number
  }
) => {
  logListContext(context)
  logListHeader(label, count)
}
