import { createServerClient } from '@supabase/ssr';
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

/** The `.env.example` placeholder host — a copied-but-unfilled env must not look configured. */
const PLACEHOLDER_HOST = 'YOUR-PROJECT';

/**
 * Is there a real Supabase project to authenticate against? (PLAN §11 open item.)
 *
 * The answer is load-bearing for the gate, not a convenience: with no project there is no possible
 * session, so the only correct viewer is `anon`. Everything downstream fails CLOSED on `false` —
 * a missing env can never widen access, only narrow it.
 */
export function isAuthConfigured(
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
): boolean {
  return Boolean(
    url && anonKey && url.startsWith('http') && !url.includes(PLACEHOLDER_HOST),
  );
}

export function supabaseUrl(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_URL');
}

export function supabaseAnonKey(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
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

/**
 * The server-verified identity. Returns null for anon — "anon is the absence of a user".
 *
 * Two ways to get `null`, both meaning the same thing to every caller:
 *   · no session cookie / an invalid one;
 *   · no Supabase project configured at all (§11) — see `isAuthConfigured`.
 * The auth server is the only authority; a transport failure resolves anon rather than throwing,
 * because a 500 on the detail route would be a worse answer than the locked render.
 */
export async function getSessionUser() {
  if (!isAuthConfigured()) return null;
  try {
    const cookieStore = await cookies();
    if (cookieStore.getAll().length === 0) return null;
    const supabase = await createAuthServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
