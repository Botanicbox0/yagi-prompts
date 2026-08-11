import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOTIFICATIONS_ENABLED } from '@/lib/flags';
import { notifyKindFor } from '@/lib/notify/kinds';
import { adminHarness, expectOk, type AdminHarness } from '../helpers/admin';
import { createDraft } from '../helpers/factory';
import { jobs } from '../helpers/notify';

/**
 * PLAN §3.5 / §6 Phase C.4 — the publish → `notification_jobs` half of the outbox, driven through
 * the same `revision.publish` operation the editor's button posts.
 *
 * The two properties that matter here are both about a job that must NOT exist:
 *   · one publish, one job — the RPC's `unique (revision_id, kind)` plus `on conflict do nothing`;
 *   · the KIND is derived from the playbook's history, so a form cannot announce a rewrite of
 *     something that never shipped.
 */
describe('publish with notification (§3.5)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function draft(slug: string, revNo = 1, changeNote?: { en: string; ko: string }) {
    return createDraft(harness.db, harness.storage, {
      slug,
      revNo,
      ...(changeNote ? { changeNote } : {}),
      blocks: [{ kind: 'prompt', content: { text: 'p' } }],
    });
  }

  it('is enabled — M5 flipped the flag every notification path reads', () => {
    expect(NOTIFICATIONS_ENABLED).toBe(true);
  });

  it('creates exactly one job on a first publish, and calls it new_playbook', async () => {
    const first = await draft('notify-new');
    expectOk(
      await harness.run('revision.publish', {
        playbookId: first.playbookId,
        revisionId: first.revisionId,
        mode: 'full',
        notify: 'on',
      }),
    );

    const rows = await jobs(harness.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('new_playbook');
    expect(rows[0]!.revision_id).toBe(first.revisionId);
  });

  it('creates nothing when the checkbox is left alone', async () => {
    const only = await draft('notify-off');
    expectOk(
      await harness.run('revision.publish', {
        playbookId: only.playbookId,
        revisionId: only.revisionId,
        mode: 'full',
        // no `notify` field at all — exactly what an unticked checkbox posts
      }),
    );
    expect(await jobs(harness.db)).toHaveLength(0);
  });

  it('calls a republication playbook_update, and says so in the banner detail', async () => {
    const rev1 = await draft('notify-update');
    expectOk(
      await harness.run('revision.publish', {
        playbookId: rev1.playbookId,
        revisionId: rev1.revisionId,
        mode: 'full',
        notify: 'on',
      }),
    );

    const rev2 = await createDraft(harness.db, harness.storage, {
      slug: 'notify-update',
      playbookId: rev1.playbookId,
      revNo: 2,
      changeNote: { en: 'Swapped to Seedance 2.0', ko: 'Seedance 2.0으로 교체' },
      blocks: [{ kind: 'prompt', content: { text: 'p2' } }],
    });
    const outcome = expectOk(
      await harness.run('revision.publish', {
        playbookId: rev1.playbookId,
        revisionId: rev2.revisionId,
        mode: 'full',
        notify: 'on',
      }),
    );

    expect(outcome.detail).toContain('notify playbook_update');
    const rows = await jobs(harness.db);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind)).toEqual(['new_playbook', 'playbook_update']);
    // Different revisions, so different jobs — the unique key is (revision_id, kind).
    expect(new Set(rows.map((row) => row.revision_id)).size).toBe(2);
  });

  it('cannot be published twice, so a revision cannot enqueue a second job', async () => {
    const once = await draft('notify-once');
    expectOk(
      await harness.run('revision.publish', {
        playbookId: once.playbookId,
        revisionId: once.revisionId,
        mode: 'full',
        notify: 'on',
      }),
    );

    const again = await harness.run('revision.publish', {
      playbookId: once.playbookId,
      revisionId: once.revisionId,
      mode: 'commit',
      notify: 'on',
    });
    expect(again.ok).toBe(false);
    // M4's classifier maps the RPC's "requires a draft revision" to `notPrepared` ("Press Prepare
    // first") — pinned here rather than changed, since the property under test is that the second
    // call is REFUSED and enqueues nothing.
    if (!again.ok) expect(again.code).toBe('notPrepared');
    expect(await jobs(harness.db)).toHaveLength(1);
  });

  it('has a real unique constraint behind the RPC, not just an application check', async () => {
    const guarded = await draft('notify-unique');
    expectOk(
      await harness.run('revision.publish', {
        playbookId: guarded.playbookId,
        revisionId: guarded.revisionId,
        mode: 'full',
        notify: 'on',
      }),
    );

    await expect(
      harness.db.query(
        `insert into notification_jobs (revision_id, kind) values ($1, 'new_playbook')`,
        [guarded.revisionId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('derives the kind from history, never from the form', () => {
    expect(notifyKindFor(false)).toBe('new_playbook');
    expect(notifyKindFor(true)).toBe('playbook_update');
  });
});
