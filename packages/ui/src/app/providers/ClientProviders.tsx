"use client"

import "@mysten/dapp-kit/dist/index.css"
import "@radix-ui/themes/styles.css"
import "@suiware/kit/main.css"
import SuiProvider from "@suiware/kit/SuiProvider"
import { ThemeProvider as NextThemeProvider } from "next-themes"
import { Suspense, type ReactNode } from "react"
import useNetworkConfig from "~~/hooks/useNetworkConfig"
import { APP_NAME } from "../config/main"
import { getThemeSettings } from "../helpers/theme"
import useHostNetworkPolicy from "../hooks/useHostNetworkPolicy"
import NetworkUrlSync from "./NetworkUrlSync"
import ThemeProvider from "./ThemeProvider"
import WalletAccountGuard from "./WalletAccountGuard"

const themeSettings = getThemeSettings()

export default function ClientProviders({ children }: { children: ReactNode }) {
  const { networkConfig } = useNetworkConfig()
  const { defaultNetwork } = useHostNetworkPolicy()

  return (
    <NextThemeProvider attribute="class">
      <ThemeProvider>
        <SuiProvider
          customNetworkConfig={networkConfig}
          defaultNetwork={defaultNetwork}
          walletAutoConnect={true}
          walletStashedName={APP_NAME}
          themeSettings={themeSettings}
        >
          <Suspense fallback={null}>
            <NetworkUrlSync />
          </Suspense>
          <WalletAccountGuard />
          {children}
        </SuiProvider>
      </ThemeProvider>
    </NextThemeProvider>
  )
}
