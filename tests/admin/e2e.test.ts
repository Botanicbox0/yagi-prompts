import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPublicCatalog } from '@/lib/content/catalog';
import { EMPTY_QUERY, loadLibrary } from '@/lib/content/library';
import { shapePlaybook } from '@/lib/content/playbook-access';
import { authorizeMedia } from '@/lib/media/authorize';
import { authorizeAdminMedia } from '@/lib/media/admin-authorize';
import { runner } from '../helpers/pglite';
import { adminHarness, expectOk, upload, viewerOf, type AdminHarness } from '../helpers/admin';

/**
 * PLAN §8 M4 acceptance — "[manual] author→publish a real playbook end to end **without SQL**".
 *
 * This is that gate, automated as far as the seam allows: every WRITE below goes through an admin
 * operation (the same ones the editor's forms post). Ids are read back the way a page reads them,
 * because a browser gets them from a rendered link — that is navigation, not authoring.
 *
 * The manual click-path for the Director is in docs/SETUP.md ("Render-verifying the admin CMS").
 */
describe('author → publish, without a line of SQL (§8 M4)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('creates, authors, previews, publishes, and lands in the public catalog', async () => {
    const sql = runner(harness.db);

    // 1. create ------------------------------------------------------------
    const created = expectOk(
      await harness.run('playbook.create', {
        slug: 'insta-toon-pipeline',
        category: 'image',
        titleEn: 'Insta-toon pipeline',
        titleKo: '인스타툰 파이프라인',
      }),
    );
    const playbookId = created.to!.replace('/admin/p/', '');

    const draftId = async () => {
      const { rows } = await harness.db.query<{ id: string }>(
        `select id from playbook_revisions where playbook_id = $1 and state = 'draft'`,
        [playbookId],
      );
      return rows[0]!.id;
    };
    const revisionId = await draftId();

    // 2. metadata + hero ---------------------------------------------------
    expectOk(
      await harness.run('revision.metadata', {
        revisionId,
        category: 'image',
        titleEn: 'Insta-toon pipeline',
        titleKo: '인스타툰 파이프라인',
        summaryEn: 'Four-cut stories from script to published panels.',
        summaryKo: '대본에서 게시까지, 네 컷 이야기를 만드는 흐름입니다.',
        difficulty: 'intermediate',
        tools: 'ComfyUI, Photoshop',
        models: 'Nano Banana',
        estTimeMin: '60',
        estCostUsd: '0.8',
        isShowcase: 'on',
      }),
    );
    expectOk(
      await harness.run('revision.hero', {
        revisionId,
        file: upload('hero.png', 'HERO-BYTES'),
      }),
    );

    // 3. steps -------------------------------------------------------------
    for (const [en, ko] of [
      ['Write the four beats', '네 컷 구성'],
      ['Render the panels', '패널 렌더'],
    ]) {
      expectOk(await harness.run('step.create', { revisionId, titleEn: en, titleKo: ko }));
    }
    const { rows: steps } = await harness.db.query<{ id: string; order: number }>(
      `select id, "order" from steps where revision_id = $1 order by "order"`,
      [revisionId],
    );
    expect(steps).toHaveLength(2);
    expectOk(
      await harness.run('step.update', {
        stepId: steps[0]!.id,
        titleEn: 'Write the four beats',
        titleKo: '네 컷 구성',
        bodyEn: 'Four beats, one turn.',
        bodyKo: '네 컷, 반전 하나.',
      }),
    );

    // 4. one block of every kind, including an upload for each asset kind ---
    expectOk(
      await harness.run('block.create', {
        stepId: steps[0]!.id,
        kind: 'note',
        mdEn: '**Placeholder.** Twenty frames beat two hundred.',
        mdKo: '**플레이스홀더.** 스무 장이 이백 장보다 낫습니다.',
      }),
    );
    expectOk(
      await harness.run('block.create', {
        stepId: steps[0]!.id,
        kind: 'link',
        url: 'https://example.com/reference',
        labelEn: 'Reference guide',
        labelKo: '레퍼런스 가이드',
      }),
    );
    expectOk(
      await harness.run('block.create', {
        stepId: steps[1]!.id,
        kind: 'prompt',
        text: 'four panel comic, consistent character, flat colour',
        model: 'Nano Banana',
      }),
    );
    expectOk(
      await harness.run('block.create', {
        stepId: steps[1]!.id,
        kind: 'params',
        paramKey: ['size', 'steps'],
        paramValue: ['1080x1080', '28'],
      }),
    );
    expectOk(
      await harness.run('block.create', {
        stepId: steps[1]!.id,
        kind: 'asset',
        file: upload('panel.png', 'PANEL-BYTES'),
        captionEn: 'Placeholder panel',
        captionKo: '플레이스홀더 패널',
      }),
    );
    expectOk(
      await harness.run('block.create', {
        stepId: steps[1]!.id,
        kind: 'workflow_file',
        file: upload('toon.json', '{"nodes":[]}', 'application/json'),
        filename: 'insta-toon.json',
        format: 'comfyui',
      }),
    );

    // 5. preview-as, all three tiers, through the real façade ---------------
    const previews: Record<string, number> = {};
    for (const tier of ['anon', 'free', 'pro'] as const) {
      const result = await shapePlaybook(
        { sql, viewer: viewerOf('admin') },
        'insta-toon-pipeline',
        { revisionId, previewTier: tier },
      );
      expect(result.status, tier).toBe('ok');
      if (result.status !== 'ok') continue;
      expect(result.preview).toBe(true);
      previews[tier] = result.playbook.lockedCount;
      // Draft media has never been published: it resolves to the admin endpoint, never the public one.
      for (const step of result.playbook.steps) {
        for (const block of step.blocks) {
          if (block.locked) continue;
          if (block.content.kind === 'asset' || block.content.kind === 'workflow_file') {
            expect(block.content.asset.src.startsWith('/api/admin/media/')).toBe(true);
          }
        }
      }
    }
    // Default policy: prompt/params/workflow_file are pro, asset/note free, link public.
    expect(previews).toEqual({ anon: 5, free: 3, pro: 0 });

    // …and the media the preview points at really is readable by an admin.
    const { rows: assetBlocks } = await harness.db.query<{ id: string }>(
      `select b.id from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1 and b.kind = 'asset'`,
      [revisionId],
    );
    const previewMedia = await authorizeAdminMedia(sql, viewerOf('admin'), assetBlocks[0]!.id);
    expect(previewMedia.status).toBe('ok');

    // 6. publish -----------------------------------------------------------
    expectOk(
      await harness.run('revision.publish', { playbookId, revisionId, mode: 'full' }),
    );
    expect(harness.revalidated).toBe(1);

    // 7. it is in the PUBLIC catalog and the library ------------------------
    const catalog = await loadPublicCatalog(sql);
    const card = catalog.cards.find((entry) => entry.slug === 'insta-toon-pipeline');
    expect(card).toBeDefined();
    expect(card!.isShowcase).toBe(true);
    expect(card!.stepCount).toBe(2);
    expect(card!.proBlockCount).toBe(3);
    expect(card!.hero?.key).toMatch(/^[a-f0-9]{64}\.png$/);

    const library = await loadLibrary(sql, EMPTY_QUERY);
    expect(library.visible.map((entry) => entry.slug)).toContain('insta-toon-pipeline');

    // 8. the detail page renders for every tier, gated as stamped -----------
    for (const [tier, expected] of [
      ['anon', 5],
      ['free', 3],
      ['pro', 0],
    ] as const) {
      const result = await shapePlaybook({ sql, viewer: viewerOf(tier) }, 'insta-toon-pipeline');
      expect(result.status, tier).toBe('ok');
      if (result.status !== 'ok') continue;
      expect(result.playbook.lockedCount, tier).toBe(expected);
      expect(result.preview).toBe(false);
      // No staging key survives shaping, at any tier.
      expect(JSON.stringify(result.playbook)).not.toContain('content/rev/');
    }

    // 9. the gateway serves its media, and refuses what it should -----------
    const published = await authorizeMedia(sql, viewerOf('free'), assetBlocks[0]!.id);
    expect(published.status).toBe('ok');
    if (published.status === 'ok') {
      expect(published.object.bucket).toBe('content-published');
      const bytes = await harness.storage.read(published.object.bucket, published.object.key);
      expect(new TextDecoder().decode(bytes)).toBe('PANEL-BYTES');
    }

    const { rows: workflowBlocks } = await harness.db.query<{ id: string }>(
      `select b.id from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1 and b.kind = 'workflow_file'`,
      [revisionId],
    );
    // `pro` by default policy ⇒ a free viewer is refused the bytes as well as the render.
    expect(await authorizeMedia(sql, viewerOf('free'), workflowBlocks[0]!.id)).toMatchObject({
      status: 'forbidden',
    });
    const proWorkflow = await authorizeMedia(sql, viewerOf('pro'), workflowBlocks[0]!.id);
    expect(proWorkflow.status).toBe('ok');
    if (proWorkflow.status === 'ok') {
      expect(proWorkflow.object.bucket).toBe('artifacts-published');
      expect(proWorkflow.object.filename).toBe('insta-toon.json');
    }
  });
});
