import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import type { StorageDriver } from '@/lib/storage';
import { copyPublishManifest, preparePublish, publishRevision } from '@/lib/publish/pipeline';
import { expectReject, freshDb, runner } from '../helpers/pglite';
import { createDraft, stageAsset } from '../helpers/factory';

/**
 * PLAN §8 M0 acceptance — publish RPC guards.
 * Every case here is a red-first test: it fails loudly if the guard is removed from the SQL.
 */
describe('publish RPC guards (PLAN §6 phases A/C)', () => {
  let db: PGlite;
  let storage: StorageDriver;
  let root: string;

  beforeEach(async () => {
    db = await freshDb();
    root = await mkdtemp(join(tmpdir(), 'playbook-rpc-'));
    storage = createLocalStorageDriver(root);
  });

  afterEach(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  const sql = () => runner(db);

  it('rejects a revision that belongs to another playbook (composite ownership)', async () => {
    const a = await createDraft(db, storage, { slug: 'pb-a' });
    const b = await createDraft(db, storage, { slug: 'pb-b' });

    await preparePublish(sql(), b.revisionId);
    const message = await expectReject(() =>
      publishRevision(sql(), { playbookId: a.playbookId, revisionId: b.revisionId }),
    );
    expect(message).toMatch(/belongs to playbook/);
  });

  it('rejects the same mismatch structurally, through the composite FK', async () => {
    const a = await createDraft(db, storage, { slug: 'fk-a' });
    const b = await createDraft(db, storage, { slug: 'fk-b' });
    // Even with the publisher role in hand, the pointer cannot cross playbooks.
    const message = await expectReject(async () => {
      await db.exec('set role publisher;');
      try {
        await db.query('update playbooks set published_revision_id = $1 where id = $2', [
          b.revisionId,
          a.playbookId,
        ]);
      } finally {
        await db.exec('reset role;');
      }
    });
    expect(message).toMatch(/fk_published_revision_same_playbook|foreign key/i);
  });

  it('rejects a publish when a locale is missing (§3.9 publish gate)', async () => {
    const missingTitleKo = await createDraft(db, storage, {
      slug: 'locale-title',
      title: { ko: '   ' },
    });
    await preparePublish(sql(), missingTitleKo.revisionId);
    expect(
      await expectReject(() =>
        publishRevision(sql(), {
          playbookId: missingTitleKo.playbookId,
          revisionId: missingTitleKo.revisionId,
        }),
      ),
    ).toMatch(/title requires both en and ko/);

    const missingStepLocale = await createDraft(db, storage, {
      slug: 'locale-step',
      stepTitle: { en: '' },
    });
    await preparePublish(sql(), missingStepLocale.revisionId);
    expect(
      await expectReject(() =>
        publishRevision(sql(), {
          playbookId: missingStepLocale.playbookId,
          revisionId: missingStepLocale.revisionId,
        }),
      ),
    ).toMatch(/step title\(s\) missing a locale/);

    const missingNoteLocale = await createDraft(db, storage, {
      slug: 'locale-note',
      blocks: [{ kind: 'note', content: { md: { en: 'only english', ko: '' } } }],
    });
    await preparePublish(sql(), missingNoteLocale.revisionId);
    expect(
      await expectReject(() =>
        publishRevision(sql(), {
          playbookId: missingNoteLocale.playbookId,
          revisionId: missingNoteLocale.revisionId,
        }),
      ),
    ).toMatch(/note block\(s\) missing a locale/);
  });

  it('requires a bilingual change note when republishing (§3.8)', async () => {
    const first = await createDraft(db, storage, { slug: 'republish' });
    await preparePublish(sql(), first.revisionId);
    await publishRevision(sql(), {
      playbookId: first.playbookId,
      revisionId: first.revisionId,
    });

    const second = await createDraft(db, storage, {
      slug: 'republish',
      playbookId: first.playbookId,
      revNo: 2,
      changeNote: null,
    });
    await preparePublish(sql(), second.revisionId);
    expect(
      await expectReject(() =>
        publishRevision(sql(), {
          playbookId: second.playbookId,
          revisionId: second.revisionId,
        }),
      ),
    ).toMatch(/requires a bilingual change_note/);

    // …and succeeds once the note is there.
    await db.query(
      `update playbook_revisions set change_note = '{"en":"swapped model","ko":"모델 교체"}'::jsonb
        where id = $1`,
      [second.revisionId],
    );
    await preparePublish(sql(), second.revisionId);
    await publishRevision(sql(), {
      playbookId: second.playbookId,
      revisionId: second.revisionId,
    });

    const { rows } = await db.query<{ state: string; rev_no: number }>(
      'select state, rev_no from playbook_revisions where playbook_id = $1 order by rev_no',
      [first.playbookId],
    );
    expect(rows).toEqual([
      { state: 'superseded', rev_no: 1 },
      { state: 'published', rev_no: 2 },
    ]);
  });

  it('rejects a publish while the manifest is incomplete (uncopied assets)', async () => {
    const draft = await createDraft(db, storage, {
      slug: 'manifest-incomplete',
      withHero: true,
      blocks: [{ kind: 'prompt', content: { text: 'p' } }],
    });
    await preparePublish(sql(), draft.revisionId);

    expect(
      await expectReject(() =>
        publishRevision(sql(), { playbookId: draft.playbookId, revisionId: draft.revisionId }),
      ),
    ).toMatch(/manifest incomplete: 1 asset\(s\) not copied/);

    await copyPublishManifest(sql(), storage, draft.revisionId);
    await publishRevision(sql(), {
      playbookId: draft.playbookId,
      revisionId: draft.revisionId,
    });
  });

  it('rejects a publish that was never prepared (unstamped resolved_visibility)', async () => {
    const draft = await createDraft(db, storage, { slug: 'never-prepared' });
    expect(
      await expectReject(() =>
        publishRevision(sql(), { playbookId: draft.playbookId, revisionId: draft.revisionId }),
      ),
    ).toMatch(/not prepared/);
  });

  it('refuses prepare_publish on a non-draft revision', async () => {
    const draft = await createDraft(db, storage, { slug: 'already-published' });
    await preparePublish(sql(), draft.revisionId);
    await publishRevision(sql(), { playbookId: draft.playbookId, revisionId: draft.revisionId });
    expect(await expectReject(() => preparePublish(sql(), draft.revisionId))).toMatch(
      /requires a draft revision/,
    );
  });

  describe('edit-after-prepare cannot publish stale routing (R3b/R3c)', () => {
    async function preparedDraft(slug: string) {
      const draft = await createDraft(db, storage, {
        slug,
        withHero: true,
        blocks: [
          {
            kind: 'asset',
            visibility: 'public',
            content: { asset: await stageAsset(storage, 'seed', `${slug}-a`) },
          },
        ],
      });
      // The asset was staged under a different revision id above; restage under the real one.
      const asset = await stageAsset(storage, draft.revisionId, `${slug}-a`);
      await db.query(
        `update blocks set content = jsonb_build_object('asset', $2::jsonb) where id = $1`,
        [draft.blockIds[0], JSON.stringify(asset)],
      );
      await preparePublish(sql(), draft.revisionId);
      await copyPublishManifest(sql(), storage, draft.revisionId);
      return draft;
    }

    it('detects a changed asset (new hash + new source key)', async () => {
      const draft = await preparedDraft('edit-hash');
      const replacement = await stageAsset(storage, draft.revisionId, 'edit-hash-replacement');
      await db.query(
        `update blocks set content = jsonb_build_object('asset', $2::jsonb) where id = $1`,
        [draft.blockIds[0], JSON.stringify(replacement)],
      );
      expect(
        await expectReject(() =>
          publishRevision(sql(), { playbookId: draft.playbookId, revisionId: draft.revisionId }),
        ),
      ).toMatch(/manifest is stale/);
    });

    it('detects a ROUTING-ONLY change — identical refs and hashes (the R3c case)', async () => {
      const draft = await preparedDraft('edit-routing');
      const before = await db.query<{ target_bucket: string }>(
        `select target_bucket from publish_assets where revision_id = $1 and ref <> 'hero'`,
        [draft.revisionId],
      );
      expect(before.rows[0]?.target_bucket).toBe('content-published');

      // Flip is_showcase on the draft: refs, hashes and source keys are untouched, only the
      // derived bucket moves. A subset comparison would miss this and publish public bytes.
      await db.query('update playbook_revisions set is_showcase = true where id = $1', [
        draft.revisionId,
      ]);

      expect(
        await expectReject(() =>
          publishRevision(sql(), { playbookId: draft.playbookId, revisionId: draft.revisionId }),
        ),
      ).toMatch(/manifest is stale/);

      // Re-preparing recomputes routing, and the copy has to happen again before publish.
      await preparePublish(sql(), draft.revisionId);
      const after = await db.query<{ target_bucket: string; copied_at: Date | null }>(
        `select target_bucket, copied_at from publish_assets where revision_id = $1 and ref <> 'hero'`,
        [draft.revisionId],
      );
      expect(after.rows[0]?.target_bucket).toBe('public-content');
      expect(after.rows[0]?.copied_at).toBeNull();

      await copyPublishManifest(sql(), storage, draft.revisionId);
      await publishRevision(sql(), {
        playbookId: draft.playbookId,
        revisionId: draft.revisionId,
      });
    });

    it('detects an asset block added after prepare (extra canonical ref)', async () => {
      const draft = await preparedDraft('edit-added');
      const extra = await stageAsset(storage, draft.revisionId, 'edit-added-extra', 'json', 'application/json');
      await db.query(
        `insert into blocks (id, step_id, "order", kind, content)
         values ($1, $2, 9, 'workflow_file', $3::jsonb)`,
        [
          randomUUID(),
          draft.stepId,
          JSON.stringify({
            asset: extra,
            filename: 'graph.json',
            size_bytes: 10,
            format: 'comfyui',
          }),
        ],
      );
      // The new block also has no stamped visibility, which the prepare gate catches first.
      const message = await expectReject(() =>
        publishRevision(sql(), { playbookId: draft.playbookId, revisionId: draft.revisionId }),
      );
      expect(message).toMatch(/not prepared|manifest is stale/);
    });
  });

  it('records a notification job only when a kind is passed (M5 gate keeps it NULL)', async () => {
    const draft = await createDraft(db, storage, { slug: 'notify' });
    await preparePublish(sql(), draft.revisionId);
    // lib/publish forces NULL while NOTIFICATIONS_ENABLED is false…
    await publishRevision(sql(), {
      playbookId: draft.playbookId,
      revisionId: draft.revisionId,
      notifyKind: 'new_playbook',
    });
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from notification_jobs',
    );
    expect(rows[0]?.n).toBe(0);
  });
});
