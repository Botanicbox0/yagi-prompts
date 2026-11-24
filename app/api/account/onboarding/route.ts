import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRequestUrl } from '@/lib/routing/surfaces';
import { templateLookOpen } from '@/lib/flags';
import { loadViewerLook, templateLookSchemaReady } from '@/lib/template-look/repo';

/**
 * `GET /api/account/onboarding` — should this session see the first-run sheet? `{ show }`, true
 * only for a signed-in account whose `profiles.onboarded_at` is still NULL (docs/PLATFORM-2.0.md
 * §3.2-1). Anonymous readers get `{ show: false }` without a database round trip.
 *
 * `POST /api/account/onboarding` — the sheet was dismissed (skip, close, or either button). Records
 * `onboarded_at` once; a second call changes nothing and says so (`recorded: false`). Session
 * required, our own page only (the Origin must match), no body, private.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
};

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

/** The browser always sends Origin on a POST fetch; a write without one is not from our page. */
function fromOwnPage(request: Request): boolean {
  const origin = request.headers.get('origin');
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  if (origin === null || url === null) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

export async function GET(_request?: Request): Promise<NextResponse> {
  const viewer = await getViewer();
  if (viewer.userId === null) return json({ show: false });
  const sql = await getSqlRunner();
  if (sql === null) return json({ show: false });
  try {
    const { rows } = await sql.query<{ onboarded_at: Date | string | null }>('select onboarded_at from profiles where id = $1', [viewer.userId]);
    const show = rows.length === 1 && rows[0]!.onboarded_at === null;
    // docs/PERSONAL-STUDIO.md §3.4.10 — with the switch on (and 0190 applied), the sheet also asks the template style
    // when the account has none. Off, the answer is exactly as before.
    if (show && templateLookOpen() && (await templateLookSchemaReady(sql))) {
      return json({ show, lookUnset: (await loadViewerLook(sql, viewer.userId)) === null });
    }
    return json({ show });
  } catch {
    // Before 0054 is applied the column is missing: the sheet waits rather than erroring the page.
    return json({ show: false });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!fromOwnPage(request)) return json({ ok: false, code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (viewer.userId === null) return json({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (sql === null) return json({ ok: false, code: 'unavailable' }, 503);
  const { rows } = await sql.query<{ id: string }>(
    'update profiles set onboarded_at = now() where id = $1 and onboarded_at is null returning id',
    [viewer.userId],
  );
  return json({ ok: true, recorded: rows.length === 1 });
}
