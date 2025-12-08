import { SuiClient } from "@mysten/sui/client";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";

export const getSuiBalance = async (address: string, client: SuiClient) => {
  const balance = await client.getBalance({
    owner: address,
    coinType: "0x2::sui::SUI",
  });
  return BigInt(balance.totalBalance ?? 0n);
};

export const asMinimumBalanceOf = async (
  {
    address,
    minimumBalance,
  }: {
    address: string;
    minimumBalance: bigint;
  },
  client: SuiClient
) => {
  const currentBalance = await getSuiBalance(address, client);

  return currentBalance >= minimumBalance;
};

/**
 * Ensures the signer has spendable SUI; auto-faucets on localnet/devnet/testnet if empty.
 */
export const ensureFoundedAddress = async (
  {
    network = "localnet",
    signerAddress,
  }: {
    network?: "localnet" | "devnet" | "testnet";
    signerAddress: string;
  },
  client: SuiClient
) => {
  if (
    await asMinimumBalanceOf(
      {
        address: signerAddress,
        minimumBalance: 1_000_000n,
      },
      client
    )
  )
    return;

  if (!["localnet", "devnet", "testnet"].includes(network))
    throw new Error(`faucet is unavailable for network ${network}`);

  const faucetHost = getFaucetHost(network);

  await requestSuiFromFaucetV2({
    host: faucetHost,
    recipient: signerAddress,
  });
};
