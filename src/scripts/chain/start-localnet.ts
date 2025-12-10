import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getFaucetHost } from "@mysten/sui/faucet";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow,
  logSimpleGreen,
  logWarning,
} from "../utils/log";
import { selectNetworkConfig } from "../utils/config";
import { runSuiScript } from "../utils/process";

type StartLocalnetCliArgs = {
  checkOnly: boolean;
  waitSeconds: number;
  withFaucet: boolean;
};

type RpcSnapshot = {
  rpcUrl: string;
  epoch: string;
  protocolVersion: string;
  latestCheckpoint: string;
  validatorCount: number;
  referenceGasPrice: bigint;
  epochStartTimestampMs?: string | number | null;
};

type ProbeResult =
  | { status: "running"; snapshot: RpcSnapshot }
  | { status: "offline"; error: string };

runSuiScript(async (config) => {
  const cliArgs = await parseStartLocalnetCliArgs();
  const { networkConfig } = selectNetworkConfig(config, "localnet");
  const rpcUrl = networkConfig.url ?? getFullnodeUrl("localnet");

  const probeResult = await probeRpcHealth(rpcUrl);

  if (probeResult.status === "running") {
    logSimpleGreen("Localnet running 🚀");
    logRpcSnapshot(probeResult.snapshot, cliArgs.withFaucet);
    return;
  }

  if (cliArgs.checkOnly)
    throw new Error(
      `Localnet RPC unavailable at ${rpcUrl}: ${probeResult.error}`
    );

  const localnetProcess = startLocalnetProcess({
    withFaucet: cliArgs.withFaucet,
  });

  const readySnapshot = await waitForRpcReadiness({
    rpcUrl,
    waitSeconds: cliArgs.waitSeconds,
  });

  logRpcSnapshot(readySnapshot, cliArgs.withFaucet);

  await logProcessExit(localnetProcess);
});

const parseStartLocalnetCliArgs = async (): Promise<StartLocalnetCliArgs> =>
  await yargs(hideBin(process.argv))
    .scriptName("start-localnet")
    .option("check-only", {
      type: "boolean",
      description: "Only validate the RPC without starting a new localnet",
      default: false,
    })
    .option("wait-seconds", {
      type: "number",
      description: "How long to wait for RPC readiness after starting",
      default: 25,
    })
    .option("with-faucet", {
      type: "boolean",
      description: "Start the faucet alongside the local node",
      default: true,
    })
    .strict()
    .help()
    .parseAsync();

const probeRpcHealth = async (rpcUrl: string): Promise<ProbeResult> => {
  try {
    return { status: "running", snapshot: await fetchRpcSnapshot(rpcUrl) };
  } catch (error) {
    return {
      status: "offline",
      error:
        error instanceof Error ? error.message : "Unable to reach localnet RPC",
    };
  }
};

const fetchRpcSnapshot = async (rpcUrl: string): Promise<RpcSnapshot> => {
  const client = buildSuiClient(rpcUrl);

  const [systemState, latestCheckpoint, referenceGasPrice] = await Promise.all([
    client.getLatestSuiSystemState(),
    client.getLatestCheckpointSequenceNumber(),
    client.getReferenceGasPrice(),
  ]);

  return {
    rpcUrl,
    epoch: systemState.epoch,
    protocolVersion: String(systemState.protocolVersion),
    latestCheckpoint,
    validatorCount: systemState.activeValidators?.length ?? 0,
    referenceGasPrice,
    epochStartTimestampMs: systemState.epochStartTimestampMs,
  };
};

const waitForRpcReadiness = async ({
  rpcUrl,
  waitSeconds,
}: {
  rpcUrl: string;
  waitSeconds: number;
}): Promise<RpcSnapshot> => {
  const deadline = Date.now() + waitSeconds * 1000;

  while (Date.now() <= deadline) {
    const probe = await probeRpcHealth(rpcUrl);

    if (probe.status === "running") {
      logKeyValueGreen("Localnet")("Ready");
      return probe.snapshot;
    }

    logKeyValueYellow("Waiting")(
      `for RPC at ${rpcUrl} (timeout ${waitSeconds}s)`
    );

    await delay(1_000);
  }

  throw new Error(
    `Localnet RPC did not become reachable within ${waitSeconds}s at ${rpcUrl}`
  );
};

const startLocalnetProcess = ({
  withFaucet,
}: {
  withFaucet: boolean;
}): ChildProcess => {
  const args = buildStartArguments(withFaucet);
  const processHandle = spawn("sui", args, {
    stdio: "inherit",
  });

  processHandle.once("error", (error) => {
    logWarning(
      `Failed to start localnet via "sui ${args.join(" ")}": ${error.message}`
    );
  });

  logKeyValueYellow("Starting")(
    `sui ${buildStartArguments(withFaucet).join(" ")}`
  );

  return processHandle;
};

const buildStartArguments = (withFaucet: boolean) => {
  const args = ["start"];
  if (withFaucet) args.push("--with-faucet");
  return args;
};

const logRpcSnapshot = (snapshot: RpcSnapshot, withFaucet: boolean) => {
  logKeyValueBlue("RPC")(snapshot.rpcUrl);
  logKeyValueBlue("Epoch")(snapshot.epoch);
  logKeyValueBlue("Checkpoint")(snapshot.latestCheckpoint);
  logKeyValueBlue("Protocol")(snapshot.protocolVersion);
  logKeyValueBlue("Validators")(snapshot.validatorCount);
  logKeyValueBlue("Gas price")(formatGasPrice(snapshot.referenceGasPrice));
  if (withFaucet) logKeyValueBlue("Faucet")(deriveFaucetUrl(snapshot.rpcUrl));
  if (snapshot.epochStartTimestampMs)
    logKeyValueBlue("Epoch start")(
      formatTimestamp(Number(snapshot.epochStartTimestampMs))
    );
};

const logProcessExit = async (processHandle: ChildProcess) => {
  const [code, signal] = (await once(processHandle, "exit")) as [
    number | null,
    NodeJS.Signals | null
  ];
  const description =
    code !== null
      ? `exited with code ${code}`
      : `terminated via signal ${signal}`;
  logKeyValueYellow("Localnet")(description);
};

const buildSuiClient = (rpcUrl: string) => new SuiClient({ url: rpcUrl });

const deriveFaucetUrl = (rpcUrl: string) => {
  try {
    const faucetHost = getFaucetHost("localnet");
    const faucetUrl = new URL(faucetHost);
    const rpcHost = new URL(rpcUrl);
    faucetUrl.hostname = rpcHost.hostname;
    faucetUrl.pathname = "/v2/gas";
    return faucetUrl.toString();
  } catch {
    return "http://127.0.0.1:9123/v2/gas";
  }
};

const formatGasPrice = (referenceGasPrice: bigint) => {
  const mist = referenceGasPrice.toString();
  return `${mist} MIST (${formatSui(referenceGasPrice)} SUI)`;
};

const formatSui = (mist: bigint) => {
  const whole = mist / 1_000_000_000n;
  const fractional = mist % 1_000_000_000n;
  const fractionalStr = fractional
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fractionalStr ? `${whole}.${fractionalStr}` : whole.toString();
};

const formatTimestamp = (timestampMs: number) =>
  new Date(timestampMs).toISOString();
