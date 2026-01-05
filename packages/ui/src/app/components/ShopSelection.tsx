"use client"

import type { ShopCreatedSummary } from "@sui-oracle-market/domain-core/models/shop"
import { RefreshCwIcon } from "lucide-react"
import { formatTimestamp, shortenId } from "../helpers/format"
import useExplorerUrl from "../hooks/useExplorerUrl"
import type { ShopSelectionStatus } from "../hooks/useShopSelectionViewModel"
import Button from "./Button"
import CopyableId from "./CopyableId"
import Loading from "./Loading"
import {
  modalFieldInputClassName,
  modalFieldLabelClassName
} from "./ModalPrimitives"

const resolveShopTitle = (shop: ShopCreatedSummary) =>
  shop.name ? shop.name : `Shop ${shortenId(shop.shopId)}`

const ShopSelection = ({
  packageId,
  shops,
  totalShops,
  status,
  error,
  searchQuery,
  onSearchChange,
  onCreateShop,
  canCreateShop,
  onSelectShop,
  onRefresh
}: {
  packageId?: string
  shops: ShopCreatedSummary[]
  totalShops: number
  status: ShopSelectionStatus
  error?: string
  searchQuery: string
  onSearchChange: (nextQuery: string) => void
  onCreateShop: () => void
  canCreateShop: boolean
  onSelectShop: (shopId: string) => void
  onRefresh: () => void
}) => {
  const isLoading = status === "loading" || status === "idle"
  const hasQuery = searchQuery.trim().length > 0
  const explorerUrl = useExplorerUrl()

  return (
    <div className="w-full max-w-5xl space-y-6 px-4">
      <section className="rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md transition dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
              Choose a shop
            </h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              Select a shared Shop object for this package.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={onCreateShop} disabled={!canCreateShop}>
              Create shop
            </Button>
            <Button
              variant="secondary"
              size="compact"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Refresh shops"
              title="Refresh shops"
            >
              <RefreshCwIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              Contract package
            </span>
            {packageId ? (
              <CopyableId value={packageId} explorerUrl={explorerUrl} />
            ) : (
              <span className="text-xs uppercase tracking-[0.16em] text-rose-500">
                Missing package ID
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <label className={`w-full md:max-w-sm ${modalFieldLabelClassName}`}>
              <span>Search shops</span>
              <input
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                className={modalFieldInputClassName}
                placeholder="Search by shop ID, name or owner address"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              {hasQuery ? (
                <span>
                  Showing {shops.length} of {totalShops}
                </span>
              ) : (
                <span>{totalShops} total</span>
              )}
              {hasQuery ? (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => onSearchChange("")}
                >
                  Clear
                </Button>
              ) : undefined}
            </div>
          </div>

          {isLoading ? (
            <Loading />
          ) : status === "error" ? (
            <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
              {error || "Unable to load shops for this package."}
            </div>
          ) : totalShops === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300/60 p-4 text-sm text-slate-500 dark:border-slate-100/20 dark:text-slate-200/70">
              No shops have been created for this package yet.
            </div>
          ) : shops.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300/60 p-4 text-sm text-slate-500 dark:border-slate-100/20 dark:text-slate-200/70">
              No shops match the current search.
            </div>
          ) : (
            <div className="grid gap-4">
              {shops.map((shop) => (
                <div
                  key={shop.shopId}
                  className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-sds-dark dark:text-sds-light">
                        {resolveShopTitle(shop)}
                      </div>
                      <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-200/70">
                        <CopyableId
                          value={shop.shopId}
                          label="Shop ID"
                          explorerUrl={explorerUrl}
                        />
                        {shop.ownerAddress ? (
                          <CopyableId
                            value={shop.ownerAddress}
                            label="Owner"
                            showExplorer={false}
                          />
                        ) : (
                          <span>Owner address unavailable</span>
                        )}
                      </div>
                      {shop.createdAtMs ? (
                        <div className="text-xs uppercase tracking-[0.12em] text-slate-400 dark:text-slate-200/50">
                          Created {formatTimestamp(shop.createdAtMs)}
                        </div>
                      ) : undefined}
                    </div>
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() => onSelectShop(shop.shopId)}
                    >
                      Open dashboard
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default ShopSelection
