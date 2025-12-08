import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const ensureSuiCli = async () => {
  try {
    await execFile("sui", ["--version"]);
  } catch (error) {
    throw new Error(
      "The Sui CLI is required but was not found. Install it and ensure `sui` is on your PATH."
    );
  }
};
