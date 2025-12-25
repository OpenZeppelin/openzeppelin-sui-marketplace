"use client"

import type { ReactNode } from "react"

export const modalCloseButtonClassName =
  "rounded-full border border-slate-300/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-400 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sds-blue/40 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-slate-200/70 dark:hover:text-slate-100"

export const secondaryActionButtonClassName =
  "rounded-full border border-slate-300/70 bg-white/80 px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-400 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sds-blue/40 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-slate-200/70"

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
      ) : null}
    </div>
    {children}
  </section>
)
