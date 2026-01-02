"use client"

import type { ShopCreatedSummary } from "@sui-oracle-market/domain-core/models/shop"
import { formatTimestamp, shortenId } from "../helpers/format"
import useExplorerUrl from "../hooks/useExplorerUrl"
import Button from "./Button"
import CopyableId from "./CopyableId"

const SelectedShopHeader = ({
  shopId,
  shop,
  onChangeShop
}: {
  shopId: string
  shop?: ShopCreatedSummary
  onChangeShop: () => void
}) => {
  const title = shop?.name ? shop.name : `Shop ${shortenId(shopId)}`
  const ownerAddress = shop?.ownerAddress
  const createdAtMs = shop?.createdAtMs
  const explorerUrl = useExplorerUrl()

  return (
    <section className="w-full max-w-6xl px-4">
      <div className="rounded-2xl border border-slate-300/80 bg-white/90 px-6 py-4 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md transition dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Active shop
            </div>
            <div className="text-base font-semibold text-sds-dark dark:text-sds-light">
              {title}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-200/70">
              <CopyableId
                value={shopId}
                label="Shop ID"
                explorerUrl={explorerUrl}
              />
              {ownerAddress ? (
                <CopyableId
                  value={ownerAddress}
                  label="Owner"
                  showExplorer={false}
                />
              ) : (
                <span>Owner address unavailable</span>
              )}
              {createdAtMs ? (
                <span>Created {formatTimestamp(createdAtMs)}</span>
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex items-center">
            <Button variant="secondary" size="compact" onClick={onChangeShop}>
              Change shop
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default SelectedShopHeader
