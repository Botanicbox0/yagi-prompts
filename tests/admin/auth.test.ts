import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { createDraft } from '../helpers/factory';
import { adminHarness, formOf, viewerOf, type AdminHarness } from '../helpers/admin';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/**
 * PLAN §8 M4 acceptance — "non-admin blocked from every admin action".
 *
 * The test enumerates the REGISTRY rather than a hand-written list, so an operation added later is
 * covered the moment it exists. That is the whole reason `lib/admin/operations.ts` is a registry
 * behind one guarded dispatcher instead of twenty separately-guarded server actions.
 */
describe('admin action auth matrix (§3.7 / §3.8)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('has a registry worth enumerating', () => {
    expect(ADMIN_OPERATION_NAMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ADMIN_OPERATION_NAMES).size).toBe(ADMIN_OPERATION_NAMES.length);
  });

  for (const tier of ['anon', 'free', 'pro'] as const) {
    it(`refuses every operation for a ${tier} viewer`, async () => {
      for (const name of ADMIN_OPERATION_NAMES) {
        const outcome = await dispatchAdmin(name, formOf(name), harness.ctx(viewerOf(tier)));
        expect(outcome.ok, name).toBe(false);
        expect(outcome.ok === false && outcome.code, name).toBe('forbidden');
      }
    });
  }

  it('refuses BEFORE the payload is parsed or anything is written', async () => {
    const draft = await createDraft(harness.db, harness.storage, { slug: 'guarded' });

    // A payload that would otherwise succeed, posted by a Pro user.
    const outcome = await dispatchAdmin(
      'step.create',
      formOf('step.create', {
        revisionId: draft.revisionId,
        titleEn: 'Injected step',
        titleKo: '주입된 스텝',
      }),
      harness.ctx(viewerOf('pro')),
    );
    expect(outcome).toEqual({ ok: false, code: 'forbidden' });

    const { rows } = await harness.db.query<{ n: number }>(
      'select count(*)::int as n from steps where revision_id = $1',
      [draft.revisionId],
    );
    // The fixture's own step, and nothing the Pro viewer posted.
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses an unknown operation without leaking whether it exists', async () => {
    const outcome = await dispatchAdmin('playbook.nuke', formOf('playbook.nuke'), harness.ctx());
    expect(outcome).toMatchObject({ ok: false, code: 'unknownOperation' });
  });

  /**
   * The dispatcher's guard is only trustworthy because the server action resolved the viewer with
   * `requireAdmin()` first, and answers 404 (not 403) when it throws — §3.7's "the admin surface
   * should not confirm its own existence", the same rule the `(admin)` layout follows.
   */
  it('runs requireAdmin() in the server action, and 404s rather than 403s', () => {
    const action = read('app', '(admin)', 'admin', 'actions.ts');
    expect(action).toContain("'use server'");
    expect(action).toContain('requireAdmin');
    expect(action).toContain('notFound()');
    expect(action).toContain('dispatchAdmin');
  });

  it('routes every admin form through the one guarded action', () => {
    // `OpForm` is the only thing in components/admin that may name the server action.
    const chrome = read('components', 'admin', 'chrome.tsx');
    expect(chrome).toContain('action={runAdminOperation}');
    for (const file of ['block-forms.tsx', 'editor-panels.tsx', 'step-editor.tsx']) {
      expect(read('components', 'admin', file), file).not.toContain('runAdminOperation');
    }
  });
});
