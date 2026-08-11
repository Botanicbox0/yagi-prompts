import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shapePlaybook } from '@/lib/content/playbook-access';
import { DEFAULT_POLICY } from '@/lib/content/visibility';
import { copyPublishManifest, preparePublish, publishRevision } from '@/lib/publish/pipeline';
import { buildVisibilityTable, visibilityFingerprint } from '@/lib/admin/visibility-table';
import { loadPolicy, loadRevision } from '@/lib/admin/repo';
import { runner } from '../helpers/pglite';
import { createDraft, stageAsset } from '../helpers/factory';
import { adminHarness, expectOk, viewerOf, type AdminHarness } from '../helpers/admin';

/**
 * PLAN §3.8 — the effective-visibility table, and the rule that gives it meaning:
 *
 *   "/admin/policy: global defaults per kind. **Non-retroactive**: effective visibility stamped at
 *    publish (`resolved_visibility`); republish to apply new policy."
 *
 * §8 M4 acceptance phrases the same thing as "policy edit leaves published output byte-identical",
 * which is why the last test hashes the SHAPED output of the real read path before and after a
 * policy change rather than inspecting a column.
 */
describe('effective-visibility table (§3.8)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function everyKindDraft(slug: string) {
    return createDraft(harness.db, harness.storage, {
      slug,
      blocks: [
        { kind: 'prompt', content: { text: 'p' } },
        { kind: 'params', content: { rows: [{ k: 'steps', v: '30' }] } },
        { kind: 'asset', content: { asset: await stageAsset(harness.storage, slug, `${slug}-a`) } },
        { kind: 'note', content: { md: { en: 'n', ko: '노' } } },
        { kind: 'link', content: { url: 'https://example.com', label: { en: 'l', ko: '링' } } },
        {
          kind: 'workflow_file',
          content: {
            asset: await stageAsset(harness.storage, slug, `${slug}-w`, 'json', 'application/json'),
            filename: 'g.json',
            size_bytes: 2,
            format: 'comfyui',
          },
        },
      ],
    });
  }

  async function table(revisionId: string) {
    const sql = runner(harness.db);
    const revision = await loadRevision(sql, revisionId);
    const policy = await loadPolicy(sql);
    return buildVisibilityTable(revision!, policy);
  }

  it('reports default, override and effective for every kind', async () => {
    const draft = await everyKindDraft('vis-defaults');
    const rows = await table(draft.revisionId);

    expect(rows.map((r) => r.kind)).toEqual([
      'prompt',
      'params',
      'asset',
      'note',
      'link',
      'workflow_file',
    ]);
    for (const row of rows) {
      expect(row.defaultVisibility, row.kind).toBe(DEFAULT_POLICY[row.kind]);
      expect(row.override, row.kind).toBeNull();
      // Inherit ⇒ effective IS the default, and nothing is stamped before prepare.
      expect(row.effective, row.kind).toBe(DEFAULT_POLICY[row.kind]);
      expect(row.stamped, row.kind).toBe(false);
      expect(row.label).toBe(`1.${row.blockOrder}`);
    }
  });

  it('lets the table itself set overrides, and shows them winning', async () => {
    const draft = await everyKindDraft('vis-overrides');
    const rows = await table(draft.revisionId);

    const fields: Record<string, string> = { revisionId: draft.revisionId };
    fields[`v:${rows[0]!.blockId}`] = 'public'; // prompt, normally pro
    fields[`v:${rows[3]!.blockId}`] = 'hidden'; // note, normally free
    expectOk(await harness.run('revision.overrides', fields));

    const after = await table(draft.revisionId);
    expect(after[0]).toMatchObject({ kind: 'prompt', defaultVisibility: 'pro', override: 'public', effective: 'public' });
    expect(after[3]).toMatchObject({ kind: 'note', defaultVisibility: 'free', override: 'hidden', effective: 'hidden' });
    // Untouched rows keep inheriting.
    expect(after[1]).toMatchObject({ override: null, effective: 'pro' });
  });

  it('moves the effective value of INHERITING blocks when policy changes', async () => {
    const draft = await everyKindDraft('vis-policy');
    const rows = await table(draft.revisionId);
    // Pin one block with an explicit override so the two behaviours can be told apart.
    expectOk(
      await harness.run('revision.overrides', {
        revisionId: draft.revisionId,
        [`v:${rows[3]!.blockId}`]: 'free',
      }),
    );

    expectOk(
      await harness.run('policy.update', {
        'p:prompt': 'public',
        'p:params': 'pro',
        'p:asset': 'free',
        'p:note': 'hidden',
        'p:link': 'public',
        'p:workflow_file': 'pro',
      }),
    );

    const after = await table(draft.revisionId);
    // prompt inherits ⇒ follows the new default…
    expect(after[0]).toMatchObject({ defaultVisibility: 'public', override: null, effective: 'public' });
    // …note carries an override ⇒ policy cannot move it, only the DEFAULT column changes.
    expect(after[3]).toMatchObject({ defaultVisibility: 'hidden', override: 'free', effective: 'free' });
  });

  it('shows the STAMPED value once the revision is prepared', async () => {
    const draft = await everyKindDraft('vis-stamped');
    await preparePublish(runner(harness.db), draft.revisionId);

    const prepared = await table(draft.revisionId);
    expect(prepared.every((row) => row.stamped)).toBe(true);
    expect(prepared[0]).toMatchObject({ kind: 'prompt', effective: 'pro' });

    // A policy edit AFTER prepare cannot move the stamp — that is the whole point of stamping.
    expectOk(
      await harness.run('policy.update', {
        'p:prompt': 'public',
        'p:params': 'public',
        'p:asset': 'public',
        'p:note': 'public',
        'p:link': 'public',
        'p:workflow_file': 'public',
      }),
    );
    const after = await table(draft.revisionId);
    expect(after.map((r) => r.effective)).toEqual(prepared.map((r) => r.effective));
    expect(after.map((r) => r.defaultVisibility)).toEqual(Array(6).fill('public'));
  });
});

describe('policy edits are non-retroactive (§3.8 / §8 M4 acceptance)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('leaves published output byte-identical after a policy change', async () => {
    const slug = 'stamped-forever';
    const draft = await createDraft(harness.db, harness.storage, {
      slug,
      isShowcase: true,
      blocks: [
        { kind: 'prompt', content: { text: 'the recipe' } },
        { kind: 'note', content: { md: { en: 'note', ko: '노트' } } },
        { kind: 'link', content: { url: 'https://example.com', label: { en: 'ref', ko: '참고' } } },
      ],
    });

    const sql = runner(harness.db);
    await preparePublish(sql, draft.revisionId);
    await copyPublishManifest(sql, harness.storage, draft.revisionId);
    await publishRevision(sql, { playbookId: draft.playbookId, revisionId: draft.revisionId });

    /** The real read path, hashed. Anything that moves for any viewer moves this string. */
    const shapedHash = async (tier: 'anon' | 'free' | 'pro') => {
      const result = await shapePlaybook({ sql, viewer: viewerOf(tier) }, slug);
      expect(result.status).toBe('ok');
      const payload = JSON.stringify(result.status === 'ok' ? result.playbook : null);
      return createHash('sha256').update(payload).digest('hex');
    };

    const before = {
      anon: await shapedHash('anon'),
      free: await shapedHash('free'),
      pro: await shapedHash('pro'),
      table: visibilityFingerprint(
        buildVisibilityTable((await loadRevision(sql, draft.revisionId))!, await loadPolicy(sql)),
      ),
    };

    // Invert the entire policy through the /admin/policy action.
    expectOk(
      await harness.run('policy.update', {
        'p:prompt': 'public',
        'p:params': 'public',
        'p:asset': 'hidden',
        'p:note': 'hidden',
        'p:link': 'hidden',
        'p:workflow_file': 'public',
      }),
    );

    const after = {
      anon: await shapedHash('anon'),
      free: await shapedHash('free'),
      pro: await shapedHash('pro'),
      table: visibilityFingerprint(
        buildVisibilityTable((await loadRevision(sql, draft.revisionId))!, await loadPolicy(sql)),
      ),
    };

    expect(after).toEqual(before);
  });

  it('DOES apply the new policy to the next publication', async () => {
    const slug = 'policy-applies-next';
    const first = await createDraft(harness.db, harness.storage, {
      slug,
      blocks: [{ kind: 'note', content: { md: { en: 'n', ko: '노' } } }],
    });
    const sql = runner(harness.db);
    await preparePublish(sql, first.revisionId);
    await copyPublishManifest(sql, harness.storage, first.revisionId);
    await publishRevision(sql, { playbookId: first.playbookId, revisionId: first.revisionId });

    expectOk(
      await harness.run('policy.update', {
        'p:prompt': 'pro',
        'p:params': 'pro',
        'p:asset': 'free',
        'p:note': 'pro',
        'p:link': 'public',
        'p:workflow_file': 'pro',
      }),
    );

    expectOk(await harness.run('revision.openDraft', { playbookId: first.playbookId }));
    const { rows } = await harness.db.query<{ id: string }>(
      `select id from playbook_revisions where playbook_id = $1 and state = 'draft'`,
      [first.playbookId],
    );
    await preparePublish(sql, rows[0]!.id);

    const { rows: stamped } = await harness.db.query<{ resolved_visibility: string }>(
      `select b.resolved_visibility from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1`,
      [rows[0]!.id],
    );
    expect(stamped[0]?.resolved_visibility).toBe('pro');

    // …and the still-live revision is untouched.
    const { rows: live } = await harness.db.query<{ resolved_visibility: string }>(
      `select b.resolved_visibility from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1`,
      [first.revisionId],
    );
    expect(live[0]?.resolved_visibility).toBe('free');
  });
});
