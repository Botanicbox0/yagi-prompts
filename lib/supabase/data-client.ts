import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * PLAN §7 — factory #2 of two: the SERVICE-ROLE client.
 *
 * `import 'server-only'` is the guard: any accidental import from a client component is a build
 * error, not a runtime leak. Everything gated is read through this client inside RSC/route
 * handlers and shaped per a server-verified session (§3.4 "enforcement is server-side only").
 *
 * The browser never sees this key and never queries data.
 */

let cached: SupabaseClient | null = null;

export function createDataClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the data client. ' +
        'See docs/SETUP.md.',
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-playbook-client': 'data' } },
  });
  return cached;
}
