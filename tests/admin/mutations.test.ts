import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyPublishManifest, preparePublish, publishRevision } from '@/lib/publish/pipeline';
import { runner } from '../helpers/pglite';
import { createDraft } from '../helpers/factory';
import { adminHarness, expectOk, type AdminHarness } from '../helpers/admin';

/**
 * PLAN §3.8 — "Draft-only writes (the DB triggers enforce it — surface their errors as friendly
 * form errors, don't pre-duplicate every rule client-side)."
 *
 * Every case below reaches the database and is rejected THERE, by the 0003 constraint triggers. The
 * assertion is that the rejection arrives at the form as a classified code rather than a 500 — and
 * that the row is genuinely unchanged, because a friendly message over a successful write would be
 * the worst of both worlds.
 */
describe('draft-only writes surface the trigger, not a crash (§6 / §3.8)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function published(slug: string) {
    const draft = await createDraft(harness.db, harness.storage, {
      slug,
      // Two blocks, so a reorder has a neighbour to swap with and really attempts a write.
      blocks: [
        { kind: 'prompt', content: { text: 'live prompt' } },
        { kind: 'note', content: { md: { en: 'live note', ko: '라이브 노트' } } },
      ],
    });
    const sql = runner(harness.db);
    await preparePublish(sql, draft.revisionId);
    await copyPublishManifest(sql, harness.storage, draft.revisionId);
    await publishRevision(sql, { playbookId: draft.playbookId, revisionId: draft.revisionId });
    return draft;
  }

  it('refuses to add a step to a published revision', async () => {
    const live = await published('locked-steps');
    const outcome = await harness.run('step.create', {
      revisionId: live.revisionId,
      titleEn: 'Sneaky',
      titleKo: '몰래',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'notDraft' });

    const { rows } = await harness.db.query<{ n: number }>(
      'select count(*)::int as n from steps where revision_id = $1',
      [live.revisionId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses to edit a block on a published revision', async () => {
    const live = await published('locked-blocks');
    const outcome = await harness.run('block.update', {
      blockId: live.blockIds[0]!,
      text: 'rewritten after publication',
      visibility: '',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'notDraft' });

    const { rows } = await harness.db.query<{ content: { text: string } }>(
      'select content from blocks where id = $1',
      [live.blockIds[0]],
    );
    expect(rows[0]!.content.text).toBe('live prompt');
  });

  it('refuses to reorder, delete or re-gate published content', async () => {
    const live = await published('locked-order');
    expect(
      await harness.run('block.move', { blockId: live.blockIds[0]!, direction: 'down' }),
    ).toMatchObject({ ok: false, code: 'notDraft' });
    expect(await harness.run('block.delete', { blockId: live.blockIds[0]! })).toMatchObject({
      ok: false,
      code: 'notDraft',
    });
    expect(await harness.run('step.delete', { stepId: live.stepId })).toMatchObject({
      ok: false,
      code: 'notDraft',
    });
    expect(
      await harness.run('block.visibility', { blockId: live.blockIds[0]!, visibility: 'public' }),
    ).toMatchObject({ ok: false, code: 'notDraft' });
  });

  it('refuses to rewrite a published revision’s metadata', async () => {
    const live = await published('locked-metadata');
    const outcome = await harness.run('revision.metadata', {
      revisionId: live.revisionId,
      category: 'video',
      titleEn: 'Rewritten',
      titleKo: '다시',
      summaryEn: 'x',
      summaryKo: 'ㄱ',
      difficulty: 'beginner',
      tools: '',
      models: '',
      isShowcase: 'on',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'notDraft' });
  });

  it('refuses to delete a published revision', async () => {
    const live = await published('locked-delete');
    expect(await harness.run('revision.discardDraft', { revisionId: live.revisionId })).toMatchObject(
      { ok: false, code: 'notDraft' },
    );
  });

  it('discards a DRAFT revision cleanly', async () => {
    const draft = await createDraft(harness.db, harness.storage, { slug: 'discardable' });
    expectOk(await harness.run('revision.discardDraft', { revisionId: draft.revisionId }));
    const { rows } = await harness.db.query<{ n: number }>(
      'select count(*)::int as n from playbook_revisions where id = $1',
      [draft.revisionId],
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe('list-level actions (§3.8)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('creates a playbook together with its rev-1 draft', async () => {
    const outcome = expectOk(
      await harness.run('playbook.create', {
        slug: 'brand-new',
        category: 'character',
        titleEn: 'Brand new',
        titleKo: '새 플레이북',
      }),
    );
    expect(outcome.to).toMatch(/^\/admin\/p\//);

    const { rows } = await harness.db.query<{
      status: string;
      rev_no: number;
      state: string;
      en: string;
    }>(
      `select p.status, r.rev_no, r.state, r.title ->> 'en' as en
         from playbooks p join playbook_revisions r on r.playbook_id = p.id
        where p.slug = 'brand-new'`,
    );
    expect(rows).toEqual([{ status: 'draft', rev_no: 1, state: 'draft', en: 'Brand new' }]);
  });

  /**
   * §6: archiving is a `playbooks.status` change and nothing else. 0003's `guard_playbooks` only
   * reserves `published_revision_id` to the publisher role, so this needs no RPC and no new
   * migration — and the published pointer deliberately survives, which is what
   * `decideEligibility` refuses on.
   */
  it('archives and restores without touching the published pointer', async () => {
    const draft = await createDraft(harness.db, harness.storage, { slug: 'archivable' });
    const sql = runner(harness.db);
    await preparePublish(sql, draft.revisionId);
    await copyPublishManifest(sql, harness.storage, draft.revisionId);
    await publishRevision(sql, { playbookId: draft.playbookId, revisionId: draft.revisionId });

    expectOk(await harness.run('playbook.archive', { playbookId: draft.playbookId, archived: 'true' }));
    let row = await harness.db.query<{ status: string; published_revision_id: string | null }>(
      'select status, published_revision_id from playbooks where id = $1',
      [draft.playbookId],
    );
    expect(row.rows[0]).toEqual({ status: 'archived', published_revision_id: draft.revisionId });

    expectOk(await harness.run('playbook.archive', { playbookId: draft.playbookId, archived: 'false' }));
    row = await harness.db.query('select status, published_revision_id from playbooks where id = $1', [
      draft.playbookId,
    ]);
    expect(row.rows[0]).toEqual({ status: 'published', published_revision_id: draft.revisionId });
  });

  it('restores a never-published playbook to draft, not to published', async () => {
    const draft = await createDraft(harness.db, harness.storage, { slug: 'never-live' });
    expectOk(await harness.run('playbook.archive', { playbookId: draft.playbookId, archived: 'true' }));
    expectOk(await harness.run('playbook.archive', { playbookId: draft.playbookId, archived: 'false' }));
    const { rows } = await harness.db.query<{ status: string }>(
      'select status from playbooks where id = $1',
      [draft.playbookId],
    );
    expect(rows[0]?.status).toBe('draft');
  });

  it('refreshes the catalog cache idempotently (§3.1)', async () => {
    expect(harness.revalidated).toBe(0);
    expectOk(await harness.run('caches.refresh', {}));
    expectOk(await harness.run('caches.refresh', {}));
    expect(harness.revalidated).toBe(2);
  });
});
