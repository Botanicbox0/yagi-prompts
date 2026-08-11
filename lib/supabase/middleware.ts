import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

/**
 * @supabase/ssr session refresh for edge middleware (the pinned 0.12.x contract).
 *
 * The rules that make this correct and are easy to break on upgrade:
 *   1. cookies are mirrored onto BOTH the request and a freshly-created response;
 *   2. `getUser()` — never `getSession()` — because only getUser revalidates against the auth
 *      server, and every gate downstream trusts this answer;
 *   3. the returned response object is the one that must be sent (or copied onto a redirect),
 *      otherwise the refreshed tokens are dropped and the user is silently signed out.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers,
): Promise<{ response: NextResponse; user: User | null }> {
  const forward = () =>
    requestHeaders
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.next({ request });

  let response = forward();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Placeholder-env development (no Supabase project yet, PLAN §11): treat everyone as anon
    // rather than crashing every request.
    return { response, user: null };
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = forward();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/** Carry refreshed auth cookies onto a redirect so the session survives the hop. */
export function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}
