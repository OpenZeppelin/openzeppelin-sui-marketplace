"use client"

import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import useNetworkConfig from "./useNetworkConfig"

const useExplorerUrl = () => {
  const { useNetworkVariable } = useNetworkConfig()
  return useNetworkVariable(EXPLORER_URL_VARIABLE_NAME)
}

export default useExplorerUrl
