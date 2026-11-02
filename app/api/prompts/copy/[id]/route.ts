import { NextResponse } from 'next/server';

/**
 * `POST /api/prompts/copy/[id]` — retired (docs/TEMPLATES-IA.md, 2026-09-05).
 *
 * This endpoint was the one door through which prompt TEXT left the server: the gallery was static
 * and cached, so "copy" had to be a per-viewer request with the reader's session attached. The
 * founder's decision to stop exposing prompts closes that door for every tier, admins included —
 * the text is the studio's private recipe now, read only by the render pipeline. 410 rather than
 * 404: the resource existed, and a client that still knows the path should learn it is gone, not
 * keep guessing at ids. Every response stays `private, no-store` + `noindex`, exactly as before.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: 'gone', reason: 'prompt text is no longer published' }, { status: 410, headers: HEADERS });
}
