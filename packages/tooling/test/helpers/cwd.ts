export const withCwd = async <T>(
  nextCwd: string,
  action: () => Promise<T> | T
): Promise<T> => {
  const previous = process.cwd()
  process.chdir(nextCwd)

  try {
    return await action()
  } finally {
    process.chdir(previous)
  }
}
