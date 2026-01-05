export const mapSettledWithWarnings = async <Input, Output>({
  items,
  task,
  onError
}: {
  items: Input[]
  task: (item: Input) => Promise<Output>
  onError: (item: Input, error: unknown) => void
}): Promise<(Output | undefined)[]> => {
  const results = await Promise.allSettled(items.map((item) => task(item)))

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value

    onError(items[index], result.reason)
    return undefined
  })
}
