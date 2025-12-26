"use client"

import clsx from "clsx"

import { copyToClipboard } from "../helpers/clipboard"
import { shortenId } from "../helpers/format"
import Button from "./Button"

const CopyableId = ({
  value,
  label,
  className,
  displayValue,
  title,
  valueClassName
}: {
  value: string
  label?: string
  className?: string
  displayValue?: string
  title?: string
  valueClassName?: string
}) => (
  <Button
    variant="text"
    onClick={() => copyToClipboard(value)}
    title={title ?? "Copy object id"}
    className={clsx("min-w-0 justify-start", className)}
  >
    {label ? (
      <span className="uppercase tracking-[0.12em]">{label}</span>
    ) : null}
    <span
      className={clsx(
        "font-medium text-slate-700 dark:text-slate-100",
        valueClassName
      )}
    >
      {displayValue ?? shortenId(value)}
    </span>
  </Button>
)

export default CopyableId
