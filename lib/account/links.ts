import type { Locale } from '@/lib/i18n/config';

/**
 * docs/APP-STORE-LAUNCH.md §3.2 — the deletion surface's paths, spelled once. The confirmation step
 * is unprefixed app surface (inside `/account`); the how-to page is public and prefixed, and its URL
 * is the "account deletion URL" in the Google Play listing, so it must not move.
 *
 * `/delete-account`, not `/account-deletion`: robots.txt disallows the `/account` prefix (the app
 * surface), and a public page whose path starts with it would read as private to every check.
 */
export const ACCOUNT_DELETE_PATH = '/account/delete';
export const ACCOUNT_DELETION_REST = '/delete-account';

export function accountDeletionHref(locale: Locale | string): string {
  return `/${locale}${ACCOUNT_DELETION_REST}`;
}

export function accountDeleteSigninHref(locale: Locale | string): string {
  return `/auth/signin?next=${encodeURIComponent(ACCOUNT_DELETE_PATH)}&locale=${locale}`;
}
