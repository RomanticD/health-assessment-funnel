import 'server-only'

import { z } from 'zod'

const httpOriginSchema = z
  .url()
  .transform((value) => value.replace(/\/$/u, ''))
  .refine((value) => {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  }, 'Expected an exact HTTP(S) origin without credentials, path, query or fragment')

const serverEnvSchema = z
  .object({
    APP_ORIGIN: httpOriginSchema,
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(20),
    VERCEL_GIT_COMMIT_SHA: z.string().min(1).default('local'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && !environment.APP_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN must use HTTPS in production',
      })
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cachedEnv: ServerEnv | undefined

/**
 * Environment parsing is intentionally lazy so `next build` can compile the
 * application before deployment secrets are attached. The first request that
 * needs persistence still fails closed if any required value is absent.
 */
export function getServerEnv(): ServerEnv {
  cachedEnv ??= serverEnvSchema.parse({
    APP_ORIGIN: process.env.APP_ORIGIN,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    NODE_ENV: process.env.NODE_ENV,
  })

  return cachedEnv
}
