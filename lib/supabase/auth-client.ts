import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * PLAN §7 — factory #1 of two, strictly separated.
 *
 * This is the cookie-bound ANON client. It performs **auth only**: sign-in, sign-out, session
 * refresh and `getUser()` (verified against the auth server, never `getSession()` alone). It must
 * never be used to query content — RLS is deny-all with no policies, so it would return nothing
 * anyway, and gated reads belong to lib/supabase/data-client.ts inside server code.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local — see docs/SETUP.md.`);
  }
  return value;
}

export function supabaseUrl(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_URL');
}

export function supabaseAnonKey(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

/** Browser/client-components. Auth only. */
export function createAuthBrowserClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}

/**
 * Server components, route handlers and server actions.
 * `cookies()` is async in Next 15 — that contract is why the version is pinned (docs/VERSIONS.md).
 */
export async function createAuthServerClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // middleware.ts refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}

/** The server-verified identity. Returns null for anon — "anon is the absence of a user". */
export async function getSessionUser() {
  const supabase = await createAuthServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
