import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { memberUsage } from '@/lib/brand-studio/member-usage';
import { usedKrwIn, studioMonthWindow } from '@/lib/brand-studio/usage';
import { usageLines } from '@/components/brand-workspace/rail-usage';
import { studioFixture, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-STUDIO-V3.md §3 — the team page's monthly credits per member: same month and same filter
 * as the allowance (Korea-time calendar month, settled amount or the estimate, failed and canceled
 * excluded), grouped by who started the job; names follow the member list's privacy rule.
 */
let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
});

async function job(sql: SqlRunner, orgId: string, by: string | null, createdAt: string, status: string, estimate: number, usage: number | null = null) {
  const finished = ['succeeded', 'failed', 'canceled'].includes(status) ? createdAt : null;
  await sql.query(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, estimate_krw, usage_krw, created_at, finished_at)
      values ($1, $2, $3, 'image', $4, 'seedream-5-pro', $5, $6, $7, $8)`,
    [orgId, by, `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`, status, estimate, usage, createdAt, finished],
  );
}

describe('memberUsage', () => {
  it('sums each member in the Korea-time month exactly like the allowance does', async () => {
    f = await studioFixture();
    const { sql, orgId, ids } = f;
    // "Now" is 2026-11-15 12:00 KST. The month runs from 2026-10-31T15:00Z to 2026-11-30T15:00Z.
    const now = new Date('2026-11-15T03:00:00Z');
    await job(sql, orgId, ids.owner, '2026-11-02T00:00:00Z', 'succeeded', 1000, 1200); // settled replaces the estimate
    await job(sql, orgId, ids.owner, '2026-11-03T00:00:00Z', 'running', 800); // open: the reservation counts
    await job(sql, orgId, ids.owner, '2026-11-04T00:00:00Z', 'failed', 5000); // excluded
    await job(sql, orgId, ids.editor, '2026-10-31T15:30:00Z', 'succeeded', 300, 300); // 1 Nov 00:30 KST: this month
    await job(sql, orgId, ids.editor, '2026-10-31T14:30:00Z', 'succeeded', 9000, 9000); // 31 Oct 23:30 KST: last month
    await job(sql, orgId, ids.editor, '2026-11-05T00:00:00Z', 'canceled', 7000); // excluded
    await job(sql, orgId, ids.viewer, '2026-11-30T15:00:00Z', 'succeeded', 4000, 4000); // 1 Dec KST: next month
    await job(sql, orgId, null, '2026-11-06T00:00:00Z', 'succeeded', 50, 50); // the author's profile is gone

    const rows = await memberUsage(sql, orgId, now);
    expect(rows).toEqual([
      { userId: ids.owner, email: 'owner@example.test', displayName: null, usedKrw: 2000, runs: 2 },
      { userId: ids.editor, email: 'editor@example.test', displayName: null, usedKrw: 300, runs: 1 },
      { userId: null, email: null, displayName: null, usedKrw: 50, runs: 1 },
    ]);
    expect(rows.reduce((sum, r) => sum + r.usedKrw, 0)).toBe(await usedKrwIn(sql, orgId, studioMonthWindow(now)));
  });

  it('reads another organization as nothing', async () => {
    f = await studioFixture();
    await job(f.sql, f.orgId, f.ids.owner, new Date().toISOString(), 'succeeded', 100, 100);
    expect(await memberUsage(f.sql, randomUUID())).toEqual([]);
  });
});

describe('usageLines (what the team page shows)', () => {
  const rows = [
    { userId: 'u-self', email: 'me@brand.test', displayName: 'Me', usedKrw: 3000, runs: 3 },
    { userId: 'u-owner2', email: 'other-owner@brand.test', displayName: 'Other Owner', usedKrw: 1000, runs: 1 },
    { userId: 'u-gone', email: 'gone@brand.test', displayName: null, usedKrw: 999, runs: 2 },
    { userId: null, email: null, displayName: null, usedKrw: 1, runs: 1 },
  ];
  const members = [
    { userId: 'u-self', email: 'me@brand.test' },
    // Another owner: the member list already hides the address.
    { userId: 'u-owner2', email: null },
  ];

  it('never shows an address the member list hides, nor names people who left', () => {
    const lines = usageLines(rows, members, { otherOwner: '다른 관리자', formerMember: '이전 멤버' });
    expect(lines.map((l) => [l.name, l.detail])).toEqual([
      ['Me', 'me@brand.test'],
      ['다른 관리자', null],
      ['이전 멤버', null],
      ['이전 멤버', null],
    ]);
    const text = JSON.stringify(lines);
    for (const hidden of ['other-owner@brand.test', 'Other Owner', 'gone@brand.test']) expect(text).not.toContain(hidden);
  });

  it('turns KRW into credits (rounded up) and shares into fractions of the team', () => {
    const lines = usageLines(rows, members, { otherOwner: 'x', formerMember: 'y' });
    expect(lines.map((l) => l.credits)).toEqual([300, 100, 100, 1]);
    expect(lines[0]!.share).toBeCloseTo(3000 / 5000);
    expect(lines.reduce((sum, l) => sum + l.share, 0)).toBeCloseTo(1);
    expect(usageLines([], members, { otherOwner: 'x', formerMember: 'y' })).toEqual([]);
  });
});
