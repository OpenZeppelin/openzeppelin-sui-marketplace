import type { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { resolveOwnerAddress } from "@sui-oracle-market/tooling-node/account"
import {
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type CoinBalancesCliArgs = {
  address?: string
}

type CoinBalanceSummary = {
  coinType: string
  coinObjectCount: number
  totalBalance: bigint
  lockedBalanceTotal: bigint
}

runSuiScript<CoinBalancesCliArgs>(
  async (tooling, cliArguments) => {
    const addressToInspect = await resolveOwnerAddress(
      cliArguments.address,
      tooling.network
    )

    logInspectionContext({
      address: addressToInspect,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const balances = await getCoinBalances(addressToInspect, tooling.suiClient)
    logCoinBalances(balances)
  },
  yargs()
    .option("address", {
      type: "string",
      description:
        "Address to inspect. Defaults to the configured account when omitted.",
      demandOption: false
    })
    .strict()
)

const getCoinBalances = async (
  address: string,
  suiClient: SuiClient
): Promise<CoinBalanceSummary[]> => {
  const balances = await suiClient.getAllBalances({ owner: address })

  return balances.map((balance) => ({
    coinType: balance.coinType,
    coinObjectCount: balance.coinObjectCount,
    totalBalance: BigInt(balance.totalBalance),
    lockedBalanceTotal: sumLockedBalance(balance.lockedBalance)
  }))
}

const logCoinBalances = (balances: CoinBalanceSummary[]) => {
  const sortedBalances = [...balances].sort((left, right) =>
    left.coinType.localeCompare(right.coinType)
  )

  logKeyValueGreen("Coin types")(sortedBalances.length)
  console.log("")

  if (sortedBalances.length === 0) {
    logKeyValueYellow("Coins")("No coin balances found for this address.")
    return
  }

  sortedBalances.forEach((balance) =>
    logEachGreen({
      coinType: balance.coinType,
      objects: balance.coinObjectCount,
      total: formatBigInt(balance.totalBalance),
      locked: formatBigInt(balance.lockedBalanceTotal),
      "": ""
    })
  )
}

const logInspectionContext = ({
  address,
  rpcUrl,
  networkName
}: {
  address: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Address")(address)
  console.log("")
}

const sumLockedBalance = (lockedBalance: Record<string, string>): bigint =>
  Object.values(lockedBalance).reduce(
    (total, lockedAmount) => total + BigInt(lockedAmount),
    0n
  )

const formatBigInt = (value: bigint) => value.toString()
