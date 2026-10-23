import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { estimateRenderMinutes } from '@/lib/renders/eta';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { FIXTURE_USERS } from '@/scripts/fixtures';

/**
 * docs/PLATFORM-2.0.md §3.2-3·4 — "보통 N분 걸려요" is a measurement, not a promise: the median of
 * recent finished jobs on the same engine and the same template length, with the engine default
 * until there are ten of them.
 */
let h: PromptHarness;
const templates: Record<string, { id: string; runtime: number | null }> = {};

async function finished(slug: string, engine: string, seconds: number, status = 'succeeded') {
  const template = templates[slug]!;
  const created = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
  const done = new Date(created.getTime() + seconds * 1000);
  const ok = status === 'succeeded';
  await h.sql.query(
    `insert into render_jobs (id, user_id, template_id, template_slug, medium, engine, aspect, locale, status,
       result_key, result_mime, share_token, share_expires_at, error_code, created_at, finished_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4, 'video', $5, '9:16', 'ko', $6,
       $7, $8, $9, $10::timestamptz, $11, $12::timestamptz, $13::timestamptz)`,
    [randomUUID(), FIXTURE_USERS.free.id, template.id, slug, engine, status,
      ok ? 'renders/x.mp4' : null, ok ? 'video/mp4' : null, ok ? randomUUID() : null, ok ? done.toISOString() : null,
      ok ? null : 'engine_error', created.toISOString(), done.toISOString()],
  );
}

beforeAll(async () => {
  h = await promptHarness();
  const { rows } = await h.sql.query<{ id: string; slug: string; runtime_seconds: number | null }>(
    `select id, slug, runtime_seconds from prompt_items where slug in ('neon-alley-dolly', 'handheld-market-run')`,
  );
  for (const row of rows) templates[row.slug] = { id: row.id, runtime: row.runtime_seconds };
});
afterAll(async () => h.close());

describe('estimateRenderMinutes', () => {
  it('uses the engine default until ten jobs of the same engine and length have finished', async () => {
    for (let i = 0; i < 9; i += 1) await finished('neon-alley-dolly', 'seedance-2.5', 180);
    expect(await estimateRenderMinutes(h.sql, { engine: 'seedance-2.5', templateId: templates['neon-alley-dolly']!.id, medium: 'video' }))
      .toEqual({ minutes: 5, source: 'default', samples: 9 });
  });

  it('switches to the measured median at ten, ignoring failures, other engines and other lengths', async () => {
    await finished('neon-alley-dolly', 'seedance-2.5', 180);
    await finished('neon-alley-dolly', 'seedance-2.5', 9_000, 'failed');
    for (let i = 0; i < 5; i += 1) await finished('neon-alley-dolly', 'seedance-2.0', 900);
    expect(templates['handheld-market-run']!.runtime).not.toBe(templates['neon-alley-dolly']!.runtime);
    for (let i = 0; i < 5; i += 1) await finished('handheld-market-run', 'seedance-2.5', 900);
    expect(await estimateRenderMinutes(h.sql, { engine: 'seedance-2.5', templateId: templates['neon-alley-dolly']!.id, medium: 'video' }))
      .toEqual({ minutes: 3, source: 'measured', samples: 10 });
  });

  it('never throws: a broken query reads as the default', async () => {
    const broken = { query: async () => { throw new Error('down'); } } as never;
    expect(await estimateRenderMinutes(broken, { engine: 'x', templateId: randomUUID(), medium: 'image' }))
      .toEqual({ minutes: 2, source: 'default', samples: 0 });
  });
});
