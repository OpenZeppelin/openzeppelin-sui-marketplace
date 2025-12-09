import chalk, { type ColorName } from "chalk";

export const logKeyValueColor =
  (colorName: ColorName) =>
  (coloredText: string) =>
  (regularText?: string | number) =>
    console.log(
      `${chalk[colorName](coloredText.padEnd(8))}: ${chalk.gray(regularText)}`
    );

export const simpleLogKeyValueColor =
  (colorName: ColorName) => (coloredText: string) =>
    console.log(`${chalk[colorName](coloredText.padEnd(8))}`);

export const logSimpleBlue = simpleLogKeyValueColor("blue");
export const logKeyValueBlue = logKeyValueColor("blue");
export const logSimpleGreen = simpleLogKeyValueColor("green");
export const logKeyValueGreen = logKeyValueColor("green");
export const logKeyValueYellow = logKeyValueColor("yellow");
export const logKeyValueRed = logKeyValueColor("red");

export const logError = logKeyValueRed("Error");
export const logWarning = logKeyValueYellow("Warning");
