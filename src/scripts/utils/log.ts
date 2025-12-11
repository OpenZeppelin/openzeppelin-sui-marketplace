import chalk, { type ColorName } from "chalk"

export const logKeyValueColor =
  (colorName: ColorName) =>
  (coloredText: string) =>
  (regularText?: string | number) =>
    console.log(
      `${chalk[colorName](coloredText.padEnd(8))}: ${chalk.gray(regularText)}`
    )

export const simpleLogKeyValueColor =
  (colorName: ColorName) => (coloredText: string) =>
    console.log(`${chalk[colorName](coloredText.padEnd(8))}`)

export const logSimpleBlue = simpleLogKeyValueColor("blue")
export const logKeyValueBlue = logKeyValueColor("blue")
export const logSimpleGreen = simpleLogKeyValueColor("green")
export const logKeyValueGreen = logKeyValueColor("green")
export const logKeyValueYellow = logKeyValueColor("yellow")
export const logKeyValueRed = logKeyValueColor("red")

export const logError = logKeyValueRed("Error")
export const logWarning = logKeyValueYellow("Warning")

export const toKebabCase = (value: string) =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()

export const logEach =
  (logKeyValueFunction: typeof logKeyValueGreen) =>
  (entries: Record<string, string | number | undefined>) =>
    Object.entries(entries).forEach(([key, value]) =>
      logKeyValueFunction(toKebabCase(key))(value)
    )

export const logEachBlue = logEach(logKeyValueBlue)
export const logEachGreen = logEach(logKeyValueGreen)
