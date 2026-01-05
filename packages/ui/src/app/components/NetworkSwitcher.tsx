"use client"

import type { ChangeEvent } from "react"
import { headerControlSelectClassName } from "./controlStyles"
import type { TNetworkOption } from "../types/TNetworkOption"

const NetworkSwitcher = ({
  value,
  options,
  onChange
}: {
  value?: string
  options: TNetworkOption[]
  onChange: (nextNetwork: string) => void
}) => {
  if (options.length === 0) return <></>

  const handleNetworkChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextNetwork = event.target.value
    if (!nextNetwork || nextNetwork === value) return
    onChange(nextNetwork)
  }

  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/70">
      <select
        value={value ?? ""}
        onChange={handleNetworkChange}
        className={headerControlSelectClassName}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default NetworkSwitcher
