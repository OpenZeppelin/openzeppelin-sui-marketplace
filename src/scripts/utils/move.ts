import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import type { BuildOutput } from "./types";
import { logChalkWarning } from "./log";

const execFile = promisify(execFileCallback);

export const buildMovePackage = async (
  packagePath: string
): Promise<BuildOutput> => {
  console.log({ packagePath });
  const { stdout, stderr } = await execFile("sui", [
    "move",
    "build",
    "--dump-bytecode-as-base64",
    "--path",
    packagePath,
    "--json",
  ]);

  if (stderr) logChalkWarning(stderr.trim());

  const jsonLine = stdout.trim().split("\n").filter(Boolean).pop();

  console.log({ jsonLine });

  if (!jsonLine)
    throw new Error("No JSON output received from `sui move build`");

  const parsed = JSON.parse(jsonLine);

  console.log({ parsed });

  if (!Array.isArray(parsed.modules) || !Array.isArray(parsed.dependencies))
    throw new Error(
      `Unexpected build output. Ensure the package builds correctly\n${jsonLine}`
    );

  return {
    modules: parsed.modules,
    dependencies: parsed.dependencies,
  };
};
