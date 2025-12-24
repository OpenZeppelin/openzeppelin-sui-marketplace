"use client"

import clsx from "clsx"

import { shortenId } from "../helpers/format"

const copyToClipboard = async (value: string) => {
  if (!value) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // Fall through to legacy copy path.
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand("copy")
  } finally {
    document.body.removeChild(textarea)
  }
}

const CopyableId = ({
  value,
  label,
  className
}: {
  value: string
  label?: string
  className?: string
}) => (
  <button
    type="button"
    onClick={() => copyToClipboard(value)}
    title="Copy object id"
    className={clsx(
      "focus-visible:ring-sds-blue/40 inline-flex items-center gap-2 text-xs text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 dark:text-slate-200/60 dark:hover:text-slate-100",
      className
    )}
  >
    {label ? (
      <span className="uppercase tracking-[0.12em]">{label}</span>
    ) : null}
    <span className="font-medium text-slate-700 dark:text-slate-100">
      {shortenId(value)}
    </span>
  </button>
)

export default CopyableId
