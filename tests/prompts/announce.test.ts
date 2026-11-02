import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import { savePreferences } from '@/lib/notify/preferences';
import { verifyUnsubscribeToken } from '@/lib/notify/unsubscribe';
import { loadPromptById, loadPublishedPrompts } from '@/lib/prompts/repo';
import { ADMIN_VIEWER, formOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { FIXTURE_USERS } from '@/scripts/fixtures';

/**
 * The weekly drop's alert (2026-09-13): one press mails everyone with "new templates" on, once;
 * the stamp refuses a second press; only a published template can be announced.
 */
describe('prompt.announce', () => {
  let h: PromptHarness;
  let mailer: FakeMailer;
  let deferred: Array<Promise<void>>;

  const run = (fields: Record<string, string>) =>
    dispatchAdmin('prompt.announce', formOf('prompt.announce', fields), {
      sql: h.sql,
      storage: h.storage,
      viewer: ADMIN_VIEWER,
      mail: { mailer, siteUrl: 'https://twings.test/' },
      defer: (task) => {
        deferred.push(task());
      },
    });

  beforeEach(async () => {
    h = await promptHarness();
    mailer = createFakeMailer();
    deferred = [];
    await savePreferences(h.sql, FIXTURE_USERS.free.id, { newPlaybook: true, updates: false });
    await savePreferences(h.sql, FIXTURE_USERS.pro.id, { newPlaybook: false, updates: true });
  });
  afterEach(async () => {
    await h.close();
  });

  it('mails the new-template subscribers once, stamps the row, and refuses a second press', async () => {
    const template = (await loadPublishedPrompts(h.sql)).find((row) => row.slug === 'neon-alley-dolly')!;
    expect(template.announcedAt).toBeNull();

    const first = await run({ id: template.id });
    expect(first).toMatchObject({ ok: true, code: 'announced', detail: 'neon-alley-dolly' });
    await Promise.all(deferred);

    expect(mailer.sent.map((m) => m.to)).toEqual([FIXTURE_USERS.free.email]);
    const mail = mailer.sent[0]!;
    expect(mail.subject).toContain('New template');
    expect(mail.text).toContain('https://twings.test/en/t/neon-alley-dolly');
    expect(mail.idempotencyKey).toBe(`template:${template.id}:announce:${FIXTURE_USERS.free.id}`);
    const token = new URL(mail.unsubscribeUrl).searchParams.get('t')!;
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: true, claims: { userId: FIXTURE_USERS.free.id, toggle: 'notif_new_playbook' } });

    expect((await loadPromptById(h.sql, template.id))?.announcedAt).not.toBeNull();
    const second = await run({ id: template.id });
    expect(second).toMatchObject({ ok: false, code: 'badTransition' });
    await Promise.all(deferred);
    expect(mailer.sent).toHaveLength(1);
  });

  it('refuses a template that is not published', async () => {
    const { rows } = await h.sql.query<{ id: string }>(`select id from prompt_items where status <> 'published' limit 1`);
    const pending = rows[0]!;
    expect(await run({ id: pending.id })).toMatchObject({ ok: false, code: 'badTransition' });
    expect(mailer.sent).toHaveLength(0);
  });
});
