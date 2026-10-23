import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { loadPublicCampaigns } from '@/lib/campaigns/repo';

/** docs/PLATFORM-2.0.md §16.6 — the cached public campaign list shows `audience = 'public'` only. */
let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  for (const [slug, audience] of [['open-to-all', 'public'], ['for-influencers', 'influencers'], ['by-invitation', 'invited']] as const) {
    await db.query(
      `insert into campaigns (slug, status, title, summary, host_name, host_kind, platforms, deliverable, slots, applications_close_at, post_deadline_at, published_at, payout, audience)
       values ($1, 'recruiting', '{"en":"t","ko":"t"}', '{"en":"s","ko":"s"}', 'Brand', 'brand', '{instagram}', 'reel', 3, '2026-11-01', '2026-11-15', now(), '{"model":"flat","flatCents":30000,"currency":"KRW","holdDays":7}', $2)`,
      [slug, audience],
    );
  }
});
afterAll(async () => db?.close());

describe('public campaign list', () => {
  it('lists public campaigns only', async () => {
    expect((await loadPublicCampaigns(runner(db))).map((c) => c.slug)).toEqual(['open-to-all']);
  });
});
