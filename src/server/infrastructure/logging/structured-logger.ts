const REDACTED = '[REDACTED]'

const sensitiveKeyPattern =
  /authorization|cookie|password|secret|token|session(?:id|hash|digest)?|health|answer|input|weight|height|age/i

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogContext {
  traceId: string
  event: string
  route?: string
  method?: string
  status?: number
  durationMs?: number
  errorCode?: string
  [key: string]: unknown
}

function sanitize(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (sensitiveKeyPattern.test(key)) return REDACTED
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'

  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key, seen))

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitize(childValue, childKey, seen),
    ]),
  )
}

export function logStructured(level: LogLevel, context: LogContext): void {
  const safeContext = sanitize(context) as Record<string, unknown>
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...safeContext,
  })

  if (level === 'error') {
    console.error(payload)
  } else if (level === 'warn') {
    console.warn(payload)
  } else {
    console.info(payload)
  }
}
