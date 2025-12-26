"use client"

import { ConnectButton } from "@mysten/dapp-kit"
import { Link } from "@radix-ui/themes"
import Balance from "@suiware/kit/Balance"
import Image from "next/image"
import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"
import Logo from "../../assets/logo.svg"
import { APP_NAME } from "../../config/main"
import WalletNetworkLabel from "../WalletNetworkLabel"

const Header = () => {
  const buttonRef = useRef<HTMLDivElement | null>(null)
  const [buttonWidth, setButtonWidth] = useState<number | null>(null)
  const [buttonHeight, setButtonHeight] = useState<number | null>(null)

  useEffect(() => {
    const element = buttonRef.current
    if (!element) return

    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      const nextWidth = Math.round(rect.width)
      const nextHeight = Math.round(rect.height)
      setButtonWidth((prev) => (prev === nextWidth ? prev : nextWidth))
      setButtonHeight((prev) => (prev === nextHeight ? prev : nextHeight))
    }

    updateSize()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize)
      return () => window.removeEventListener("resize", updateSize)
    }

    const observer = new ResizeObserver(() => updateSize())
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const indicatorStyle =
    buttonWidth || buttonHeight
      ? ({
          ...(buttonWidth
            ? { "--wallet-button-width": `${buttonWidth}px` }
            : {}),
          ...(buttonHeight
            ? { "--wallet-button-height": `${buttonHeight}px` }
            : {})
        } as CSSProperties)
      : undefined

  return (
    <header className="supports-backdrop-blur:bg-white/60 dark:border-slate-50/1 sticky top-0 z-40 flex w-full flex-row flex-wrap items-center justify-center gap-4 bg-white/95 px-3 py-3 backdrop-blur transition-colors duration-500 sm:justify-between sm:gap-3 lg:z-50 lg:border-b lg:border-slate-900/10 dark:bg-transparent">
      <Link
        href="#"
        className="flex flex-col items-center justify-center gap-1 text-sds-dark outline-none hover:no-underline sm:flex-row dark:text-sds-light"
      >
        <Image
          width={40}
          height={40}
          src={Logo}
          alt="Logo"
          className="h-12 w-12"
        />
        <div className="pt-1 text-xl sm:text-2xl">{APP_NAME}</div>
      </Link>

      <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
        <div
          className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-end"
          style={indicatorStyle}
        >
          <div className="sds-balance-wrapper sds-match-wallet-height flex justify-center">
            <Balance />
          </div>
          <WalletNetworkLabel />
        </div>

        {/* @todo: Find a better way to style ConnectButton for example through className, which is currently not supported. */}
        {/* className="[&>button]:!px-4 [&>button]:!py-2 [&>div]:!text-base" */}
        <div className="sds-connect-button-container" ref={buttonRef}>
          <ConnectButton />
        </div>
      </div>
    </header>
  )
}
export default Header
