import { Suspense } from "react"
import ShopDashboardShell from "./components/ShopDashboardShell"

export default function Home() {
  return (
    <Suspense fallback={null}>
      <ShopDashboardShell />
    </Suspense>
  )
}
