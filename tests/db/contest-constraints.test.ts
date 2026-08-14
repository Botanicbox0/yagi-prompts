import { describe, expect, it } from 'vitest';
import { expectReject, freshDb, runner } from '../helpers/pglite';

/**
 * PLAN §14.1 — the contest CHECK constraints, probed with DIRECT SQL (M9 review, finding 5).
 *
 * Direct SQL is the point. Every other test in `tests/contests/` goes through the operations layer,
 * which has its own TypeScript gate (`publishBlockers`) — so those tests prove the gate works, not
 * that the database would refuse without it. These statements bypass the gate entirely, which is
 * what a migration applied to a cloud database has to survive: a hand-written `UPDATE`, a future
 * caller, a restored backup.
 *
 * The specific hole the review found: the poster CHECK tested key EXISTENCE (`media ? 'poster'`),
 * which `{"poster": null}` satisfies. A published contest could carry a poster key pointing at
 * nothing, and the card would quietly fall back to the typographic composition.
 */

const BASE = {
  slug: 'probe',
  title: '{"en":"T","ko":"ㅌ"}',
  summary: '{"en":"S","ko":"ㅅ"}',
  prizeTotal: '{"en":"$1","ko":"$1"}',
};

const POSTER = JSON.stringify({
  poster: {
    staging_key: 'content/contest/x/p.png',
    sha256: 'a'.repeat(64),
    published_key: `${'a'.repeat(64)}.png`,
    bucket: 'public-content',
    mime: 'image/png',
  },
});

async function insertPublished(media: string | null, extra: Record<string, string> = {}) {
  const db = await freshDb();
  const sql = runner(db);
  const run = () =>
    sql.query(
      `insert into contests
         (slug, status, title, summary, prize_total, host_name, media, starts_at, deadline_at, published_at)
       values ($1, 'published', $2::jsonb, $3::jsonb, $4::jsonb, 'BRAND', $5::jsonb,
               now() - interval '1 day', now() + interval '1 day', now())`,
      [
        extra.slug ?? BASE.slug,
        extra.title ?? BASE.title,
        extra.summary ?? BASE.summary,
        extra.prizeTotal ?? BASE.prizeTotal,
        media,
      ],
    );
  return { db, sql, run };
}

describe('contests_published_requires_poster (§14.2)', () => {
  it('accepts a poster that is actually servable', async () => {
    const { db, run } = await insertPublished(POSTER);
    await expect(run()).resolves.toBeDefined();
    await db.close();
  });

  it('refuses `media` that is NULL entirely', async () => {
    const { db, run } = await insertPublished(null);
    const message = await expectReject(run);
    expect(message).toContain('contests_published_requires_poster');
    await db.close();
  });

  /** The exact hole the review found: a key that exists and points at nothing. */
  it('refuses {"poster": null}', async () => {
    const { db, run } = await insertPublished('{"poster": null}');
    expect(await expectReject(run)).toContain('contests_published_requires_poster');
    await db.close();
  });

  it('refuses a poster that is not an object', async () => {
    for (const media of ['{"poster": "a.png"}', '{"poster": []}', '{"poster": 3}']) {
      const { db, run } = await insertPublished(media);
      expect(await expectReject(run), media).toContain('contests_published_requires_poster');
      await db.close();
    }
  });

  /** Staged but never copied — the state a draft's poster is in, and it must not publish. */
  it('refuses a poster with no published_key', async () => {
    const media = JSON.stringify({
      poster: { staging_key: 'content/contest/x/p.png', sha256: 'a'.repeat(64), mime: 'image/png' },
    });
    const { db, run } = await insertPublished(media);
    expect(await expectReject(run)).toContain('contests_published_requires_poster');
    await db.close();
  });

  it('refuses a blank published_key', async () => {
    const media = JSON.stringify({
      poster: {
        staging_key: 'k.png',
        sha256: 'a'.repeat(64),
        published_key: '   ',
        bucket: 'public-content',
        mime: 'image/png',
      },
    });
    const { db, run } = await insertPublished(media);
    expect(await expectReject(run)).toContain('contests_published_requires_poster');
    await db.close();
  });

  /** A private bucket is not the public marketing surface a card is served from. */
  it('refuses a poster copied into a PRIVATE bucket', async () => {
    const media = JSON.stringify({
      poster: {
        staging_key: 'k.png',
        sha256: 'a'.repeat(64),
        published_key: `${'a'.repeat(64)}.png`,
        bucket: 'content-published',
        mime: 'image/png',
      },
    });
    const { db, run } = await insertPublished(media);
    expect(await expectReject(run)).toContain('contests_published_requires_poster');
    await db.close();
  });

  it('lets a DRAFT hold a staged poster, or none at all', async () => {
    const db = await freshDb();
    const sql = runner(db);
    for (const [slug, media] of [
      ['draft-none', null],
      ['draft-staged', JSON.stringify({ poster: { staging_key: 'k.png', sha256: 'a'.repeat(64), mime: 'image/png' } })],
      ['draft-null-poster', '{"poster": null}'],
    ] as const) {
      await expect(
        sql.query(
          `insert into contests (slug, status, title, summary, prize_total, host_name, media)
           values ($1, 'draft', $2::jsonb, $2::jsonb, $2::jsonb, 'BRAND', $3::jsonb)`,
          [slug, BASE.title, media],
        ),
        slug,
      ).resolves.toBeDefined();
    }
    await db.close();
  });
});

describe('the other published-contest gates (§14.1)', () => {
  it('refuses a published contest missing a locale', async () => {
    const { db, run } = await insertPublished(POSTER, { prizeTotal: '{"en":"$1","ko":""}' });
    expect(await expectReject(run)).toContain('contests_published_requires_localized');
    await db.close();
  });

  it('refuses a published contest with no dates', async () => {
    const db = await freshDb();
    const sql = runner(db);
    const message = await expectReject(() =>
      sql.query(
        `insert into contests
           (slug, status, title, summary, prize_total, host_name, media, published_at)
         values ('undated', 'published', $1::jsonb, $1::jsonb, $1::jsonb, 'BRAND', $2::jsonb, now())`,
        [BASE.title, POSTER],
      ),
    );
    expect(message).toContain('contests_published_requires_dates');
    await db.close();
  });
});

describe('contest_entries constraints (§14.1)', () => {
  async function contestId(sql: ReturnType<typeof runner>): Promise<string> {
    const { rows } = await sql.query<{ id: string }>(
      `insert into contests (slug, status, title, summary, prize_total, host_name)
       values ('probe', 'draft', $1::jsonb, $1::jsonb, $1::jsonb, 'BRAND') returning id`,
      [BASE.title],
    );
    return rows[0]!.id;
  }

  async function withEntry() {
    const db = await freshDb();
    const sql = runner(db);
    await sql.query('insert into auth.users (id) values ($1)', [
      'f0000000-0000-4000-8000-000000000001',
    ]);
    await sql.query(
      `insert into profiles (id, email, locale, plan, is_admin)
       values ($1, 'e@x.test', 'en', 'free', false)`,
      ['f0000000-0000-4000-8000-000000000001'],
    );
    return { db, sql, contest: await contestId(sql), author: 'f0000000-0000-4000-8000-000000000001' };
  }

  const insert = (
    sql: ReturnType<typeof runner>,
    contest: string,
    author: string,
    values: Record<string, unknown> = {},
  ) =>
    sql.query(
      `insert into contest_entries
         (contest_id, author_id, title, video_url, sns_url, note, status, placement, reject_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        contest,
        author,
        values.title ?? 'Film',
        values.videoUrl ?? 'https://vimeo.com/1',
        values.snsUrl ?? 'https://instagram.com/a',
        values.note ?? null,
        values.status ?? 'pending',
        values.placement ?? null,
        values.rejectReason ?? null,
      ],
    );

  it('refuses a non-http(s) film or SNS link', async () => {
    const { db, sql, contest, author } = await withEntry();
    expect(
      await expectReject(() => insert(sql, contest, author, { videoUrl: 'javascript:alert(1)' })),
    ).toContain('contest_entries_video_url_http');
    expect(
      await expectReject(() => insert(sql, contest, author, { snsUrl: 'ftp://x/y' })),
    ).toContain('contest_entries_sns_url_http');
    await db.close();
  });

  /**
   * The case-sensitivity the normalisation in `lib/contests/schemas.ts` exists to prevent (M9
   * review, finding 8): the DB regex is anchored on lowercase, so an unnormalised `HTTPS://` would
   * be refused here — which is why the zod transform emits `url.href`.
   */
  it('refuses an upper-case scheme, which is why the boundary normalises it', async () => {
    const { db, sql, contest, author } = await withEntry();
    expect(
      await expectReject(() => insert(sql, contest, author, { videoUrl: 'HTTPS://vimeo.com/1' })),
    ).toContain('contest_entries_video_url_http');
    await db.close();
  });

  it('refuses a note over 300 characters', async () => {
    const { db, sql, contest, author } = await withEntry();
    expect(
      await expectReject(() => insert(sql, contest, author, { note: 'x'.repeat(301) })),
    ).toContain('contest_entries_note_len');
    await db.close();
  });

  it('refuses a rejection with no reason, and a placement on an unapproved entry', async () => {
    const { db, sql, contest, author } = await withEntry();
    expect(
      await expectReject(() => insert(sql, contest, author, { status: 'rejected' })),
    ).toContain('contest_entries_reject_reason_present');
    expect(
      await expectReject(() => insert(sql, contest, author, { status: 'pending', placement: 1 })),
    ).toContain('contest_entries_placement_approved');
    await db.close();
  });

  it('refuses a fourth place and a duplicate podium step', async () => {
    const { db, sql, contest, author } = await withEntry();
    expect(
      await expectReject(() =>
        insert(sql, contest, author, { status: 'approved', placement: 4 }),
      ),
    ).toContain('contest_entries_placement_range');

    await insert(sql, contest, author, { status: 'approved', placement: 1 });
    await sql.query('insert into auth.users (id) values ($1)', [
      'f0000000-0000-4000-8000-000000000002',
    ]);
    await sql.query(
      `insert into profiles (id, email, locale, plan, is_admin)
       values ($1, 'b@x.test', 'en', 'free', false)`,
      ['f0000000-0000-4000-8000-000000000002'],
    );
    expect(
      await expectReject(() =>
        insert(sql, contest, 'f0000000-0000-4000-8000-000000000002', {
          status: 'approved',
          placement: 1,
        }),
      ),
    ).toContain('uq_contest_entries_placement');
    await db.close();
  });

  it('refuses a second entry from the same author (§14.1 one per user)', async () => {
    const { db, sql, contest, author } = await withEntry();
    await insert(sql, contest, author);
    expect(await expectReject(() => insert(sql, contest, author))).toContain('duplicate key');
    await db.close();
  });
});

describe('profiles.sns_url (§14.1)', () => {
  it('accepts null and http(s), refuses anything else', async () => {
    const db = await freshDb();
    const sql = runner(db);
    await sql.query('insert into auth.users (id) values ($1)', [
      'f0000000-0000-4000-8000-000000000009',
    ]);
    await sql.query(
      `insert into profiles (id, email, locale, plan, is_admin)
       values ($1, 'c@x.test', 'en', 'free', false)`,
      ['f0000000-0000-4000-8000-000000000009'],
    );
    await expect(
      sql.query('update profiles set sns_url = $1 where id = $2', [
        'https://instagram.com/a',
        'f0000000-0000-4000-8000-000000000009',
      ]),
    ).resolves.toBeDefined();
    expect(
      await expectReject(() =>
        sql.query('update profiles set sns_url = $1 where id = $2', [
          'javascript:alert(1)',
          'f0000000-0000-4000-8000-000000000009',
        ]),
      ),
    ).toContain('profiles_sns_url_http');
    await db.close();
  });
});
