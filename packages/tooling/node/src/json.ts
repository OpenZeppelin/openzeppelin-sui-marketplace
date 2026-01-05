export const emitJsonOutput = (payload: unknown, enabled?: boolean) => {
  if (!enabled) return false
  console.log(JSON.stringify(payload, undefined, 2))
  return true
}
