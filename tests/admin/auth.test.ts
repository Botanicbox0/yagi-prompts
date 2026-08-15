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
   * The dispatcher's guard is only trustworthy because the DOOR resolved the viewer with
   * `requireAdmin()` first, and answers 404 (not 403) when it throws — §3.7's "the admin surface
   * should not confirm its own existence", the same rule the `(admin)` layout follows.
   *
   * 2026-08-14: the door is now `POST /admin/do`, a route handler, because a server action is
   * addressed by a build-scoped id and the founder's long-lived admin tab kept posting an id the
   * newest deployment no longer knew — a save that answered with a bare re-render. A URL survives
   * deployment. The guard, the dispatcher and the outcome codes did not change; its address did.
   */
  it('runs requireAdmin() in the one door, and 404s rather than 403s', () => {
    const route = read('app', '(admin)', 'admin', 'do', 'route.ts');
    expect(route).toContain('export async function POST');
    expect(route).toContain('requireAdmin');
    expect(route).toContain('notFound()');
    expect(route).toContain('dispatchAdmin');
    // A route handler has no built-in origin check, so it states one.
    expect(route).toContain('sec-fetch-site');
    // …and a redirect that turns the POST into a GET, so refresh never re-runs the mutation.
    expect(route).toContain('303');
  });

  /**
   * The upload-signing endpoint (2026-08-15) hands the BROWSER a URL that can write into the
   * staging bucket, so it is a door in its own right and wears the same guard: admin first, 404
   * rather than 403, same-origin, and a key the server mints rather than one the caller names.
   */
  it('guards the signed-upload endpoint exactly like the mutation door', () => {
    const route = read('app', 'api', 'admin', 'staging-url', 'route.ts');
    expect(route).toContain('export async function POST');
    expect(route).toContain('requireAdmin');
    expect(route).toContain('notFound()');
    expect(route).toContain('sec-fetch-site');
    // The caps are re-applied server-side: the client is not trusted about its own file.
    expect(route).toContain('checkUpload');
    // The key is minted here, never read off the request.
    expect(route).toContain('directUploadKey');
    expect(route).not.toMatch(/input\.key|body\.key/);
  });

  it('routes every admin form through that one door', () => {
    const chrome = read('components', 'admin', 'chrome.tsx');
    expect(chrome).toContain('method="post"');
    expect(chrome).toContain('action={ADMIN_ACTION_PATH}');
    expect(chrome).toContain('encType="multipart/form-data"');
    // No panel may name the door or post on its own — `OpForm` is the only writer.
    for (const file of ['block-forms.tsx', 'editor-panels.tsx', 'step-editor.tsx']) {
      const source = read('components', 'admin', file);
      expect(source, file).not.toContain('ADMIN_ACTION_PATH');
      expect(source, file).not.toContain('method="post"');
    }
  });
});
