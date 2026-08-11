import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorizeMedia } from '@/lib/media/authorize';
import {
  adminMediaPath,
  adminTokenRef,
  authorizeAdminMedia,
} from '@/lib/media/admin-authorize';
import { MEDIA_TOKEN_TTL_SECONDS, mintMediaToken, verifyMediaToken } from '@/lib/media/token';
import { heroRef } from '@/lib/content/media-ref';
import { copyPublishManifest, preparePublish, publishRevision } from '@/lib/publish/pipeline';
import { runner } from '../helpers/pglite';
import { createDraft } from '../helpers/factory';
import { adminHarness, expectOk, upload, viewerOf, type AdminHarness } from '../helpers/admin';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SECRET = 'admin-media-test-secret-0123456789';

/**
 * The M2-flagged item, now owned by M4: admin preview media.
 *
 * Two properties are being defended at once, and the second is the one that could regress silently:
 *   1. an admin — and only an admin — can read a DRAFT revision's staging bytes;
 *   2. the PUBLIC gateway still refuses exactly what it refused in M2, admins included.
 */
describe('admin media endpoint (§3.8 preview-as)', () => {
  let harness: AdminHarness;
  let draftBlockId: string;
  let draftRevisionId: string;

  beforeEach(async () => {
    harness = await adminHarness();
    const draft = await createDraft(harness.db, harness.storage, {
      slug: 'preview-media',
      withHero: true,
      blocks: [],
    });
    draftRevisionId = draft.revisionId;
    expectOk(
      await harness.run('block.create', {
        stepId: draft.stepId,
        kind: 'asset',
        file: upload('draft.png', 'DRAFT-BYTES'),
        captionEn: 'Draft frame',
        captionKo: '초안 프레임',
      }),
    );
    const { rows } = await harness.db.query<{ id: string }>(
      `select b.id from blocks b join steps s on s.id = b.step_id
        where s.revision_id = $1 and b.kind = 'asset'`,
      [draft.revisionId],
    );
    draftBlockId = rows[0]!.id;
  });

  afterEach(async () => {
    await harness.close();
  });

  const sql = () => runner(harness.db);

  it('answers 401 for an anonymous viewer', async () => {
    const decision = await authorizeAdminMedia(sql(), viewerOf('anon'), draftBlockId);
    expect(decision).toEqual({ status: 'unauthorized' });
  });

  for (const tier of ['free', 'pro'] as const) {
    it(`answers 403 for a signed-in ${tier} viewer`, async () => {
      const decision = await authorizeAdminMedia(sql(), viewerOf(tier), draftBlockId);
      expect(decision).toEqual({ status: 'forbidden' });
    });
  }

  it('serves a DRAFT revision asset to an admin, from staging', async () => {
    const decision = await authorizeAdminMedia(sql(), viewerOf('admin'), draftBlockId);
    expect(decision.status).toBe('ok');
    if (decision.status !== 'ok') return;
    expect(decision.object.bucket).toBe('content');
    expect(decision.object.key.startsWith(`content/rev/${draftRevisionId}/`)).toBe(true);
    expect(decision.object.revisionState).toBe('draft');
    expect(decision.object.mime).toBe('image/png');

    const bytes = await harness.storage.read('content', decision.object.key);
    expect(new TextDecoder().decode(bytes)).toBe('DRAFT-BYTES');
  });

  it('serves a draft hero under the `{revisionId}:hero` ref', async () => {
    const decision = await authorizeAdminMedia(sql(), viewerOf('admin'), heroRef(draftRevisionId));
    expect(decision.status).toBe('ok');
    if (decision.status !== 'ok') return;
    expect(decision.object.kind).toBe('hero');
    expect(decision.object.bucket).toBe('content');
  });

  it('refuses refs that carry no asset at all', async () => {
    const { rows } = await harness.db.query<{ id: string }>(
      `select id from steps where revision_id = $1`,
      [draftRevisionId],
    );
    // A step id is a well-formed uuid that is not a block — and must not resolve to anything.
    expect(await authorizeAdminMedia(sql(), viewerOf('admin'), rows[0]!.id)).toEqual({
      status: 'not_found',
    });
    expect(await authorizeAdminMedia(sql(), viewerOf('admin'), 'not-a-uuid')).toEqual({
      status: 'not_found',
    });
  });

  // -------------------------------------------------------------------------
  // token discipline (§3.3's ≤60s window, with an admin-only binding)
  // -------------------------------------------------------------------------

  it('mints a ≤60s token bound to `admin:{ref}` and honours its expiry', async () => {
    const now = Date.UTC(2026, 7, 12, 12, 0, 0);
    const { token, expiresAt } = mintMediaToken(
      { ref: adminTokenRef(draftBlockId), bucket: 'content', key: 'content/rev/x/y.png' },
      { now, secret: SECRET },
    );
    expect(expiresAt - Math.floor(now / 1000)).toBe(MEDIA_TOKEN_TTL_SECONDS);

    expect(
      verifyMediaToken(token, { ref: adminTokenRef(draftBlockId), now, secret: SECRET }).ok,
    ).toBe(true);

    const expired = verifyMediaToken(token, {
      ref: adminTokenRef(draftBlockId),
      now: now + (MEDIA_TOKEN_TTL_SECONDS + 1) * 1000,
      secret: SECRET,
    });
    expect(expired).toEqual({ ok: false, reason: 'expired' });
  });

  it('cannot be replayed against the public gateway, nor a public token against it', async () => {
    const now = Date.now();
    const adminToken = mintMediaToken(
      { ref: adminTokenRef(draftBlockId), bucket: 'content', key: 'k' },
      { now, secret: SECRET },
    ).token;
    // The public route verifies against the BARE ref, which no longer matches.
    expect(verifyMediaToken(adminToken, { ref: draftBlockId, now, secret: SECRET })).toEqual({
      ok: false,
      reason: 'ref_mismatch',
    });

    const publicToken = mintMediaToken(
      { ref: draftBlockId, bucket: 'content-published', key: 'k' },
      { now, secret: SECRET },
    ).token;
    expect(
      verifyMediaToken(publicToken, { ref: adminTokenRef(draftBlockId), now, secret: SECRET }),
    ).toEqual({ ok: false, reason: 'ref_mismatch' });
  });

  it('emits its own path from the shaper, never the public one', () => {
    expect(adminMediaPath(draftBlockId)).toBe(`/api/admin/media/${draftBlockId}`);
    expect(adminMediaPath(heroRef(draftRevisionId))).toContain('%3Ahero');
  });
});

/**
 * REGRESSION — M2's acceptance, restated here because M4 is the milestone that could break it:
 * "the gateway refuses draft/superseded block ids", for EVERY viewer including an admin.
 */
describe('the public media gateway is unchanged by the admin path (§3.3)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('still refuses a draft revision block, admins included', async () => {
    const draft = await createDraft(harness.db, harness.storage, {
      slug: 'gateway-draft',
      withHero: true,
      blocks: [],
    });
    expectOk(
      await harness.run('block.create', {
        stepId: draft.stepId,
        kind: 'asset',
        file: upload('draft.png', 'DRAFT'),
      }),
    );
    const { rows } = await harness.db.query<{ id: string }>(
      `select b.id from blocks b join steps s on s.id = b.step_id where s.revision_id = $1`,
      [draft.revisionId],
    );

    for (const tier of ['anon', 'free', 'pro', 'admin'] as const) {
      expect(await authorizeMedia(runner(harness.db), viewerOf(tier), rows[0]!.id), tier).toEqual({
        status: 'not_found',
      });
      expect(
        await authorizeMedia(runner(harness.db), viewerOf(tier), heroRef(draft.revisionId)),
        tier,
      ).toEqual({ status: 'not_found' });
    }
  });

  it('still refuses a SUPERSEDED revision block after a republish', async () => {
    const draft = await createDraft(harness.db, harness.storage, {
      slug: 'gateway-superseded',
      blocks: [{ kind: 'prompt', content: { text: 'p' } }],
    });
    const sql = runner(harness.db);
    await preparePublish(sql, draft.revisionId);
    await copyPublishManifest(sql, harness.storage, draft.revisionId);
    await publishRevision(sql, { playbookId: draft.playbookId, revisionId: draft.revisionId });

    expectOk(await harness.run('revision.openDraft', { playbookId: draft.playbookId }));
    const { rows: drafts } = await harness.db.query<{ id: string }>(
      `select id from playbook_revisions where playbook_id = $1 and state = 'draft'`,
      [draft.playbookId],
    );
    expectOk(
      await harness.run('revision.metadata', {
        revisionId: drafts[0]!.id,
        category: 'pipeline',
        titleEn: 'Fixture title',
        titleKo: '픽스처 제목',
        summaryEn: 'Fixture summary',
        summaryKo: '픽스처 요약',
        changeNoteEn: 'rev two',
        changeNoteKo: '2차 개정',
        difficulty: 'intermediate',
        tools: '',
        models: '',
      }),
    );
    expectOk(
      await harness.run('revision.publish', {
        playbookId: draft.playbookId,
        revisionId: drafts[0]!.id,
        mode: 'full',
      }),
    );

    expect(
      await authorizeMedia(runner(harness.db), viewerOf('admin'), heroRef(draft.revisionId)),
    ).toEqual({ status: 'not_found' });
  });

  it('routes ADMIN PREVIEW media through the admin path in the shaper', () => {
    const access = readFileSync(join(ROOT, 'lib', 'content', 'playbook-access.ts'), 'utf8');
    expect(access).toContain('PREVIEW_URLS');
    expect(access).toContain('adminMediaPath');
    // The public branch is untouched: no admin path can leak into it.
    expect(access).toContain('wantsPreview ? PREVIEW_URLS : SHAPE_URLS');
  });
});
