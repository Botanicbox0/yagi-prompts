import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDraft } from '../helpers/factory';
import { adminHarness, expectOk, type AdminHarness } from '../helpers/admin';

/**
 * PLAN §3.8 — up/down ordering only, and §6's `unique (parent, "order")`.
 *
 * The constraint is not deferrable, so the naive one-statement swap can trip its own unique index.
 * These tests assert the OUTCOME rather than the technique: after any sequence of moves and
 * deletes, orders stay a dense 1..n with no duplicates — which is the property the read path's
 * `order by "order"` silently depends on.
 */
describe('step and block ordering (§3.8)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function stepOrders(revisionId: string) {
    const { rows } = await harness.db.query<{ order: number; en: string }>(
      `select "order", title ->> 'en' as en from steps where revision_id = $1 order by "order"`,
      [revisionId],
    );
    return rows;
  }

  async function blockOrders(stepId: string) {
    const { rows } = await harness.db.query<{ order: number; kind: string }>(
      'select "order", kind from blocks where step_id = $1 order by "order"',
      [stepId],
    );
    return rows;
  }

  it('moves a step up and down while keeping unique(revision_id, order) dense', async () => {
    const draft = await createDraft(harness.db, harness.storage, {
      slug: 'ordering',
      blocks: [],
      stepTitle: { en: 'A' },
    });
    for (const name of ['B', 'C']) {
      expectOk(
        await harness.run('step.create', {
          revisionId: draft.revisionId,
          titleEn: name,
          titleKo: name,
        }),
      );
    }
    expect((await stepOrders(draft.revisionId)).map((r) => r.en)).toEqual(['A', 'B', 'C']);

    const { rows: steps } = await harness.db.query<{ id: string; en: string }>(
      `select id, title ->> 'en' as en from steps where revision_id = $1 order by "order"`,
      [draft.revisionId],
    );
    const c = steps[2]!.id;

    expectOk(await harness.run('step.move', { stepId: c, direction: 'up' }));
    expect((await stepOrders(draft.revisionId)).map((r) => r.en)).toEqual(['A', 'C', 'B']);

    expectOk(await harness.run('step.move', { stepId: c, direction: 'up' }));
    expect((await stepOrders(draft.revisionId)).map((r) => r.en)).toEqual(['C', 'A', 'B']);

    // Already at the top: a no-op, not a failure.
    expectOk(await harness.run('step.move', { stepId: c, direction: 'up' }));
    expect((await stepOrders(draft.revisionId)).map((r) => r.en)).toEqual(['C', 'A', 'B']);

    expectOk(await harness.run('step.move', { stepId: c, direction: 'down' }));
    expect((await stepOrders(draft.revisionId)).map((r) => r.en)).toEqual(['A', 'C', 'B']);

    expect((await stepOrders(draft.revisionId)).map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it('re-densifies orders after a delete', async () => {
    const draft = await createDraft(harness.db, harness.storage, {
      slug: 'delete-order',
      blocks: [],
      stepTitle: { en: 'A' },
    });
    for (const name of ['B', 'C', 'D']) {
      expectOk(
        await harness.run('step.create', {
          revisionId: draft.revisionId,
          titleEn: name,
          titleKo: name,
        }),
      );
    }
    const { rows } = await harness.db.query<{ id: string }>(
      `select id from steps where revision_id = $1 order by "order"`,
      [draft.revisionId],
    );
    expectOk(await harness.run('step.delete', { stepId: rows[1]!.id }));

    const after = await stepOrders(draft.revisionId);
    expect(after.map((r) => r.en)).toEqual(['A', 'C', 'D']);
    expect(after.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it('moves blocks within a step and keeps unique(step_id, order) dense', async () => {
    const draft = await createDraft(harness.db, harness.storage, { slug: 'block-order', blocks: [] });
    for (const kind of ['prompt', 'note', 'link'] as const) {
      const fields =
        kind === 'prompt'
          ? { text: 'p' }
          : kind === 'note'
            ? { mdEn: 'n', mdKo: '노' }
            : { url: 'https://example.com', labelEn: 'l', labelKo: '링' };
      expectOk(await harness.run('block.create', { stepId: draft.stepId, kind, ...fields }));
    }
    expect((await blockOrders(draft.stepId)).map((r) => r.kind)).toEqual([
      'prompt',
      'note',
      'link',
    ]);

    const { rows } = await harness.db.query<{ id: string; kind: string }>(
      'select id, kind from blocks where step_id = $1 order by "order"',
      [draft.stepId],
    );
    expectOk(await harness.run('block.move', { blockId: rows[0]!.id, direction: 'down' }));
    expect((await blockOrders(draft.stepId)).map((r) => r.kind)).toEqual([
      'note',
      'prompt',
      'link',
    ]);

    expectOk(await harness.run('block.move', { blockId: rows[2]!.id, direction: 'down' }));
    expect((await blockOrders(draft.stepId)).map((r) => r.order)).toEqual([1, 2, 3]);

    // rows[] is indexed by the ORIGINAL order, so rows[1] is the note now sitting first.
    expectOk(await harness.run('block.delete', { blockId: rows[1]!.id }));
    const after = await blockOrders(draft.stepId);
    expect(after.map((r) => r.kind)).toEqual(['prompt', 'link']);
    expect(after.map((r) => r.order)).toEqual([1, 2]);
  });

  it('never lets two siblings share an order, whatever the sequence', async () => {
    const draft = await createDraft(harness.db, harness.storage, { slug: 'churn', blocks: [] });
    for (let index = 0; index < 5; index += 1) {
      expectOk(
        await harness.run('block.create', {
          stepId: draft.stepId,
          kind: 'prompt',
          text: `prompt ${index}`,
        }),
      );
    }
    const { rows } = await harness.db.query<{ id: string }>(
      'select id from blocks where step_id = $1 order by "order"',
      [draft.stepId],
    );
    const moves: Array<['up' | 'down', number]> = [
      ['down', 0],
      ['down', 0],
      ['up', 4],
      ['up', 2],
      ['down', 3],
      ['up', 1],
    ];
    for (const [direction, index] of moves) {
      expectOk(await harness.run('block.move', { blockId: rows[index]!.id, direction }));
    }
    const after = await blockOrders(draft.stepId);
    expect(after.map((r) => r.order)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(after.map((r) => r.order)).size).toBe(5);
  });
});
