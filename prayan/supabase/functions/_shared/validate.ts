// Tiny hand-rolled request validation — no zod, no new dependency, just
// enough to reject malformed bodies with a clear 400 before touching the DB.

export function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field]
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError(`"${field}" is required and must be a non-empty string`)
  return v
}

export function requireUuid(body: Record<string, unknown>, field: string): string {
  const v = requireString(body, field)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(v)) throw new ValidationError(`"${field}" must be a UUID`)
  return v
}

export function requireOneOf<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const v = body[field]
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new ValidationError(`"${field}" must be one of: ${allowed.join(', ')}`)
  }
  return v as T
}

export async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new ValidationError('request body must be a JSON object')
  }
}

export class ValidationError extends Error {}
