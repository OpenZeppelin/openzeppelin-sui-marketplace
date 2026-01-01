"use client"

import { useEffect, useState } from "react"

const useClientReady = () => {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  return ready
}

export default useClientReady
