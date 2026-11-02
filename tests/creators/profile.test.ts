import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingDb, seedProfile, type BillingHarness } from '@/tests/helpers/billing';
import { loadCreatorProfile, saveCreatorDisplayName, socialLinkHref } from '@/lib/creators/profile';

describe('private creator profile', () => {
  let h: BillingHarness;
  const owner = 'f1000000-0000-4000-8000-000000000001';
  const other = 'f1000000-0000-4000-8000-000000000002';
  beforeAll(async () => { h = await billingDb(); await seedProfile(h.sql, { id: owner }); await seedProfile(h.sql, { id: other }); });
  afterAll(async () => { await h?.close(); });
  it('edits the owner name without changing the SNS, email or privileges', async () => {
    await h.sql.query('update profiles set sns_url=$2 where id=$1', [owner, 'https://instagram.com/fixture-creator']);
    expect(await saveCreatorDisplayName(h.sql, owner, '  활동 이름  ')).toBe(true);
    expect(await loadCreatorProfile(h.sql, owner)).toEqual({ displayName: '활동 이름', snsUrl: 'https://instagram.com/fixture-creator' });
    expect((await loadCreatorProfile(h.sql, other))?.displayName).toBeNull();
    const row = (await h.sql.query<{ is_admin: boolean; email: string }>('select is_admin,email from profiles where id=$1', [owner])).rows[0]!;
    expect(row.is_admin).toBe(false);
    expect(row.email).toBe(`${owner}@playbook.test`);
  });
  it('rejects empty, oversized and control-character names', async () => {
    for (const name of ['', '  ', 'a'.repeat(81), 'name\u0000', 'name\nother']) expect(await saveCreatorDisplayName(h.sql, owner, name)).toBe(false);
  });
  it('never creates an account for a missing identity', async () => {
    expect(await saveCreatorDisplayName(h.sql, 'f1000000-0000-4000-8000-000000000003', 'Name')).toBe(false);
  });
  it('never renders a stored JavaScript or credential-bearing link', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'https://secret@example.com/', 'http://instagram.com/name']) expect(socialLinkHref(value)).toBeNull();
    expect(socialLinkHref('https://instagram.com/fixture')).toBe('https://instagram.com/fixture');
  });
});
