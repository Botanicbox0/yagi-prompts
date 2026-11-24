import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { templateLookOpen } from '@/lib/flags';
import { resolveRequestUrl } from '@/lib/routing/surfaces';
import { parseLookBody } from '@/lib/template-look/look';
import { writeLookCookie } from '@/lib/template-look/cookie';
import { saveViewerLook, templateLookSchemaReady } from '@/lib/template-look/repo';

/**
 * `POST /api/account/template-look` — the account's template style (docs/PERSONAL-STUDIO.md §3.4.10). Body
 * `{ "look": "female" | "male" | null }`; null clears it ("정하지 않음"). The person's own tap is the only writer:
 * nothing infers it.
 *
 * Stores the choice on the profile row and sets the `tw_look` cookie to match (or deletes it), which is how the static
 * template lists learn it without becoming dynamic. Idempotent: the same value again answers the same and changes
 * nothing. Signed in only, our own page only (Origin must match), private.
 *
 *   404  the switch (`TWINGS_TEMPLATE_LOOK`) is off — the route does not exist
 *   403  not from our own page
 *   401  signed out
 *   400  a body that is not one of the three values
 *   503  no database, or 0190 not applied yet: nothing is stored and no cookie is set (the feature stays unset)
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

export async function POST(request: Request): Promise<NextResponse> {
  if (!templateLookOpen()) return new NextResponse(null, { status: 404, headers: HEADERS });
  if (!fromOwnPage(request)) return json({ ok: false, code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (viewer.userId === null) return json({ ok: false, code: 'sign_in_required' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, code: 'invalid' }, 400);
  }
  const parsed = parseLookBody(body);
  if (!parsed.ok) return json({ ok: false, code: 'invalid' }, 400);

  const sql = await getSqlRunner();
  if (sql === null || !(await templateLookSchemaReady(sql))) return json({ ok: false, code: 'unavailable' }, 503);
  const saved = await saveViewerLook(sql, viewer.userId, parsed.look);
  if (!saved) return json({ ok: false, code: 'unavailable' }, 503);

  const response = json({ ok: true, look: parsed.look });
  writeLookCookie(response, parsed.look);
  return response;
}
