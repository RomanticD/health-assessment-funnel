import 'server-only'

import { z } from 'zod'

const serverEnvSchema = z
  .object({
    APP_ORIGIN: z
      .url()
      .transform((value) => value.replace(/\/$/, ''))
      .refine((value) => !value.includes('#'), 'APP_ORIGIN must not contain a fragment'),
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(20),
    VERCEL_GIT_COMMIT_SHA: z.string().min(1).default('local'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .strict()

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
