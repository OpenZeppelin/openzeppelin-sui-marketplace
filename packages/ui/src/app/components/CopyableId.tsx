"use client"

import clsx from "clsx"
import { CopyIcon, ExternalLinkIcon } from "lucide-react"
import type { MouseEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import { copyToClipboard } from "../helpers/clipboard"
import { shortenId } from "../helpers/format"
import { isLocalExplorerUrl, objectUrl } from "../helpers/network"
import {
  ModalBody,
  ModalFrame,
  ModalHeader,
  ModalSection
} from "./ModalPrimitives"

const CopyableId = ({
  value,
  label,
  className,
  displayValue,
  title,
  valueClassName,
  explorerUrl,
  showExplorer = true
}: {
  value: string
  label?: string
  className?: string
  displayValue?: string
  title?: string
  valueClassName?: string
  explorerUrl?: string
  showExplorer?: boolean
}) => {
  const [isHydrated, setIsHydrated] = useState(false)

  const resolvedDisplayValue = isHydrated
    ? (displayValue ?? shortenId(value))
    : "..."
  const localnetCommand = useMemo(
    () => `pnpm script chain:describe-object --object-id ${value}`,
    [value]
  )
  const [isLocalnetModalOpen, setLocalnetModalOpen] = useState(false)
  const canOpenExplorer = Boolean(isHydrated && showExplorer && explorerUrl)
  const isLocalExplorer =
    isHydrated && explorerUrl ? isLocalExplorerUrl(explorerUrl) : false

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!isHydrated) return
    copyToClipboard(value)
  }

  const handleOpenExplorer = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!isHydrated) return
    if (!explorerUrl) return

    if (isLocalExplorer) {
      setLocalnetModalOpen(true)
      return
    }

    const explorerLink = objectUrl(explorerUrl, value)
    window.open(explorerLink, "_blank", "noopener,noreferrer")
  }

  return (
    <div
      className={clsx(
        "inline-flex w-full min-w-0 items-center gap-2",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {label ? (
          <span className="uppercase tracking-[0.12em]">{label}</span>
        ) : undefined}
        <span
          className={clsx(
            "min-w-0 truncate font-medium text-slate-700 dark:text-slate-100",
            valueClassName
          )}
          title={isHydrated ? value : undefined}
        >
          {resolvedDisplayValue}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleCopy}
          title={isHydrated ? (title ?? "Copy object id") : "Loading object id"}
          aria-label={
            isHydrated ? (title ?? "Copy object id") : "Loading object id"
          }
          disabled={!isHydrated}
          className="focus-visible:ring-sds-blue/40 inline-flex h-4 w-4 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-50"
        >
          <CopyIcon className="h-3 w-3" />
        </button>
        {canOpenExplorer ? (
          <button
            type="button"
            onClick={handleOpenExplorer}
            title={
              isLocalExplorer
                ? "Show localnetwork object inspection steps"
                : "View object on explorer"
            }
            aria-label={
              isLocalExplorer
                ? "Show localnetwork object inspection steps"
                : "View object on explorer"
            }
            className="focus-visible:ring-sds-blue/40 inline-flex h-4 w-4 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-50"
          >
            <ExternalLinkIcon className="h-3 w-3" />
          </button>
        ) : undefined}
      </div>
      {isLocalExplorer && isLocalnetModalOpen ? (
        <ModalFrame
          onClose={() => setLocalnetModalOpen(false)}
          contentClassName="max-w-lg"
        >
          <ModalHeader
            eyebrow="Scan explorer not available on localnet"
            title="Inspect object locally instead"
            description=""
            onClose={() => setLocalnetModalOpen(false)}
          />
          <ModalBody>
            <ModalSection
              title="Command"
              subtitle="Click the command and paste it on your terminal at the root of your project."
            >
              <button
                type="button"
                className="w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-3 text-left text-[0.7rem] font-semibold text-slate-700 shadow-[0_10px_25px_-20px_rgba(15,23,42,0.35)] transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-50/20 dark:bg-slate-950/70 dark:text-slate-100 dark:hover:text-white"
                onClick={() => copyToClipboard(localnetCommand)}
              >
                <code className="block whitespace-pre-wrap break-all">
                  {localnetCommand}
                </code>
              </button>
            </ModalSection>
          </ModalBody>
        </ModalFrame>
      ) : undefined}
    </div>
  )
}

export default CopyableId
