import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The service-role client, constructed in exactly one place.
 *
 * `lib/supabase/data-client.ts` is the app's door to this: it adds `import 'server-only'` so an
 * accidental import from a client component is a BUILD error rather than a runtime key leak. This
 * module deliberately carries no such guard, because two legitimate non-React callers need the
 * same client and would crash on it — `server-only`'s default export throws the moment plain Node
 * imports it:
 *
 *   · `lib/storage/supabase-driver.ts`, reached from `npm run seed` and `npm run cloud:smoke`
 *     under `tsx` as well as from route handlers;
 *   · `scripts/cloud-smoke.ts`, which has to prove the live project answers at all.
 *
 * The key itself is still server-only in the way that matters: `SUPABASE_SERVICE_ROLE_KEY` has no
 * `NEXT_PUBLIC_` prefix, so Next never inlines it into a browser bundle — a client-side import
 * would read `undefined` and throw here, not ship the secret.
 */

let cached: SupabaseClient | null = null;

export interface ServiceClientConfig {
  url: string;
  serviceRoleKey: string;
}

/** Throws with the setup pointer rather than returning a half-configured client. */
export function readServiceClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceClientConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the data client. ' +
        'See docs/SETUP.md.',
    );
  }
  return { url, serviceRoleKey };
}

export function createServiceClient(): SupabaseClient {
  if (cached) return cached;
  const { url, serviceRoleKey } = readServiceClientConfig();

  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-playbook-client': 'data' } },
  });
  return cached;
}

/** Test/script seam — drops the memoised client so the next call re-reads the env. */
export function resetServiceClient(): void {
  cached = null;
}
