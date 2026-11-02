import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { enableToggle } from '@/lib/notify/preferences';

/**
 * `POST /api/notify/interest` — the closed studio's one button (components/twings/studio.tsx).
 * "Tell me when it opens" flips the account's new-template switch on; the account page is where it
 * comes off again. No body, no parameters: the viewer is the session, the switch is the only one.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function POST(): Promise<NextResponse> {
  const viewer = await getViewer();
  if (viewer.userId === null) return NextResponse.json({ ok: false, code: 'sign_in_required' }, { status: 401, headers: HEADERS });
  const sql = await getSqlRunner();
  if (sql === null) return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  const ok = await enableToggle(sql, viewer.userId, 'notif_new_playbook');
  return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: HEADERS });
}
