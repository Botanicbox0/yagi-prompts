import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { revalidateMakerProfile } from '@/lib/cache';
import { creativeGate } from '@/lib/makers/access';
import { loadMakerSettings } from '@/lib/makers/profile';
import { MAKER_FILE_MAX_BYTES } from '@/lib/recipes/assets';
import { getRenderStore } from '@/lib/renders/store';
import {
  WorkError, deleteMakerAvatar, deleteMakerCover, deleteMakerWork, listMakerWorks, reorderMakerWorks, storeMakerAvatar, storeMakerCover, storeMakerWork, updateMakerWork,
} from '@/lib/makers/works';

/**
 * `/api/makers/works` — the studio's works, avatar and cover (docs/PLATFORM-2.0.md §20.2).
 *
 *   POST ?kind=work[&title=&caption=&link=]   one work as the raw request body (4 MB, type from the bytes)
 *   POST ?kind=avatar                          the avatar, cropped square
 *   POST ?kind=cover                           the profile banner, cropped 2:1 (0071)
 *   PATCH  {id,title,caption,link}             a work's text
 *   PATCH  {order:[ids]}                       the creative's order
 *   DELETE ?id=wrk_… | ?kind=avatar | ?kind=cover
 *
 * Same-origin, signed-in, an active creative with the program open. Answers carry ids and codes —
 * never a storage key. A public profile's pages refresh on every change.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const STATUS: Record<string, number> = { sign_in_required: 401, forbidden: 403, not_open: 403, not_found: 404, too_large: 413, bad_file: 415, limit_reached: 409, invalid: 400, unavailable: 503 };

async function gate(request: Request) {
  if (!isSameOrigin(request)) return { error: json({ code: 'forbidden' }, 403) } as const;
  const viewer = await getViewer();
  if (!viewer.userId) return { error: json({ code: 'sign_in_required' }, 401) } as const;
  const sql = await getSqlRunner();
  if (!sql) return { error: json({ code: 'unavailable' }, 503) } as const;
  const access = await creativeGate(sql, viewer.userId);
  if (!access.ok) return { error: json({ code: access.code }, STATUS[access.code]) } as const;
  return { sql, userId: access.userId } as const;
}

async function refresh(sql: NonNullable<Awaited<ReturnType<typeof getSqlRunner>>>, userId: string) {
  const settings = await loadMakerSettings(sql, userId);
  if (settings?.handle) revalidateMakerProfile([settings.handle]);
}

function failed(error: unknown) {
  if (error instanceof WorkError) return json({ code: error.code }, STATUS[error.code] ?? 409);
  return json({ code: 'unavailable' }, 503);
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return json({ code: 'unavailable' }, 503);
  try { return json({ ok: true, works: await listMakerWorks(sql, viewer.userId) }); } catch (error) { return failed(error); }
}

export async function POST(request: Request) {
  const g = await gate(request);
  if ('error' in g) return g.error;
  const query = new URL(request.url).searchParams;
  try {
    const bytes = await readBoundedBody(request, MAKER_FILE_MAX_BYTES);
    if (!bytes) return json({ code: 'too_large' }, 413);
    const store = await getRenderStore();
    if (query.get('kind') === 'avatar') {
      const version = await storeMakerAvatar(g.sql, store, g.userId, bytes);
      await refresh(g.sql, g.userId);
      return json({ ok: true, avatarVersion: version }, 201);
    }
    if (query.get('kind') === 'cover') {
      const version = await storeMakerCover(g.sql, store, g.userId, bytes);
      await refresh(g.sql, g.userId);
      return json({ ok: true, coverVersion: version }, 201);
    }
    const { work, unchanged } = await storeMakerWork(g.sql, store, { userId: g.userId, bytes, title: query.get('title') ?? undefined, caption: query.get('caption') ?? undefined, link: query.get('link') ?? undefined });
    await refresh(g.sql, g.userId);
    return json({ ok: true, work, unchanged }, unchanged ? 200 : 201);
  } catch (error) { return failed(error); }
}

export async function PATCH(request: Request) {
  const g = await gate(request);
  if ('error' in g) return g.error;
  try {
    const bytes = await readBoundedBody(request, 8_000);
    if (!bytes) return json({ code: 'too_large' }, 413);
    let body: { id?: unknown; title?: unknown; caption?: unknown; link?: unknown; order?: unknown };
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ code: 'invalid' }, 400); }
    if (Array.isArray(body.order)) {
      const works = await reorderMakerWorks(g.sql, g.userId, body.order);
      await refresh(g.sql, g.userId);
      return json({ ok: true, works });
    }
    if (typeof body.id !== 'string') return json({ code: 'invalid' }, 400);
    const work = await updateMakerWork(g.sql, g.userId, body.id, body);
    await refresh(g.sql, g.userId);
    return json({ ok: true, work });
  } catch (error) { return failed(error); }
}

export async function DELETE(request: Request) {
  const g = await gate(request);
  if ('error' in g) return g.error;
  const query = new URL(request.url).searchParams;
  try {
    const store = await getRenderStore();
    if (query.get('kind') === 'avatar') await deleteMakerAvatar(g.sql, store, g.userId);
    else if (query.get('kind') === 'cover') await deleteMakerCover(g.sql, store, g.userId);
    else await deleteMakerWork(g.sql, store, g.userId, query.get('id') ?? '');
    await refresh(g.sql, g.userId);
    return json({ ok: true });
  } catch (error) { return failed(error); }
}
