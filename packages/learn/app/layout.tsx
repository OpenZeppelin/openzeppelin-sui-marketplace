import { Footer, Layout, Navbar } from "nextra-theme-docs"
import "nextra-theme-docs/style.css"
import { Head } from "nextra/components"
import { getPageMap } from "nextra/page-map"
import type { ReactNode } from "react"

import siteConfig from "../theme.config"

export const metadata = {
  title: "Sui Oracle Market Learning",
  description: "Self-guided Sui/Move learning path for the Oracle Market repo."
}

const navbar = (
  <Navbar logo={siteConfig.logo} projectLink={siteConfig.project?.link} />
)

const footer = siteConfig.footer?.text ? (
  <Footer>{siteConfig.footer.text}</Footer>
) : undefined

export default async function RootLayout({
  children
}: {
  children: ReactNode
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <body>
        <Layout
          pageMap={await getPageMap()}
          navbar={navbar}
          footer={footer}
          docsRepositoryBase={siteConfig.docsRepositoryBase}
          sidebar={siteConfig.sidebar}
          darkMode={siteConfig.darkMode}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
