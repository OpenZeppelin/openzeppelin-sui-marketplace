"use client"

import clsx from "clsx"
import type { ButtonHTMLAttributes } from "react"
import {
  dangerActionButtonClassName,
  dangerCompactActionButtonClassName,
  ghostActionButtonClassName,
  primaryActionButtonClassName,
  primaryCompactActionButtonClassName,
  secondaryActionButtonClassName,
  secondaryCompactActionButtonClassName,
  textActionButtonClassName
} from "./buttonStyles"

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "text"
type ButtonSize = "default" | "compact"

const buttonVariantClassNameMap: Record<
  ButtonVariant,
  Record<ButtonSize, string>
> = {
  primary: {
    default: primaryActionButtonClassName,
    compact: primaryCompactActionButtonClassName
  },
  secondary: {
    default: secondaryActionButtonClassName,
    compact: secondaryCompactActionButtonClassName
  },
  danger: {
    default: dangerActionButtonClassName,
    compact: dangerCompactActionButtonClassName
  },
  ghost: {
    default: ghostActionButtonClassName,
    compact: ghostActionButtonClassName
  },
  text: {
    default: textActionButtonClassName,
    compact: textActionButtonClassName
  }
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  tooltip?: string
}

const Button = ({
  variant = "primary",
  size = "default",
  type = "button",
  className,
  disabled,
  tooltip,
  title,
  children,
  ...props
}: ButtonProps) => {
  const button = (
    <button
      type={type}
      disabled={disabled}
      title={tooltip ? undefined : title}
      className={clsx(
        buttonVariantClassNameMap[variant][size],
        disabled ? "cursor-not-allowed opacity-50" : "",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )

  if (!tooltip) return button

  return (
    <span title={tooltip} className="inline-flex">
      {button}
    </span>
  )
}

export default Button
