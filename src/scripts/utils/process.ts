import { logError } from "./log";
import { ensureSuiCli } from "./suiCli";

export const runSuiScript = (scriptToExecute: Function) => {
  (async () => {
    try {
      await ensureSuiCli();
      await scriptToExecute();
      process.exit(0);
    } catch (error) {
      console.log("\n");
      logError("Script failed ❌");
      logError(
        `${error instanceof Error ? error.message : String(error)}\n${
          error instanceof Error ? error.stack : ""
        }`
      );
      logError(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  })();
};
