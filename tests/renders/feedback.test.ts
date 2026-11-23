import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { EmailMessage, Mailer, SendOutcome } from '@/lib/notify/mailer';
import { insertRenderJob, markRenderFailed } from '@/lib/renders/repo';
import { countRenderFeedback, listRenderFeedback, notifyRenderFeedback, submitRenderFeedback, updateRenderFeedbackStatus } from '@/lib/renders/feedback';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * Feedback on a result (2026-09-11) against a real PGlite: only the owner of a finished render may
 * write, a second write replaces the first and reopens it, the inbox row carries what the studio
 * needs, and the alert mail names the template and the person.
 */

const VIDEO_TEMPLATE = 'neon-alley-dolly'; // video · seedance-2.0 (scripts/prompt-fixtures.ts)
const OWNER: Viewer = ADMIN_VIEWER;
const OTHER: Viewer = viewerOf('pro');
const ANON: Viewer = { tier: 'anon', userId: null, email: null, isAdmin: false, locale: null };

function capturingMailer(): { mailer: Mailer; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const mailer: Mailer = {
    kind: 'fake',
    from: 'hello@twings.test',
    async send(message): Promise<SendOutcome> {
      sent.push(message);
      return { ok: true, id: `m${sent.length}` };
    },
  };
  return { mailer, sent };
}

describe('render feedback', () => {
  let h: PromptHarness;
  let renderId: string;

  beforeEach(async () => {
    h = await promptHarness();
    const { rows } = await h.sql.query<{ id: string }>('select id from prompt_items where slug = $1', [VIDEO_TEMPLATE]);
    const templateId = rows[0]?.id;
    if (!templateId) throw new Error('fixture template missing');
    renderId = randomUUID();
    await insertRenderJob(h.sql, {
      id: renderId,
      userId: OWNER.userId!,
      templateId,
      templateSlug: VIDEO_TEMPLATE,
      medium: 'video',
      engine: 'seedance-2.0',
      aspect: '9:16',
      locale: 'ko',
      inputKey: null,
      inputMime: null,
    });
    // Feedback is allowed on a failed render too — "it never came out" is the loudest complaint.
    await markRenderFailed(h.sql, renderId, { code: 'engine_error', message: 'boom', finishedAt: new Date() });
  });
  afterEach(async () => {
    await h.close();
  });

  it('lets only the owner write, and only with a known reason', async () => {
    expect(await submitRenderFeedback({ sql: h.sql }, ANON, renderId, { reason: 'face' })).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await submitRenderFeedback({ sql: h.sql }, OTHER, renderId, { reason: 'face' })).toEqual({ ok: false, code: 'not_found' });
    expect(await submitRenderFeedback({ sql: h.sql }, OWNER, renderId, { reason: 'meh' })).toEqual({ ok: false, code: 'invalid' });
    expect(await countRenderFeedback(h.sql, 'new')).toBe(0);
  });

  it('stores the owner’s words, replaces them on a second write, and reopens the row', async () => {
    const first = await submitRenderFeedback({ sql: h.sql }, OWNER, renderId, { reason: 'face', message: '  눈이 달라요  ' });
    if (!first.ok) throw new Error('expected ok');
    expect(first.feedback.message).toBe('눈이 달라요');
    expect(first.templateTitle.length).toBeGreaterThan(0);

    expect(await updateRenderFeedbackStatus(h.sql, first.feedback.id, 'replied')).toBe(true);
    const second = await submitRenderFeedback({ sql: h.sql }, OWNER, renderId, { reason: 'playback', message: '' });
    if (!second.ok) throw new Error('expected ok');
    expect(second.feedback.id).toBe(first.feedback.id);
    expect(second.feedback.reason).toBe('playback');
    expect(second.feedback.message).toBeNull();
    expect(second.feedback.status).toBe('new');
    expect(second.feedback.repliedAt).not.toBeNull();

    const rows = await listRenderFeedback(h.sql, { statuses: ['new'], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.templateSlug).toBe(VIDEO_TEMPLATE);
    expect(rows[0]?.renderStatus).toBe('failed');
    expect(rows[0]?.email).toBe(OWNER.email);
    expect(await countRenderFeedback(h.sql, 'new')).toBe(1);
    expect(await updateRenderFeedbackStatus(h.sql, '00000000-0000-4000-8000-000000000000', 'closed')).toBe(false);
  });

  it('mails the studio with the template, the person and their words, escaped', async () => {
    const result = await submitRenderFeedback({ sql: h.sql }, OWNER, renderId, { reason: 'mismatch', message: '예시랑 너무 달라요 <b>' });
    if (!result.ok) throw new Error('expected ok');
    const { mailer, sent } = capturingMailer();
    const outcome = await notifyRenderFeedback({ mailer, siteUrl: 'https://twings.app/', siteName: 'TWINGS' }, result.feedback, { templateTitle: result.templateTitle, email: OWNER.email });
    expect(outcome?.ok).toBe(true);
    expect(sent[0]?.to).toBe('hello@yagiworkshop.xyz');
    expect(sent[0]?.subject).toContain(result.templateTitle);
    expect(sent[0]?.text).toContain(OWNER.email!);
    expect(sent[0]?.text).toContain('https://admin.twings.app/admin/inquiries');
    expect(sent[0]?.html).toContain('&lt;b&gt;');
    expect(sent[0]?.idempotencyKey).toBe(`render-feedback:${result.feedback.id}:${result.feedback.updatedAt}`);
    expect(await notifyRenderFeedback({ mailer: null, siteUrl: 'https://twings.app', siteName: 'TWINGS' }, result.feedback, { templateTitle: 'x', email: null })).toBeNull();
  });
});
