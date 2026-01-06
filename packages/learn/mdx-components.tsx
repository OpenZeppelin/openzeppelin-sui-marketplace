import type { ComponentProps } from "react"
import { useMDXComponents as useNextraMDXComponents } from "nextra-theme-docs"

const normalizeDocHref = (href?: string) => {
  if (!href) return href
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("#")
  )
    return href

  const match = href.match(/^(.*?)([?#].*)?$/)
  if (!match) return href

  let path = match[1]
  const suffix = match[2] ?? ""

  if (path === "." || path === "./") return `/docs${suffix}`

  if (path.endsWith(".md")) path = path.slice(0, -3)
  if (path.startsWith("./")) path = path.slice(2)
  if (path.startsWith("docs/")) path = path.slice(5)

  if (path.startsWith("../")) return `${path}${suffix}`
  if (path.startsWith("/")) return `${path}${suffix}`
  if (!path) return `/docs${suffix}`

  return `/docs/${path}${suffix}`
}

type NextraMDXComponents = ReturnType<typeof useNextraMDXComponents>

export const useMDXComponents = (components?: NextraMDXComponents) => {
  const nextraComponents =
    components === undefined
      ? useNextraMDXComponents()
      : useNextraMDXComponents(components)
  const Anchor = nextraComponents.a ?? "a"

  return {
    ...nextraComponents,
    a: (props: ComponentProps<"a">) => (
      <Anchor {...props} href={normalizeDocHref(props.href)} />
    )
  }
}
