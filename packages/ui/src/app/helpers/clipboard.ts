export const copyToClipboard = async (value: string) => {
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
