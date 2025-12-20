import type { ReactNode } from "react"
import ReactDOM from "react-dom/client"

export const reactRender = (component: ReactNode) => {
  const rootElement = document.getElementById("root")

  if (!rootElement) {
    throw new Error("Root element not found")
  }

  return ReactDOM.createRoot(rootElement).render(component)
}
