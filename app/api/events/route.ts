import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { parseBeacon } from '@/lib/events/beacon';
import { recordEvent } from '@/lib/events/track';

/**
 * `POST /api/events` — the beacon for the two funnel moments only a browser can observe:
 * `hit_lock` (this page rendered at least one locked block) and `hire_click` (§3.1's B2B CTA,
 * the item M1 deferred).
 *
 * Contract:
 *   · the type whitelist is `lib/events/beacon.ts`, narrower than the DB CHECK, and unknown types
 *     are rejected outright rather than silently dropped — a rejected type is a bug in our own
 *     code, and silence would hide it;
 *   · the user id comes from the server-verified session, never from the body;
 *   · a `slug` is resolved here to a `playbook_id`, so a caller cannot post an arbitrary id;
 *   · every failure past validation is SILENT. `sendBeacon` has no error channel anyway, and
 *     analytics must never be able to break a page.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const NO_CONTENT = () => new NextResponse(null, { status: 204, headers: HEADERS });

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_body' }, { status: 400, headers: HEADERS });
  }

  const parsed = parseBeacon(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400, headers: HEADERS });
  }

  try {
    const [sql, viewer] = await Promise.all([getSqlRunner(), getViewer()]);
    if (sql === null) return NO_CONTENT();

    let playbookId: string | null = null;
    if (parsed.slug !== null) {
      const { rows } = await sql.query<{ id: string }>(
        'select id from playbooks where slug = $1',
        [parsed.slug],
      );
      playbookId = rows[0]?.id ?? null;
    }

    await recordEvent(sql, {
      type: parsed.type,
      userId: viewer.userId,
      playbookId,
      ...(parsed.slug === null && parsed.surface === null
        ? {}
        : {
            meta: {
              ...(parsed.slug === null ? {} : { slug: parsed.slug }),
              ...(parsed.surface === null ? {} : { surface: parsed.surface }),
            },
          }),
    });
  } catch {
    // Silent by contract.
  }

  return NO_CONTENT();
}
