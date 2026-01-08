import type { FC, PropsWithChildren } from "react"

const Body: FC<PropsWithChildren> = ({ children }) => {
  return <main className="flex flex-grow flex-col">{children}</main>
}
export default Body
