import type { NextResponse } from 'next/server';
import { LOOK_COOKIE, LOOK_COOKIE_MAX_AGE_SECONDS, readLookCookie, type TemplateLook } from './look';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — how the choice reaches static pages without making them dynamic: a first-party
 * cookie the list island reads in the browser. Not HttpOnly (the island must read it), SameSite=Lax, a year, Secure in
 * production. It names a style, nothing else; the profile row stays the source of truth.
 */
export function writeLookCookie(response: NextResponse, look: TemplateLook | null): void {
  if (look === null) {
    response.cookies.set(LOOK_COOKIE, '', { path: '/', sameSite: 'lax', maxAge: 0 });
    return;
  }
  response.cookies.set(LOOK_COOKIE, look, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    maxAge: LOOK_COOKIE_MAX_AGE_SECONDS,
  });
}

/** The cookie the request carries (null: none, or a value that is not one of the two styles). */
export function requestLookCookie(request: Request): TemplateLook | null {
  return readLookCookie(request.headers.get('cookie'));
}

/** Whether the request carries the cookie at all (any value), so a stale one can be removed. */
export function requestHasLookCookie(request: Request): boolean {
  return (request.headers.get('cookie') ?? '').split(';').some((part) => part.trim().startsWith(`${LOOK_COOKIE}=`));
}

/** Bring the cookie in line with the stored choice: set when it differs, delete when there is none. No-op otherwise. */
export function syncLookCookie(request: Request, response: NextResponse, stored: TemplateLook | null): void {
  const carried = requestLookCookie(request);
  if (stored !== null && carried !== stored) writeLookCookie(response, stored);
  else if (stored === null && requestHasLookCookie(request)) writeLookCookie(response, null);
}
