export const withEnv = async <T>(
  updates: Record<string, string | undefined>,
  action: () => Promise<T> | T
): Promise<T> => {
  const previous = new Map<string, string | undefined>()

  Object.entries(updates).forEach(([key, value]) => {
    previous.set(key, process.env[key])
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  })

  try {
    return await action()
  } finally {
    previous.forEach((value, key) => {
      if (value === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    })
  }
}
