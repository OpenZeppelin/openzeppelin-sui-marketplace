export const getErrnoCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined
  const code = (error as { code?: string }).code
  return typeof code === "string" ? code : undefined
}

export const isErrnoWithCode = (error: unknown, code: string): boolean =>
  getErrnoCode(error) === code
