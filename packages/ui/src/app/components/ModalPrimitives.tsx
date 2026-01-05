"use client"

import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { copyToClipboard } from "../helpers/clipboard"
import Button from "./Button"

export const modalFieldLabelClassName =
  "flex flex-col text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60"

export const modalFieldTitleClassName = "min-h-[1rem] leading-snug"

export const modalFieldDescriptionClassName =
  "mt-1 min-h-[2rem] text-[0.65rem] font-normal leading-snug normal-case tracking-normal text-slate-500/80 dark:text-slate-200/70"

export const modalFieldInputClassName =
  "focus-visible:ring-sds-blue/40 mt-1.5 h-10 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 text-sm text-sds-dark shadow-[0_10px_25px_-20px_rgba(15,23,42,0.35)] focus-visible:outline-none focus-visible:ring-2 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-sds-light"

export const modalFieldInputErrorClassName =
  "border-rose-300/80 focus-visible:ring-rose-300 dark:border-rose-500/40 dark:focus-visible:ring-rose-400/60"

export const modalFieldErrorTextClassName =
  "mt-2 text-[0.65rem] font-medium normal-case tracking-normal text-rose-600 dark:text-rose-200"

export const modalFieldWarningTextClassName =
  "mt-2 text-[0.65rem] font-medium normal-case tracking-normal text-amber-600 dark:text-amber-200"

export const ModalFrame = ({
  children,
  onClose,
  contentClassName
}: {
  children: ReactNode
  onClose: () => void
  contentClassName?: string
}) => {
  if (typeof document === "undefined") return <></>
  const containerClassName = [
    "relative z-10 w-full overflow-hidden rounded-3xl border border-slate-300/70 bg-white/95 shadow-[0_35px_80px_-55px_rgba(15,23,42,0.55)] dark:border-slate-50/20 dark:bg-slate-950/90",
    contentClassName ?? "max-w-4xl"
  ]
    .filter(Boolean)
    .join(" ")

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-10 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className={containerClassName}>{children}</div>
    </div>,
    document.body
  )
}

export const ModalBody = ({ children }: { children: ReactNode }) => (
  <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
    {children}
  </div>
)

export const ModalHeader = ({
  eyebrow,
  title,
  description,
  descriptionClassName,
  onClose,
  footer
}: {
  eyebrow: string
  title: string
  description?: ReactNode
  descriptionClassName?: string
  onClose: () => void
  footer?: ReactNode
}) => {
  const descriptionClasses = [
    "mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60",
    descriptionClassName
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className="relative overflow-hidden border-b border-slate-200/70 px-6 py-5 dark:border-slate-50/15">
      <div className="from-sds-blue/10 to-sds-pink/15 dark:from-sds-blue/20 dark:to-sds-pink/10 absolute inset-0 bg-gradient-to-br via-white/80 opacity-80 dark:via-slate-950/40" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-200/60">
            {eyebrow}
          </div>
          <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
            {title}
          </div>
          {description ? (
            <div className={descriptionClasses}>{description}</div>
          ) : undefined}
        </div>
        <Button variant="secondary" size="compact" onClick={onClose}>
          Close
        </Button>
      </div>
      {footer ? <div className="relative mt-4">{footer}</div> : undefined}
    </div>
  )
}

const statusStyles = {
  success: {
    border: "border-emerald-400/90 dark:border-emerald-400/50",
    gradient:
      "bg-gradient-to-br from-emerald-300/95 via-white/80 to-emerald-200/90 opacity-95 dark:from-emerald-500/45 dark:via-slate-950/35 dark:to-emerald-400/30",
    eyebrow: "text-emerald-800 dark:text-emerald-100",
    description: "text-emerald-900 dark:text-emerald-100"
  },
  error: {
    border: "border-rose-300/80 dark:border-rose-400/40",
    gradient:
      "bg-gradient-to-br from-rose-200/95 via-white/80 to-rose-100/90 opacity-95 dark:from-rose-500/40 dark:via-slate-950/35 dark:to-rose-400/25",
    eyebrow: "text-rose-800 dark:text-rose-100",
    description: "text-rose-900 dark:text-rose-100"
  }
} as const

export const ModalStatusHeader = ({
  status,
  title,
  subtitle,
  description,
  onClose
}: {
  status: keyof typeof statusStyles
  title: string
  subtitle: string
  description: string
  onClose: () => void
}) => {
  const styles = statusStyles[status]
  const label = status === "success" ? "Success" : "Error"

  return (
    <div
      className={`relative overflow-hidden border-b px-6 py-5 ${styles.border}`}
    >
      <div className={`absolute inset-0 ${styles.gradient}`} />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div
            className={`text-[0.6rem] font-semibold uppercase tracking-[0.3em] ${styles.eyebrow}`}
          >
            {label}
          </div>
          <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
            {title}
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            {subtitle}
          </div>
          <div
            className={`mt-2 text-[0.7rem] font-semibold ${styles.description}`}
          >
            {description}
          </div>
        </div>
        <Button variant="secondary" size="compact" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}

export const ModalErrorNotice = ({
  error,
  details
}: {
  error: string
  details?: string
}) => (
  <div className="relative overflow-hidden rounded-2xl border border-rose-200/80 bg-rose-50/70 px-4 py-4 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
    <div className="absolute inset-0 bg-gradient-to-br from-rose-100/90 via-white/85 to-rose-50/80 opacity-90 dark:from-rose-500/30 dark:via-slate-950/45 dark:to-rose-400/20" />
    <div className="relative">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-rose-700/95 dark:text-rose-200/90">
        Error
      </div>
      <div className="mt-2 text-sm font-semibold text-rose-800 dark:text-rose-100">
        Transaction failed
      </div>
      <div className="mt-2 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
        {error}
      </div>
      {details ? (
        <details className="mt-3 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
          <summary className="cursor-pointer font-semibold">
            Raw error JSON
          </summary>
          <pre className="mb-4 mt-2 max-h-40 overflow-auto rounded-lg border border-rose-200/60 bg-white/80 p-2 text-[0.65rem] text-rose-700 dark:border-rose-500/30 dark:bg-slate-950/60 dark:text-rose-200">
            {details}
          </pre>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => copyToClipboard(details.replace(/"/g, '\\"'))}
          >
            Copy string error
          </Button>
        </details>
      ) : undefined}
    </div>
  </div>
)

export const ModalSuccessFooter = ({
  actionLabel,
  onAction,
  onClose
}: {
  actionLabel: string
  onAction: () => void
  onClose: () => void
}) => (
  <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-100">
        On-chain confirmation complete.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onAction}>{actionLabel}</Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  </div>
)

export const ModalCloseFooter = ({
  message = "On-chain confirmation complete.",
  onClose
}: {
  message?: string
  onClose: () => void
}) => (
  <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-100">
        {message}
      </div>
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </div>
  </div>
)

export const ModalErrorFooter = ({
  onRetry,
  onClose
}: {
  onRetry: () => void
  onClose: () => void
}) => (
  <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs uppercase tracking-[0.18em] text-rose-800 dark:text-rose-100">
        Resolve the issue and retry when ready.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onRetry}>Try again</Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  </div>
)

export const ModalSection = ({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) => (
  <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
    <div className="mb-4 flex flex-col gap-1">
      <h4 className="text-sm font-semibold text-sds-dark dark:text-sds-light">
        {title}
      </h4>
      {subtitle ? (
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          {subtitle}
        </p>
      ) : undefined}
    </div>
    {children}
  </section>
)
