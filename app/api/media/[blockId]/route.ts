import { NextResponse } from 'next/server';

/**
 * `/api/media/[blockId]` — the entitlement-checked media gateway (§3.3). M2 implements it.
 *
 * The authorization chain it must run, in order, before emitting anything:
 *   1. block → step → revision, and that revision MUST equal the playbook's current
 *      `published_revision_id` (draft / superseded / archived refuse);
 *   2. playbook eligibility for the viewer — anon ⇒ the current published revision has
 *      `is_showcase`; free/pro ⇒ published;
 *   3. effective (stamped) visibility ≤ viewer tier;
 *   4. then, and only then, redirect to a ≤60s signed URL against the PUBLISHED private copy.
 * Public-bucket URLs are only ever emitted for current showcase revisions and heroes.
 */
export const dynamic = 'force-dynamic';

const NOT_IMPLEMENTED = { error: 'not_implemented', milestone: 'M2' } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ blockId: string }> },
): Promise<NextResponse> {
  await params;
  return NextResponse.json(NOT_IMPLEMENTED, {
    status: 501,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
