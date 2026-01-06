/**
 * Prints coin balances for an address, including object counts per coin type.
 * On Sui, a "balance" is the sum of many Coin objects.
 * Helpful for spotting fragmentation before building a PTB.
 */
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

    const balances = await tooling.getCoinBalances({
      address: addressToInspect
    })
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

const formatBigInt = (value: bigint) => value.toString()
