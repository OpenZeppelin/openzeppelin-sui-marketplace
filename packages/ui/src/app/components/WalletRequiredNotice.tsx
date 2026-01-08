"use client"

const WalletRequiredNotice = ({
  message = "Connect a wallet to continue.",
  className
}: {
  message?: string
  className?: string
}) => {
  const classes = [
    "rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
    className
  ]
    .filter(Boolean)
    .join(" ")

  return <div className={classes}>{message}</div>
}

export default WalletRequiredNotice
