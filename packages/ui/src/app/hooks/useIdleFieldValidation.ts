"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type TimerMap = Record<string, ReturnType<typeof setTimeout>>

const clearTimers = (timers: TimerMap) => {
  Object.values(timers).forEach((timer) => clearTimeout(timer))
}

export const useIdleFieldValidation = <K extends string>({
  idleDelayMs = 600
}: { idleDelayMs?: number } = {}) => {
  const [fieldTouched, setFieldTouched] = useState<Partial<Record<K, boolean>>>(
    {}
  )
  const [fieldDirty, setFieldDirty] = useState<Partial<Record<K, boolean>>>({})
  const [fieldIdle, setFieldIdle] = useState<Partial<Record<K, boolean>>>({})
  const timersRef = useRef<TimerMap>({})

  const resetFieldState = useCallback(() => {
    clearTimers(timersRef.current)
    timersRef.current = {}
    setFieldTouched({})
    setFieldDirty({})
    setFieldIdle({})
  }, [])

  useEffect(() => () => clearTimers(timersRef.current), [])

  const markFieldChange = useCallback(
    (key: K) => {
      setFieldDirty((previous) =>
        previous[key] ? previous : { ...previous, [key]: true }
      )
      setFieldIdle((previous) =>
        previous[key] ? { ...previous, [key]: false } : previous
      )

      const timers = timersRef.current
      if (timers[key]) clearTimeout(timers[key])
      timers[key] = setTimeout(() => {
        setFieldIdle((previous) => ({
          ...previous,
          [key]: true
        }))
      }, idleDelayMs)
    },
    [idleDelayMs]
  )

  const markFieldBlur = useCallback((key: K) => {
    setFieldTouched((previous) => ({
      ...previous,
      [key]: true
    }))
  }, [])

  const shouldShowFieldFeedback = useCallback(
    (key: K, hasAttemptedSubmit: boolean) => {
      if (hasAttemptedSubmit) return true
      if (!fieldDirty[key]) return false
      return Boolean(fieldTouched[key] || fieldIdle[key])
    },
    [fieldDirty, fieldTouched, fieldIdle]
  )

  return {
    fieldTouched,
    fieldDirty,
    fieldIdle,
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  }
}
