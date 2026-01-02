"use client"

import clsx from "clsx"
import { CopyIcon, ExternalLinkIcon } from "lucide-react"
import type { MouseEvent } from "react"
import { useMemo, useState } from "react"
import { copyToClipboard } from "../helpers/clipboard"
import { shortenId } from "../helpers/format"
import { isLocalExplorerUrl, objectUrl } from "../helpers/network"
import Button from "./Button"
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
  const resolvedDisplayValue = displayValue ?? shortenId(value)
  const localnetCommand = useMemo(
    () => `pnpm script chain:describe-object --object-id ${value}`,
    [value]
  )
  const [isLocalnetModalOpen, setLocalnetModalOpen] = useState(false)
  const isLocalExplorer = explorerUrl
    ? isLocalExplorerUrl(explorerUrl)
    : false
  const canOpenExplorer = Boolean(showExplorer && explorerUrl)

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    copyToClipboard(value)
  }

  const handleOpenExplorer = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
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
      className={clsx("inline-flex min-w-0 items-center gap-2 w-full", className)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {label ? (
          <span className="uppercase tracking-[0.12em]">{label}</span>
        ) : null}
        <span
          className={clsx(
            "min-w-0 truncate font-medium text-slate-700 dark:text-slate-100",
            valueClassName
          )}
          title={value}
        >
          {resolvedDisplayValue}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0">
        <Button
          variant="ghost"
          size="compact"
          className="h-6 w-6 justify-center px-0 text-slate-400/70 hover:text-slate-600 dark:text-slate-200/40 dark:hover:text-slate-100"
          onClick={handleCopy}
          title={title ?? "Copy object id"}
          aria-label={title ?? "Copy object id"}
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </Button>
        {canOpenExplorer ? (
          <Button
            variant="ghost"
            size="compact"
            className="-ml-1 h-6 w-6 justify-center px-0 text-slate-400/70 hover:text-slate-600 dark:text-slate-200/40 dark:hover:text-slate-100"
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
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </Button>
        ) : null}
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
      ) : null}
    </div>
  )
}

export default CopyableId
