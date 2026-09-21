import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getServerEnv } from '@/server/config/env'

/**
 * This privileged client is server-only. Application code should call vetted
 * transaction RPCs rather than issuing ad-hoc table mutations with it. A new
 * stateless client is created for each use-case invocation so no request-scoped
 * auth or headers can leak across concurrent invocations.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const env = getServerEnv()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'health-assessment-server/0.1.0',
      },
    },
  })
}
