/**
 * Escapes regex metacharacters so the input can be used as a literal in RegExp.
 */
export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
