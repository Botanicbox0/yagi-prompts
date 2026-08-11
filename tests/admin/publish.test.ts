import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminHarness, expectOk, upload, type AdminHarness } from '../helpers/admin';
import { createDraft, stageAsset } from '../helpers/factory';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * PLAN §8 M4 acceptance — "RPC + trigger guards from M0 re-verified THROUGH THE UI PATH".
 *
 * Every publish here goes through the same `revision.publish` operation the editor's button posts:
 * no test calls `publish_revision` directly. What is being verified is that the admin path reaches
 * the real three-phase pipeline (§6) and that the RPC's refusals arrive as usable form errors.
 */
describe('publish through the UI-path server action (§3.8 / §6)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function draftWithAssets(slug: string, isShowcase = false) {
    const draft = await createDraft(harness.db, harness.storage, {
      slug,
      isShowcase,
      withHero: true,
      blocks: [
        { kind: 'prompt', content: { text: 'the prompt' } },
        { kind: 'note', content: { md: { en: 'a note', ko: '노트' } } },
      ],
    });
    // One asset block created the way the editor creates it: uploaded, hashed server-side.
    expectOk(
      await harness.run('block.create', {
        stepId: draft.stepId,
        kind: 'asset',
        file: upload('frame.png', 'FRAME-BYTES'),
        captionEn: 'Frame',
        captionKo: '프레임',
      }),
    );
    return draft;
  }

  it('runs prepare → copy → publish and swaps the pointer', async () => {
    const draft = await draftWithAssets('ui-publish');

    const outcome = expectOk(
      await harness.run('revision.publish', {
        playbookId: draft.playbookId,
        revisionId: draft.revisionId,
        mode: 'full',
      }),
    );
    expect(outcome.code).toBe('published');
    expect(outcome.detail).toContain('ui-publish');

    const { rows } = await harness.db.query<{
      status: string;
      published_revision_id: string;
      state: string;
      published_at: Date | null;
    }>(
      `select p.status, p.published_revision_id, r.state, r.published_at
         from playbooks p join playbook_revisions r on r.id = p.published_revision_id
        where p.id = $1`,
      [draft.playbookId],
    );
    expect(rows[0]).toMatchObject({
      status: 'published',
      published_revision_id: draft.revisionId,
      state: 'published',
    });
    expect(rows[0]!.published_at).not.toBeNull();

    // Every referenced object is in the manifest and physically copied…
    const { rows: manifest } = await harness.db.query<{
      ref: string;
      target_bucket: string;
      target_key: string;
      copied_at: Date | null;
    }>('select ref, target_bucket, target_key, copied_at from publish_assets where revision_id = $1', [
      draft.revisionId,
    ]);
    expect(manifest).toHaveLength(2); // hero + the asset block
    for (const row of manifest) {
      expect(row.copied_at, row.ref).not.toBeNull();
      expect(await harness.storage.exists(row.target_bucket as 'public-content', row.target_key)).toBe(
        true,
      );
    }
    // …and the AssetRefs carry the stamped published keys.
    const { rows: assets } = await harness.db.query<{
      content: { asset: { published_key?: string; bucket?: string } };
    }>(`select content from blocks b join steps s on s.id = b.step_id
         where s.revision_id = $1 and b.kind = 'asset'`, [draft.revisionId]);
    expect(assets[0]!.content.asset.published_key).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(assets[0]!.content.asset.bucket).toBe('content-published');

    expect(harness.revalidated).toBe(1);
  });

  /**
   * §3.5 — "Until M5, the publish RPC is called with `p_notify_kind = NULL` (enforced by a server
   * flag) and no checkbox exists in admin." The flag lives in lib/publish/pipeline.ts; what M4 adds
   * is that no admin operation even has a field that could carry a kind.
   */
  it('never enqueues a notification job, and has no control that could', async () => {
    const draft = await draftWithAssets('ui-no-notify');
    expectOk(
      await harness.run('revision.publish', {
        playbookId: draft.playbookId,
        revisionId: draft.revisionId,
        mode: 'full',
        // Even if a hostile form posts one, the operation has no such field.
        notifyKind: 'new_playbook',
        p_notify_kind: 'new_playbook',
      }),
    );
    const { rows } = await harness.db.query<{ n: number }>(
      'select count(*)::int as n from notification_jobs',
    );
    expect(rows[0]?.n).toBe(0);

    const operations = readFileSync(join(ROOT, 'lib', 'admin', 'operations.ts'), 'utf8');
    // No field, no argument, no schema entry — only the comment explaining the absence.
    expect(operations).not.toMatch(/notifyKind\s*[:=]/);
    expect(operations).not.toContain('p_notify_kind');
    // Asserting on FIELD NAMES rather than the word "notification", which legitimately appears in
    // the publish panel's line explaining that nothing is sent — same idiom as the /account test.
    for (const file of ['chrome.tsx', 'editor-panels.tsx', 'block-forms.tsx', 'step-editor.tsx']) {
      const source = readFileSync(join(ROOT, 'components', 'admin', file), 'utf8');
      expect(source, file).not.toMatch(/name="notif/);
      expect(source, file).not.toContain('notif_new_playbook');
      expect(source, file).not.toContain('notif_updates');
      expect(source, file).not.toContain('notifyKind');
    }
  });

  it('requires a bilingual change note to republish, and says so in the form', async () => {
    const first = await draftWithAssets('ui-republish');
    expectOk(
      await harness.run('revision.publish', {
        playbookId: first.playbookId,
        revisionId: first.revisionId,
        mode: 'full',
      }),
    );

    expectOk(await harness.run('revision.openDraft', { playbookId: first.playbookId }));
    const { rows } = await harness.db.query<{ id: string }>(
      `select id from playbook_revisions where playbook_id = $1 and state = 'draft'`,
      [first.playbookId],
    );
    const second = rows[0]!.id;

    const refused = await harness.run('revision.publish', {
      playbookId: first.playbookId,
      revisionId: second,
      mode: 'full',
    });
    expect(refused).toMatchObject({ ok: false, code: 'changeNoteRequired' });

    // Add the note through the metadata form and it goes out.
    expectOk(
      await harness.run('revision.metadata', {
        revisionId: second,
        category: 'pipeline',
        titleEn: 'Fixture title',
        titleKo: '픽스처 제목',
        summaryEn: 'Fixture summary',
        summaryKo: '픽스처 요약',
        changeNoteEn: 'Swapped the base model.',
        changeNoteKo: '베이스 모델을 교체했습니다.',
        difficulty: 'intermediate',
        tools: '',
        models: '',
      }),
    );
    expectOk(
      await harness.run('revision.publish', {
        playbookId: first.playbookId,
        revisionId: second,
        mode: 'full',
      }),
    );

    const { rows: states } = await harness.db.query<{ rev_no: number; state: string }>(
      'select rev_no, state from playbook_revisions where playbook_id = $1 order by rev_no',
      [first.playbookId],
    );
    expect(states).toEqual([
      { rev_no: 1, state: 'superseded' },
      { rev_no: 2, state: 'published' },
    ]);
  });

  it('refuses to publish a revision that was never prepared', async () => {
    const draft = await draftWithAssets('ui-unprepared');
    const outcome = await harness.run('revision.publish', {
      playbookId: draft.playbookId,
      revisionId: draft.revisionId,
      mode: 'commit',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'notPrepared' });
  });

  /**
   * The R3b/R3c guard, reached the way an author would reach it: Prepare (so the preview shows what
   * will ship), then an edit, then "Publish prepared revision". The RPC recomputes routing from the
   * stamped values and refuses — and the form says "content changed after prepare".
   */
  it('refuses a prepared publish after the content moved (edit-after-prepare)', async () => {
    const draft = await draftWithAssets('ui-stale');
    expectOk(await harness.run('revision.prepare', { revisionId: draft.revisionId }));

    const { rows } = await harness.db.query<{ id: string }>(
      `select b.id from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1 and b.kind = 'asset'`,
      [draft.revisionId],
    );
    // Replace the file: new bytes ⇒ new sha256 ⇒ new staging key ⇒ the manifest is stale.
    expectOk(
      await harness.run('block.update', {
        blockId: rows[0]!.id,
        file: upload('frame.png', 'DIFFERENT-BYTES'),
        captionEn: 'Frame',
        captionKo: '프레임',
        visibility: '',
      }),
    );

    const outcome = await harness.run('revision.publish', {
      playbookId: draft.playbookId,
      revisionId: draft.revisionId,
      mode: 'commit',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'manifestStale' });
    expect(outcome.ok === false && outcome.detail).toMatch(/manifest is stale/);

    // Nothing shipped.
    const { rows: pointer } = await harness.db.query<{ published_revision_id: string | null }>(
      'select published_revision_id from playbooks where id = $1',
      [draft.playbookId],
    );
    expect(pointer[0]?.published_revision_id).toBeNull();

    // Re-running the FULL pipeline re-prepares and succeeds — the message's advice is true.
    expectOk(
      await harness.run('revision.publish', {
        playbookId: draft.playbookId,
        revisionId: draft.revisionId,
        mode: 'full',
      }),
    );
  });

  it('refuses to publish with a locale missing, and names the gate', async () => {
    const draft = await createDraft(harness.db, harness.storage, {
      slug: 'ui-locale',
      title: { ko: '   ' },
      blocks: [{ kind: 'prompt', content: { text: 'p' } }],
    });
    const outcome = await harness.run('revision.publish', {
      playbookId: draft.playbookId,
      revisionId: draft.revisionId,
      mode: 'full',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'localeIncomplete' });
    expect(harness.revalidated).toBe(0);
  });

  it('reports an incomplete manifest when an asset has no staged bytes', async () => {
    const draft = await createDraft(harness.db, harness.storage, { slug: 'ui-missing-bytes' });
    // An AssetRef whose staging object was never written (hand-built, not uploaded).
    const orphan = { ...(await stageAsset(harness.storage, draft.revisionId, 'orphan')) };
    orphan.staging_key = `content/rev/${draft.revisionId}/does-not-exist.png`;
    await harness.db.query(
      `insert into blocks (id, step_id, "order", kind, content)
       values (gen_random_uuid(), $1, 9, 'asset', $2::jsonb)`,
      [draft.stepId, JSON.stringify({ asset: orphan })],
    );

    const outcome = await harness.run('revision.publish', {
      playbookId: draft.playbookId,
      revisionId: draft.revisionId,
      mode: 'full',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('storage');
  });
});
