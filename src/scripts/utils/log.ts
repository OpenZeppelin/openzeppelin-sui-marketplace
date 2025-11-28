import chalk from 'chalk';

export function formatKV(label: string, value: string | number) {
  return `${chalk.gray(label.padEnd(12))}${value}`;
}
