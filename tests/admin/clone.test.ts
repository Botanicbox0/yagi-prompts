import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preparePublish, copyPublishManifest, publishRevision } from '@/lib/publish/pipeline';
import { runner } from '../helpers/pglite';
import { createDraft, stageAsset } from '../helpers/factory';
import { adminHarness, expectOk, type AdminHarness } from '../helpers/admin';

/**
 * PLAN §3.8 — "'Edit published playbook' creates/opens the draft clone (revision cloning: copy
 * revision + steps + blocks + re-key assets by copying staging objects to the new revision's
 * namespace — sha256 unchanged)".
 *
 * The load-bearing assertion is the last one: the SOURCE revision is byte-identical afterwards.
 * A clone that shared a staging object with the live revision would mean editing a draft could
 * change what is currently being served, which is exactly what the whole revision model exists to
 * make impossible.
 */
describe('revision cloning (§3.8)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function publishedFixture(slug: string) {
    const draft = await createDraft(harness.db, harness.storage, {
      slug,
      withHero: true,
      blocks: [
        { kind: 'prompt', visibility: 'pro', content: { text: 'source prompt' } },
        { kind: 'note', content: { md: { en: 'note en', ko: '노트' } } },
        {
          kind: 'asset',
          visibility: 'public',
          content: { asset: await stageAsset(harness.storage, 'placeholder', `${slug}-a`) },
        },
      ],
    });
    // Re-stage the asset under the real revision id so the manifest has real bytes behind it.
    const asset = await stageAsset(harness.storage, draft.revisionId, `${slug}-a`);
    await harness.db.query(
      `update blocks set content = jsonb_build_object('asset', $2::jsonb) where id = $1`,
      [draft.blockIds[2], JSON.stringify(asset)],
    );

    const sql = runner(harness.db);
    await preparePublish(sql, draft.revisionId);
    await copyPublishManifest(sql, harness.storage, draft.revisionId);
    await publishRevision(sql, { playbookId: draft.playbookId, revisionId: draft.revisionId });
    return draft;
  }

  interface Snapshot {
    revision: unknown;
    steps: unknown;
    blocks: unknown;
  }

  async function snapshot(revisionId: string): Promise<Snapshot> {
    const revision = await harness.db.query(
      `select rev_no, state, is_showcase, title, summary, difficulty, tools, models,
              est_time_min, est_cost_usd, hero_asset, change_note, published_at
         from playbook_revisions where id = $1`,
      [revisionId],
    );
    const steps = await harness.db.query(
      `select id, "order", title, body from steps where revision_id = $1 order by "order"`,
      [revisionId],
    );
    const blocks = await harness.db.query(
      `select b.id, b."order", b.kind, b.content, b.visibility, b.resolved_visibility
         from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1 order by s."order", b."order"`,
      [revisionId],
    );
    return { revision: revision.rows, steps: steps.rows, blocks: blocks.rows };
  }

  it('clones steps, blocks and assets with new ids and new staging keys', async () => {
    const source = await publishedFixture('cloneable');
    const before = await snapshot(source.revisionId);

    expectOk(await harness.run('revision.openDraft', { playbookId: source.playbookId }));

    const { rows: drafts } = await harness.db.query<{ id: string; rev_no: number; state: string }>(
      `select id, rev_no, state from playbook_revisions
        where playbook_id = $1 and state = 'draft'`,
      [source.playbookId],
    );
    expect(drafts).toHaveLength(1);
    const clone = drafts[0]!;
    expect(clone.rev_no).toBe(2);

    // --- structure carried over, identity not -----------------------------
    const { rows: cloneSteps } = await harness.db.query<{ id: string; order: number }>(
      `select id, "order" from steps where revision_id = $1 order by "order"`,
      [clone.id],
    );
    expect(cloneSteps).toHaveLength(1);
    expect(cloneSteps[0]!.id).not.toBe(source.stepId);

    const { rows: cloneBlocks } = await harness.db.query<{
      id: string;
      order: number;
      kind: string;
      content: Record<string, unknown>;
      visibility: string | null;
      resolved_visibility: string | null;
    }>(
      `select b.id, b."order", b.kind, b.content, b.visibility, b.resolved_visibility
         from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1 order by b."order"`,
      [clone.id],
    );
    expect(cloneBlocks.map((b) => b.kind)).toEqual(['prompt', 'note', 'asset']);
    expect(cloneBlocks.map((b) => b.visibility)).toEqual(['pro', null, 'public']);
    for (const block of cloneBlocks) {
      expect(source.blockIds).not.toContain(block.id);
      // Stamping belongs to prepare_publish; a clone is unstamped.
      expect(block.resolved_visibility).toBeNull();
    }

    // --- assets re-keyed, hashes preserved, published keys dropped --------
    const sourceAsset = (
      await harness.db.query<{ content: { asset: { staging_key: string; sha256: string; published_key?: string } } }>(
        'select content from blocks where id = $1',
        [source.blockIds[2]],
      )
    ).rows[0]!.content.asset;
    const cloneAsset = cloneBlocks[2]!.content.asset as {
      staging_key: string;
      sha256: string;
      published_key?: string;
      bucket?: string;
    };

    expect(cloneAsset.sha256).toBe(sourceAsset.sha256);
    expect(cloneAsset.staging_key).not.toBe(sourceAsset.staging_key);
    expect(cloneAsset.staging_key.startsWith(`content/rev/${clone.id}/`)).toBe(true);
    expect(cloneAsset.published_key).toBeUndefined();
    expect(cloneAsset.bucket).toBeUndefined();

    // the bytes really were copied, and they are the same bytes
    const cloneBytes = await harness.storage.read('content', cloneAsset.staging_key);
    const sourceBytes = await harness.storage.read('content', sourceAsset.staging_key);
    expect(new TextDecoder().decode(cloneBytes)).toBe(new TextDecoder().decode(sourceBytes));

    // hero too
    const { rows: heroRows } = await harness.db.query<{
      hero_asset: { staging_key: string; sha256: string; published_key?: string };
    }>('select hero_asset from playbook_revisions where id = $1', [clone.id]);
    expect(heroRows[0]!.hero_asset.staging_key.startsWith(`content/rev/${clone.id}/`)).toBe(true);
    expect(heroRows[0]!.hero_asset.published_key).toBeUndefined();

    // --- change note starts empty: republishing must earn a NEW one -------
    const { rows: noteRows } = await harness.db.query<{ change_note: unknown }>(
      'select change_note from playbook_revisions where id = $1',
      [clone.id],
    );
    expect(noteRows[0]!.change_note).toBeNull();

    // --- and the source is untouched --------------------------------------
    expect(await snapshot(source.revisionId)).toEqual(before);
  });

  it('editing the clone cannot reach the published revision', async () => {
    const source = await publishedFixture('isolated');
    expectOk(await harness.run('revision.openDraft', { playbookId: source.playbookId }));
    const { rows } = await harness.db.query<{ id: string }>(
      `select id from playbook_revisions where playbook_id = $1 and state = 'draft'`,
      [source.playbookId],
    );
    const before = await snapshot(source.revisionId);

    expectOk(
      await harness.run('revision.metadata', {
        revisionId: rows[0]!.id,
        category: 'video',
        titleEn: 'Rewritten',
        titleKo: '다시 씀',
        summaryEn: 'New summary',
        summaryKo: '새 요약',
        difficulty: 'advanced',
        tools: 'ComfyUI, ffmpeg',
        models: 'Kling 3.0',
        estTimeMin: '90',
        estCostUsd: '4.5',
        isShowcase: 'on',
      }),
    );

    expect(await snapshot(source.revisionId)).toEqual(before);
  });

  it('opens the existing draft instead of cloning a second one', async () => {
    const source = await publishedFixture('once-only');
    expectOk(await harness.run('revision.openDraft', { playbookId: source.playbookId }));
    const second = expectOk(await harness.run('revision.openDraft', { playbookId: source.playbookId }));
    expect(second.detail).toBe('existing');

    const { rows } = await harness.db.query<{ n: number }>(
      `select count(*)::int as n from playbook_revisions where playbook_id = $1 and state = 'draft'`,
      [source.playbookId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
