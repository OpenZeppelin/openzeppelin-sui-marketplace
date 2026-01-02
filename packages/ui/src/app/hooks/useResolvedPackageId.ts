"use client"

import { useMemo } from "react"
import {
  CONTRACT_PACKAGE_ID_NOT_DEFINED,
  CONTRACT_PACKAGE_VARIABLE_NAME
} from "../config/network"
import { resolveConfiguredId } from "../helpers/network"
import useNetworkConfig from "./useNetworkConfig"

const useResolvedPackageId = () => {
  const { useNetworkVariable } = useNetworkConfig()
  const rawPackageId = useNetworkVariable(CONTRACT_PACKAGE_VARIABLE_NAME)

  return useMemo(
    () => resolveConfiguredId(rawPackageId, CONTRACT_PACKAGE_ID_NOT_DEFINED),
    [rawPackageId]
  )
}

export default useResolvedPackageId
