import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_KINDS, type BlockKind } from '@/lib/content/schemas';
import { createDraft } from '../helpers/factory';
import { adminHarness, expectOk, upload, type AdminHarness, type FormFields } from '../helpers/admin';

/**
 * PLAN §6.1 — "All jsonb payloads validated with zod (§6.1 schemas) at the server boundary."
 *
 * One good and one bad payload per kind. The pairing matters: a blanket "everything is invalid"
 * bug would pass the rejection half on its own, so each kind has to be shown creating successfully
 * with the SAME form shape before its rejection means anything.
 */

const GOOD: Record<BlockKind, FormFields> = {
  prompt: { text: 'character sheet, 6 poses', model: 'GPT Image 2' },
  params: { paramKey: ['size', 'steps'], paramValue: ['1536x1024', '30'] },
  asset: {
    file: upload('frame.png', 'PNG-BYTES'),
    captionEn: 'Reference frame',
    captionKo: '레퍼런스 프레임',
  },
  note: { mdEn: '**Crop** to the shoulders.', mdKo: '**어깨선까지** 자르세요.' },
  link: { url: 'https://example.com/guide', labelEn: 'Guide', labelKo: '가이드' },
  workflow_file: {
    file: upload('graph.json', '{}', 'application/json'),
    filename: 'character-sheet.json',
    format: 'comfyui',
  },
};

/** Each one violates exactly one clause of its §6.1 contract. */
const BAD: Record<BlockKind, FormFields> = {
  // text: z.string().min(1)
  prompt: { text: '   ', model: 'GPT Image 2' },
  // rows: min(1) — every row here has a blank key and is dropped
  params: { paramKey: ['', ''], paramValue: ['a', 'b'] },
  // asset: AssetRef is required and only an upload can produce one
  asset: { captionEn: 'No file', captionKo: '파일 없음' },
  // md: LocalizedSchema needs BOTH locales
  note: { mdEn: 'English only', mdKo: '' },
  // url: z.string().url()
  link: { url: 'definitely-not-a-url', labelEn: 'Guide', labelKo: '가이드' },
  // format: z.string().min(1)
  workflow_file: { file: upload('graph.json', '{}', 'application/json'), filename: 'g.json', format: '' },
};

describe('block payload validation at the server boundary (§6.1)', () => {
  let harness: AdminHarness;
  let stepId: string;

  beforeEach(async () => {
    harness = await adminHarness();
    // No seed blocks: every block in this suite is one the editor created.
    const draft = await createDraft(harness.db, harness.storage, { slug: 'validation', blocks: [] });
    stepId = draft.stepId;
  });

  afterEach(async () => {
    await harness.close();
  });

  for (const kind of BLOCK_KINDS) {
    it(`accepts a valid ${kind} block`, async () => {
      expectOk(await harness.run('block.create', { stepId, kind, ...GOOD[kind] }));
      const { rows } = await harness.db.query<{ kind: string }>(
        'select kind from blocks where step_id = $1 and kind = $2',
        [stepId, kind],
      );
      expect(rows).toHaveLength(1);
    });

    it(`rejects a malformed ${kind} block without writing it`, async () => {
      const before = await harness.db.query<{ n: number }>(
        'select count(*)::int as n from blocks where step_id = $1',
        [stepId],
      );
      const outcome = await harness.run('block.create', { stepId, kind, ...BAD[kind] });
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.code).toBe('invalid');

      const after = await harness.db.query<{ n: number }>(
        'select count(*)::int as n from blocks where step_id = $1',
        [stepId],
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });
  }

  it('rejects a slug that is not a slug', async () => {
    const outcome = await harness.run('playbook.create', {
      slug: 'Not A Slug',
      category: 'video',
      titleEn: 'Title',
      titleKo: '제목',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('rejects a category outside the §6 enum', async () => {
    const outcome = await harness.run('playbook.create', {
      slug: 'fine-slug',
      category: 'interpretive-dance',
      titleEn: 'Title',
      titleKo: '제목',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('rejects a visibility value that is not in the enum', async () => {
    const created = expectOk(
      await harness.run('block.create', { stepId, kind: 'note', ...GOOD.note }),
    );
    expect(created.code).toBe('created');
    const { rows } = await harness.db.query<{ id: string }>(
      `select id from blocks where step_id = $1 and kind = 'note'`,
      [stepId],
    );
    const outcome = await harness.run('block.visibility', {
      blockId: rows[0]!.id,
      visibility: 'superuser',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('keeps a duplicate slug out of the catalog', async () => {
    expectOk(
      await harness.run('playbook.create', {
        slug: 'twice-over',
        category: 'image',
        titleEn: 'Once',
        titleKo: '한 번',
      }),
    );
    const outcome = await harness.run('playbook.create', {
      slug: 'twice-over',
      category: 'image',
      titleEn: 'Again',
      titleKo: '다시',
    });
    expect(outcome).toMatchObject({ ok: false, code: 'duplicateSlug' });
  });

  it('computes sha256 server-side at upload, from the bytes (§6 AssetRef)', async () => {
    expectOk(await harness.run('block.create', { stepId, kind: 'asset', ...GOOD.asset }));
    const { rows } = await harness.db.query<{ content: { asset: { sha256: string; staging_key: string } } }>(
      `select content from blocks where step_id = $1 and kind = 'asset'`,
      [stepId],
    );
    const asset = rows[0]!.content.asset;
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.staging_key).toMatch(/^content\/rev\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
    // The bytes really are where the key says they are.
    const stored = await harness.storage.read('content', asset.staging_key);
    expect(new TextDecoder().decode(stored)).toBe('PNG-BYTES');
  });
});
