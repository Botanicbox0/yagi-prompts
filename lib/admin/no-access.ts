import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';

/** Where a signed-in non-admin on admin.twings.app is sent (P1-6). */
export const ADMIN_NO_ACCESS_PATH = '/admin/no-access';

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The whole "this account is not an admin" page, as a string: a title, one sentence and a sign-out
 * button that posts to the same host's `/auth/signout` (which returns to the admin chooser). No admin
 * data, no navigation, no script. Served by a route handler so no admin page segment ever renders.
 */
export function adminNoAccessHtml(locale: Locale, admin: Dictionary['admin']): string {
  return `<!doctype html>
<html lang="${locale}" data-admin-no-access>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(admin.noAccessTitle)} · ${escape(admin.brand)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,'Pretendard',sans-serif;color:#111;background:#fff}main{max-width:32rem;margin:18vh auto 0;padding:0 1.5rem}h1{font-size:1.4rem;margin:0 0 .75rem}p{line-height:1.6;opacity:.75;margin:0 0 1.5rem}button{font:inherit;border:1px solid #111;background:#111;color:#fff;padding:.6rem 1.1rem;cursor:pointer}</style>
</head>
<body>
<main>
<h1>${escape(admin.noAccessTitle)}</h1>
<p>${escape(admin.noAccessBody)}</p>
<form method="post" action="/auth/signout"><button type="submit">${escape(admin.signOut)}</button></form>
</main>
</body>
</html>`;
}
