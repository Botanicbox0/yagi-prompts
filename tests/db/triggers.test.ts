import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import type { StorageDriver } from '@/lib/storage';
import { preparePublish, publishRevision, runPublishPipeline } from '@/lib/publish/pipeline';
import { asRole, createAppRole, expectReject, freshDb, runner } from '../helpers/pglite';
import { createDraft } from '../helpers/factory';

/**
 * PLAN §6 (R3b) trigger matrix.
 *
 * `app_service` stands in for Supabase's service_role: a non-superuser with full DML on every
 * table and no membership in `publisher`. If raw service-role code can do any of the things
 * below, the immutability model is broken.
 */
describe('constraint triggers: immutability + the publisher-only channel', () => {
  let db: PGlite;
  let storage: StorageDriver;
  let root: string;
  let published: { playbookId: string; revisionId: string; stepId: string; blockIds: string[] };

  beforeEach(async () => {
    db = await freshDb();
    root = await mkdtemp(join(tmpdir(), 'playbook-trg-'));
    storage = createLocalStorageDriver(root);
    await createAppRole(db);

    const draft = await createDraft(db, storage, {
      slug: 'immutable',
      withHero: true, // gives the revision a publish_assets row to protect
      blocks: [
        { kind: 'prompt', content: { text: 'locked prompt' } },
        { kind: 'note', content: { md: { en: 'note', ko: '노트' } } },
      ],
    });
    await runPublishPipeline(runner(db), storage, {
      playbookId: draft.playbookId,
      revisionId: draft.revisionId,
    });
    published = draft;
  });

  afterEach(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  const asService = <T>(fn: () => Promise<T>) => asRole(db, 'app_service', fn);

  // -------------------------------------------------------------------------
  // A. content under a published revision is immutable — for everyone
  // -------------------------------------------------------------------------

  it('rejects INSERT of a step under a published revision', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query(
          `insert into steps (id, revision_id, "order", title)
           values ($1, $2, 99, '{"en":"x","ko":"x"}'::jsonb)`,
          [randomUUID(), published.revisionId],
        ),
      ),
    );
    expect(message).toMatch(/INSERT on a step of a published revision/);
  });

  it('rejects UPDATE of a step under a published revision', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query(`update steps set "order" = 5 where id = $1`, [published.stepId]),
      ),
    );
    expect(message).toMatch(/UPDATE on a step of a published revision/);
  });

  it('rejects DELETE of a step under a published revision', async () => {
    const message = await expectReject(() =>
      asService(() => db.query('delete from steps where id = $1', [published.stepId])),
    );
    expect(message).toMatch(/DELETE on a step of a published revision/);
  });

  it('rejects INSERT of a block under a published revision', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query(
          `insert into blocks (id, step_id, "order", kind, content)
           values ($1, $2, 99, 'prompt', '{"text":"smuggled"}'::jsonb)`,
          [randomUUID(), published.stepId],
        ),
      ),
    );
    expect(message).toMatch(/INSERT on a block of a published revision/);
  });

  it('rejects UPDATE of a block under a published revision', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query(`update blocks set content = '{"text":"rewritten"}'::jsonb where id = $1`, [
          published.blockIds[0],
        ]),
      ),
    );
    expect(message).toMatch(/UPDATE on a block of a published revision/);
  });

  it('rejects DELETE of a block under a published revision', async () => {
    const message = await expectReject(() =>
      asService(() => db.query('delete from blocks where id = $1', [published.blockIds[0]])),
    );
    expect(message).toMatch(/DELETE on a block of a published revision/);
  });

  it('rejects DELETE of the current published revision (composite FK is the first wall)', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query('delete from playbook_revisions where id = $1', [published.revisionId]),
      ),
    );
    expect(message).toMatch(/fk_published_revision_same_playbook|foreign key/i);
  });

  it('rejects DELETE of a superseded revision (no FK in the way — the trigger is)', async () => {
    const next = await createDraft(db, storage, {
      slug: 'immutable',
      playbookId: published.playbookId,
      revNo: 2,
      changeNote: { en: 'v2', ko: 'v2' },
    });
    await runPublishPipeline(runner(db), storage, {
      playbookId: next.playbookId,
      revisionId: next.revisionId,
    });

    const message = await expectReject(() =>
      asService(() =>
        db.query('delete from playbook_revisions where id = $1', [published.revisionId]),
      ),
    );
    expect(message).toMatch(/is superseded and cannot be deleted/);
  });

  it('rejects mutation of published revision metadata', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query(
          `update playbook_revisions set title = '{"en":"new","ko":"새"}'::jsonb where id = $1`,
          [published.revisionId],
        ),
      ),
    );
    expect(message).toMatch(/is published and immutable/);
  });

  // -------------------------------------------------------------------------
  // B. privileged operations require current_user = 'publisher'
  // -------------------------------------------------------------------------

  it('rejects a direct state write by the service role', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query(`update playbook_revisions set state = 'draft' where id = $1`, [
          published.revisionId,
        ]),
      ),
    );
    expect(message).toMatch(/state transitions are reserved to the publish RPCs/);
    expect(message).toMatch(/current_user=app_service/);
  });

  it('rejects a direct published_revision_id swap by the service role', async () => {
    const other = await createDraft(db, storage, { slug: 'other' });
    const message = await expectReject(() =>
      asService(() =>
        db.query('update playbooks set published_revision_id = null where id = $1', [
          published.playbookId,
        ]),
      ),
    );
    expect(message).toMatch(/published_revision_id is swapped by publish_revision only/);
    expect(other.playbookId).toBeTruthy();
  });

  it('rejects a direct resolved_visibility stamp by the service role', async () => {
    const draft = await createDraft(db, storage, { slug: 'stamp-attempt' });
    const message = await expectReject(() =>
      asService(() =>
        db.query(`update blocks set resolved_visibility = 'public' where id = $1`, [
          draft.blockIds[0],
        ]),
      ),
    );
    expect(message).toMatch(/resolved_visibility is stamped by prepare_publish only/);
  });

  it('rejects pre-stamping resolved_visibility at INSERT time', async () => {
    const draft = await createDraft(db, storage, { slug: 'stamp-insert' });
    const message = await expectReject(() =>
      asService(() =>
        db.query(
          `insert into blocks (id, step_id, "order", kind, content, resolved_visibility)
           values ($1, $2, 50, 'prompt', '{"text":"x"}'::jsonb, 'public')`,
          [randomUUID(), draft.stepId],
        ),
      ),
    );
    expect(message).toMatch(/resolved_visibility is stamped by prepare_publish only/);
  });

  it('rejects a revision inserted directly in published state', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query(
          `insert into playbook_revisions (id, playbook_id, rev_no, state, title, summary)
           values ($1, $2, 42, 'published', '{"en":"x","ko":"x"}'::jsonb, '{"en":"x","ko":"x"}'::jsonb)`,
          [randomUUID(), published.playbookId],
        ),
      ),
    );
    expect(message).toMatch(/revisions are born draft/);
  });

  it('rejects manifest tampering under a published revision', async () => {
    const message = await expectReject(() =>
      asService(() =>
        db.query('delete from publish_assets where revision_id = $1', [published.revisionId]),
      ),
    );
    expect(message).toMatch(/publish manifest of a published revision/);
  });

  // -------------------------------------------------------------------------
  // C. even the publisher role is bound by the transition whitelist
  // -------------------------------------------------------------------------

  it('rejects published → draft even as publisher', async () => {
    const message = await expectReject(() =>
      asRole(db, 'publisher', () =>
        db.query(`update playbook_revisions set state = 'draft' where id = $1`, [
          published.revisionId,
        ]),
      ),
    );
    expect(message).toMatch(/illegal revision state transition published -> draft/);
  });

  it('rejects draft → superseded even as publisher', async () => {
    const draft = await createDraft(db, storage, { slug: 'skip-state' });
    const message = await expectReject(() =>
      asRole(db, 'publisher', () =>
        db.query(`update playbook_revisions set state = 'superseded' where id = $1`, [
          draft.revisionId,
        ]),
      ),
    );
    expect(message).toMatch(/illegal revision state transition draft -> superseded/);
  });

  // -------------------------------------------------------------------------
  // D. the RPC path itself succeeds from the service role
  // -------------------------------------------------------------------------

  it('lets the service role publish THROUGH the RPCs (SECURITY DEFINER lifts it to publisher)', async () => {
    const draft = await createDraft(db, storage, { slug: 'rpc-path' });
    await asService(async () => {
      await db.query('select prepare_publish($1)', [draft.revisionId]);
      await db.query('select publish_revision($1, $2, null)', [
        draft.playbookId,
        draft.revisionId,
      ]);
    });

    const { rows } = await db.query<{ state: string; status: string; pointer: string }>(
      `select r.state, p.status, p.published_revision_id as pointer
         from playbook_revisions r join playbooks p on p.id = r.playbook_id
        where r.id = $1`,
      [draft.revisionId],
    );
    expect(rows[0]).toEqual({
      state: 'published',
      status: 'published',
      pointer: draft.revisionId,
    });
  });

  it('keeps draft content fully editable by the service role', async () => {
    const draft = await createDraft(db, storage, { slug: 'draft-editable' });
    await asService(async () => {
      await db.query(`update blocks set content = '{"text":"edited"}'::jsonb where id = $1`, [
        draft.blockIds[0],
      ]);
      await db.query(
        `insert into blocks (id, step_id, "order", kind, content)
         values ($1, $2, 2, 'note', '{"md":{"en":"n","ko":"ㄴ"}}'::jsonb)`,
        [randomUUID(), draft.stepId],
      );
      await db.query('delete from blocks where id = $1', [draft.blockIds[0]]);
    });
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from blocks b join steps s on s.id = b.step_id where s.revision_id = $1',
      [draft.revisionId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
