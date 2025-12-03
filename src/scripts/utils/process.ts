import { logChalkError } from "./log";
import { ensureSuiCli } from "./suiCli";

export const runSuiScript = (scriptToExecute: Function) => {
  (async () => {
    try {
      await ensureSuiCli();
      await scriptToExecute();
      process.exit(0);
    } catch (error) {
      console.log("\n");
      logChalkError("Publish failed ❌");
      logChalkError(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
  })();
};
