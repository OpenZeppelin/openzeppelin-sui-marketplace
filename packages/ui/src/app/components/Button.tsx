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
}

const Button = ({
  variant = "primary",
  size = "default",
  type = "button",
  className,
  disabled,
  ...props
}: ButtonProps) => (
  <button
    type={type}
    disabled={disabled}
    className={clsx(
      buttonVariantClassNameMap[variant][size],
      disabled ? "cursor-not-allowed opacity-50" : "",
      className
    )}
    {...props}
  />
)

export default Button
