import chalk, { type ColorName } from "chalk";

export const logChalkColor =
  (colorName: ColorName) =>
  (coloredText: string) =>
  (regularText?: string | number) =>
    console.log(
      `${chalk[colorName](coloredText.padEnd(8))}: ${chalk.gray(regularText)}`
    );

export const logChalkBlue = logChalkColor("blue");
export const logChalkGreen = logChalkColor("green");
export const logChalkYellow = logChalkColor("yellow");
export const logChalkRed = logChalkColor("red");
export const logChalkError = logChalkRed("Error");
export const logChalkWarning = logChalkYellow("Warning");
