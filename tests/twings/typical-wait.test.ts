import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { TYPICAL_WAIT_DEFAULT_MINUTES, TYPICAL_WAIT_MIN_SAMPLES, typicalWaitMinutes } from '@/lib/twings/typical-wait';

/**
 * "보통 N분" on the template page (docs/PLATFORM-2.0.md §3.2-3): the median wait of recent
 * successful renders for the same engine and the same length, measured from the order to the
 * finished film. Fewer than ten samples is not a median anyone should quote — the engine's
 * default stands in (image 2 min, video 5 min).
 */

const USER = '55555555-5555-4555-8555-555555555555';

describe('typical wait (render_jobs median)', () => {
  let db: PGlite;
  let sql: SqlRunner;
  let template: { id: string; slug: string; runtime_seconds: number };

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
    await sql.query('insert into auth.users (id) values ($1)', [USER]);
    await sql.query(`insert into profiles (id, email, locale) values ($1, 'wait@twings.test', 'ko')`, [USER]);
    template = (await sql.query<{ id: string; slug: string; runtime_seconds: number }>(
      `insert into prompt_items (slug, source, status, models, title, prompt_text, text_visibility, medium, price_cents, runtime_seconds, engine)
       values ('wait-film', 'yagi', 'pending', array['seedance-2.0'], 'Wait film', 'private recipe', 'pro', 'video', 400, 15, 'seedance-2.0')
       returning id, slug, runtime_seconds`,
    )).rows[0]!;
  });
  afterEach(async () => db.close());

  async function finished(minutes: number, { engine = 'seedance-2.0', status = 'succeeded' } = {}) {
    const done = status === 'succeeded';
    await sql.query(
      `insert into render_jobs (user_id, template_id, template_slug, medium, engine, aspect, locale, status,
         result_key, result_mime, share_token, share_expires_at, error_code, created_at, finished_at)
       values ($1, $2, $3, 'video', $4, '9:16', 'ko', $5,
         $6, $7, $8, $9, $10, now() - make_interval(mins => $11::int + 60), now() - make_interval(mins => 60))`,
      [USER, template.id, template.slug, engine, status,
        done ? 'renders/x.mp4' : null, done ? 'video/mp4' : null, done ? crypto.randomUUID() : null, done ? new Date(Date.now() + 86_400_000) : null,
        done ? null : 'provider_failed', minutes],
    );
  }

  it('falls back to the engine default below ten samples', async () => {
    for (let i = 0; i < TYPICAL_WAIT_MIN_SAMPLES - 1; i += 1) await finished(12);
    expect(await typicalWaitMinutes(sql, { engine: 'seedance-2.0', medium: 'video', seconds: template.runtime_seconds })).toBe(TYPICAL_WAIT_DEFAULT_MINUTES.video);
    expect(await typicalWaitMinutes(sql, { engine: 'gpt-image-2', medium: 'image', seconds: null })).toBe(TYPICAL_WAIT_DEFAULT_MINUTES.image);
    expect(TYPICAL_WAIT_DEFAULT_MINUTES).toEqual({ image: 2, video: 5 });
  });

  it('quotes the rounded median of successful renders for this engine and length', async () => {
    for (const minutes of [3, 4, 4, 6, 7, 7, 7, 8, 9, 30]) await finished(minutes);
    // Failures and other engines never move the number.
    for (let i = 0; i < 5; i += 1) await finished(1, { status: 'failed' });
    for (let i = 0; i < 12; i += 1) await finished(1, { engine: 'seedance-2.5' });
    expect(await typicalWaitMinutes(sql, { engine: 'seedance-2.0', medium: 'video', seconds: template.runtime_seconds })).toBe(7);
    expect(await typicalWaitMinutes(sql, { engine: 'seedance-2.5', medium: 'video', seconds: template.runtime_seconds })).toBe(1);
  });

  it('does not borrow a median from another length', async () => {
    for (let i = 0; i < 12; i += 1) await finished(9);
    expect(await typicalWaitMinutes(sql, { engine: 'seedance-2.0', medium: 'video', seconds: template.runtime_seconds + 5 })).toBe(TYPICAL_WAIT_DEFAULT_MINUTES.video);
  });

  it('answers the default when there is no database or the query fails', async () => {
    expect(await typicalWaitMinutes(null, { engine: 'seedance-2.0', medium: 'video', seconds: 15 })).toBe(5);
    const broken = { query: async () => { throw new Error('down'); } } as unknown as SqlRunner;
    expect(await typicalWaitMinutes(broken, { engine: 'gpt-image-2', medium: 'image', seconds: null })).toBe(2);
  });
});
