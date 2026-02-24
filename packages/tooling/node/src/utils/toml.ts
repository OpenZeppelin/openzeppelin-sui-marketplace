import { escapeRegExp } from "./regex.ts"

type TomlSectionSlice = {
  block: string
  start: number
  end: number
}

const ANY_SECTION_HEADER_REGEX = /^\s*\[[^\]]+\]\s*(#.*)?$/

const getLineStartOffsets = (contents: string): number[] => {
  const offsets = [0]
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === "\n") offsets.push(index + 1)
  }
  return offsets
}

export const sliceTomlSection = (
  contents: string,
  headerPattern: RegExp
): TomlSectionSlice | undefined => {
  const lines = contents.split(/\r?\n/)
  const lineOffsets = getLineStartOffsets(contents)

  const headerIndex = lines.findIndex((line) => headerPattern.test(line))
  if (headerIndex < 0) return undefined

  const nextHeaderIndex = lines.findIndex(
    (line, index) => index > headerIndex && ANY_SECTION_HEADER_REGEX.test(line)
  )

  const start = lineOffsets[headerIndex] ?? 0
  const end =
    nextHeaderIndex >= 0
      ? (lineOffsets[nextHeaderIndex] ?? contents.length)
      : contents.length

  return { block: contents.slice(start, end), start, end }
}

export const findTomlSectionByName = (
  contents: string,
  sectionName: string
): TomlSectionSlice | undefined =>
  sliceTomlSection(
    contents,
    new RegExp(`^\\s*\\[${escapeRegExp(sectionName)}\\]\\s*(#.*)?$`)
  )
