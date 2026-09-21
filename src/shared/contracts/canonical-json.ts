import { stepUpdateCommandSchema } from './api'
import { healthInputV1Schema } from './health'

export type CanonicalJsonPrimitive = boolean | null | number | string
export type CanonicalJsonValue =
  CanonicalJsonPrimitive | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue }

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalJsonError'
  }
}

const canonicalize = (value: unknown, ancestors: WeakSet<object>): CanonicalJsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError('Canonical JSON does not support non-finite numbers.')
    }

    return Object.is(value, -0) ? 0 : value
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new CanonicalJsonError('Canonical JSON does not support cyclic values.')
    }

    ancestors.add(value)
    const canonicalArray = value.map((item) => canonicalize(item, ancestors))
    ancestors.delete(value)
    return canonicalArray
  }

  if (typeof value !== 'object') {
    throw new CanonicalJsonError(`Canonical JSON does not support values of type ${typeof value}.`)
  }

  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError('Canonical JSON only supports plain objects.')
  }

  if (ancestors.has(value)) {
    throw new CanonicalJsonError('Canonical JSON does not support cyclic values.')
  }

  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new CanonicalJsonError('Canonical JSON does not support symbol keys.')
  }

  const stringKeys = ownKeys.filter((key): key is string => typeof key === 'string').sort()
  const canonicalObject: { [key: string]: CanonicalJsonValue } = {}

  ancestors.add(value)
  for (const key of stringKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      ancestors.delete(value)
      throw new CanonicalJsonError('Canonical JSON only supports enumerable data properties.')
    }

    canonicalObject[key] = canonicalize(descriptor.value, ancestors)
  }
  ancestors.delete(value)

  return canonicalObject
}

export const canonicalizeJson = (value: unknown): CanonicalJsonValue =>
  canonicalize(value, new WeakSet<object>())

export const canonicalJsonStringify = (value: unknown): string =>
  JSON.stringify(canonicalizeJson(value))

/**
 * Strict parsing happens before canonicalization so unknown keys can never be
 * silently omitted from an idempotency hash.
 */
export const canonicalizeHealthInputV1 = (value: unknown): CanonicalJsonValue =>
  canonicalizeJson(healthInputV1Schema.parse(value))

/**
 * The URL step key and body are canonicalized together to avoid hash collisions
 * between two step endpoints with structurally similar payloads.
 */
export const canonicalizeStepUpdateCommand = (value: unknown): CanonicalJsonValue =>
  canonicalizeJson(stepUpdateCommandSchema.parse(value))
