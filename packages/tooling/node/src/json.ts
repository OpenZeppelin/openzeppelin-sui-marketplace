export const emitJsonOutput = (payload: unknown, enabled?: boolean) => {
  if (!enabled) return false
  console.log(JSON.stringify(payload, undefined, 2))
  return true
}

export const collectJsonCandidates = (output: string): string[] => {
  const trimmed = output.trim()
  if (!trimmed) return []

  const candidates: string[] = [trimmed]

  const lines = trimmed.split(/\r?\n/)
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = lines[idx]?.trimStart()
    if (!line || (!line.startsWith("{") && !line.startsWith("["))) continue
    candidates.push(lines.slice(idx).join("\n").trim())
    break
  }

  const trailingBlockMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/)
  if (trailingBlockMatch?.[1]) {
    candidates.push(trailingBlockMatch[1].trim())
  }

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }

  return Array.from(new Set(candidates.filter(Boolean)))
}

export const tryParseJson = <T = unknown>(candidate: string): T | undefined => {
  try {
    return JSON.parse(candidate) as T
  } catch {
    return undefined
  }
}

export const parseJsonFromOutput = <T = unknown>(
  output: string
): T | undefined => {
  for (const candidate of collectJsonCandidates(output)) {
    const parsed = tryParseJson<T>(candidate)
    if (parsed !== undefined) return parsed
  }

  return undefined
}
