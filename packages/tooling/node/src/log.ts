import chalk, { type ColorName } from "chalk"

/**
 * Builds a logger that prints a colored key followed by a gray value.
 */
export const logKeyValueColor =
  (colorName: ColorName) =>
  (coloredText: string) =>
  (regularText?: string | number | boolean) =>
    console.log(
      `${chalk[colorName](coloredText.padEnd(8))}: ${chalk.gray(regularText)}`
    )

/**
 * Builds a logger that prints only a colored key.
 */
export const simpleLogKeyValueColor =
  (colorName: ColorName) => (coloredText: string) =>
    console.log(`${chalk[colorName](coloredText.padEnd(8))}`)

/**
 * Logs a blue heading.
 */
export const logSimpleBlue = simpleLogKeyValueColor("blue")
/**
 * Logs a blue key/value pair.
 */
export const logKeyValueBlue = logKeyValueColor("blue")
/**
 * Logs a green heading.
 */
export const logSimpleGreen = simpleLogKeyValueColor("green")
/**
 * Logs a green key/value pair.
 */
export const logKeyValueGreen = logKeyValueColor("green")
/**
 * Logs a yellow key/value pair.
 */
export const logKeyValueYellow = logKeyValueColor("yellow")
/**
 * Logs a red key/value pair.
 */
export const logKeyValueRed = logKeyValueColor("red")

/**
 * Logs an error entry with a red prefix.
 */
export const logError = logKeyValueRed("Error")
/**
 * Logs a warning entry with a yellow prefix.
 */
export const logWarning = logKeyValueYellow("Warning")

/**
 * Converts camelCase or PascalCase to kebab-case for log labels.
 */
export const toKebabCase = (value: string) =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()

/**
 * Logs each key/value pair using a provided log function.
 */
export const logEach =
  (logKeyValueFunction: typeof logKeyValueGreen) =>
  (entries: Record<string, string | number | boolean | undefined>) =>
    Object.entries(entries).forEach(([key, value]) =>
      logKeyValueFunction(toKebabCase(key))(value)
    )

/**
 * Logs each entry in blue.
 */
export const logEachBlue = logEach(logKeyValueBlue)
/**
 * Logs each entry in green.
 */
export const logEachGreen = logEach(logKeyValueGreen)

/**
 * Logs a structured JSON block with a heading.
 */
export const logStructuredJson = (
  heading: string,
  content: Record<string, unknown> | unknown[]
) => {
  if (Object.keys(content).length === 0)
    return logKeyValueYellow(heading)("No fields present.")

  console.log(`${heading}:`)
  console.log(JSON.stringify(content, undefined, 2))
}
