import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { VideoBeatsSchema } from '@/lib/prompts/keyframes';
import { recommendVideoKeyframes } from '@/lib/template-director/keyframes';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('recommend'),
    durationSeconds: z.number().min(2).max(120),
    title: z.string().trim().max(160).optional(),
    promptSummary: z.string().trim().max(600).optional(),
  }),
  z.object({
    action: z.literal('save'),
    // Beats only, at most six: the maker route is unchanged by the marks (docs/PERSONAL-STUDIO.md §3.4.4, T1a).
    keyframes: VideoBeatsSchema,
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'forbidden' }, { status: 403, headers: HEADERS });
  }
  const viewer = await getViewer();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, code: 'sign_in_required' }, { status: 401, headers: HEADERS });
  }

  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: HEADERS });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400, headers: HEADERS });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400, headers: HEADERS });
  }

  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  }

  const own = await sql.query<{ id: string; user_id: string }>(
    'select id, user_id from platform_formats where id = $1',
    [id],
  );
  if (own.rows[0] && own.rows[0].user_id !== viewer.userId) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: HEADERS });
  }

  if (parsed.data.action === 'recommend') {
    const result = await recommendVideoKeyframes({
      durationSeconds: parsed.data.durationSeconds,
      title: parsed.data.title,
      promptSummary: parsed.data.promptSummary,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS });
  }

  if (!own.rows[0]) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: HEADERS });
  }

  const normalized = parsed.data.keyframes
    .slice()
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((kf, idx) => ({ ...kf, index: idx }));

  await sql.query(
    'update platform_formats set keyframes = $2::jsonb, updated_at = now() where id = $1 and user_id = $3',
    [id, JSON.stringify(normalized), viewer.userId],
  );
  return NextResponse.json({ ok: true, keyframes: normalized }, { headers: HEADERS });
}
