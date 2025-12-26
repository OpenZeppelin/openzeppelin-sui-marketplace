"use client"

import type { SuiTransactionBlockResponse } from "@mysten/sui/client"

import {
  formatTimestamp,
  summarizeObjectChanges
} from "../helpers/transactionFormat"
import CopyableId from "./CopyableId"
import { ModalSection } from "./ModalPrimitives"

const TransactionRecap = ({
  transactionBlock,
  digest,
  explorerUrl
}: {
  transactionBlock: SuiTransactionBlockResponse
  digest: string
  explorerUrl?: string
}) => {
  const status = transactionBlock.effects?.status?.status ?? "unknown"
  const error = transactionBlock.effects?.status?.error
  const objectChanges = transactionBlock.objectChanges ?? []
  const objectChangeSummary = summarizeObjectChanges(objectChanges)

  const explorerLink =
    explorerUrl && digest ? `${explorerUrl}/txblock/${digest}` : undefined

  return (
    <ModalSection
      title="Transaction recap"
      subtitle="On-chain confirmation details"
    >
      <div className="space-y-4 text-xs text-slate-600 dark:text-slate-200/70">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Status
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {status}
            </div>
            {error ? (
              <div className="mt-2 text-xs text-rose-500">{error}</div>
            ) : null}
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Timestamp
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {formatTimestamp(transactionBlock.timestampMs)}
            </div>
            {transactionBlock.checkpoint ? (
              <div className="mt-1 text-[0.65rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                Checkpoint {transactionBlock.checkpoint}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Digest
          </span>
          <CopyableId value={digest} />
          {explorerLink ? (
            <a
              href={explorerLink}
              target="_blank"
              rel="noreferrer"
              className="dark:text-sds-blue/80 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-sds-blue hover:text-sds-dark dark:hover:text-sds-light"
            >
              View on explorer
            </a>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Object changes
          </div>
          <div className="mt-2 text-sm font-semibold text-sds-dark dark:text-sds-light">
            {objectChanges.length} total changes
          </div>
          {objectChanges.length > 0 ? (
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              {objectChangeSummary
                .filter((item) => item.count > 0)
                .map((item) => {
                  const typeLabels = item.types
                    .slice(0, 3)
                    .map((type) =>
                      type.count > 1
                        ? `${type.label} x${type.count}`
                        : type.label
                    )
                    .join(", ")

                  return (
                    <div key={item.label}>
                      <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                        {item.label}
                      </div>
                      <div>{item.count}</div>
                      {typeLabels ? (
                        <div className="mt-1 text-[0.6rem] text-slate-500 dark:text-slate-200/60">
                          {typeLabels}
                          {item.types.length > 3
                            ? ` +${item.types.length - 3} more`
                            : ""}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-200/60">
              No object changes detected.
            </div>
          )}
        </div>
      </div>
    </ModalSection>
  )
}

export default TransactionRecap
