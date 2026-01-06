import { generateStaticParamsFor, importPage } from "nextra/pages"

import { useMDXComponents as getMDXComponents } from "../../mdx-components"

export const generateStaticParams = generateStaticParamsFor("mdxPath")

export async function generateMetadata(props: {
  params: { mdxPath?: string[] }
}) {
  const { mdxPath } = await props.params
  const { metadata } = await importPage(mdxPath ?? [])
  return metadata
}

export default async function Page(props: { params: { mdxPath?: string[] } }) {
  const { mdxPath } = await props.params
  const { default: MDXContent, ...pageProps } = await importPage(mdxPath ?? [])
  const Wrapper = getMDXComponents().wrapper

  return (
    <Wrapper {...pageProps}>
      <MDXContent {...props} params={{ mdxPath }} />
    </Wrapper>
  )
}
