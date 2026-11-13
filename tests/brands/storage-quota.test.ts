import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assetFromOutput,
  completeStudioAsset,
  deleteStudioAsset,
  reserveStudioAsset,
} from '@/lib/brand-studio/assets';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { loadStudioState } from '@/lib/brand-studio/service';
import { assetHubVisible, studioV2Visible } from '@/lib/brand-studio/visibility';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { runStoryboardOperation } from '@/lib/brand-rooms/storyboards';
import { setPlanAssignment } from '@/lib/brands/plans';
import { reserveBrandAttachment } from '@/lib/brands/workspace/service';
import {
  adminReconcileOrganizationStorage,
  BYTES_PER_GB,
  calculateOrganizationStorageBreakdown,
  formatStorageBytes,
  inspectProjectOnlyRetention,
  loadOrganizationStorageSummary,
  PROPOSED_PLAN_STORAGE_QUOTAS,
  setOrganizationStorageQuota,
} from '@/lib/brands/storage-quota';
import {
  pngBytes,
  requestId,
  studioDeps,
  studioFixture,
  viewerOf,
  type StudioFixture,
} from '@/tests/brand-studio/server/helpers';

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});

afterEach(async () => {
  await f.db.close();
});

const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const owner = () => viewerOf(f.ids.owner);

async function uploadImage(bytes: Uint8Array, name = 'bottle.png') {
  const reserved = await reserveStudioAsset(deps, owner(), {
    organizationId: f.orgId,
    requestId: requestId(),
    name,
    mime: 'image/png',
    sizeBytes: bytes.byteLength,
  });
  if (!reserved.ok) return reserved;
  const key = (
    await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [reserved.id])
  ).rows[0]!.storage_key;
  await deps.staging.putStaging(key, bytes, 'image/png');
  return completeStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: reserved.id });
}

describe('plan storage defaults & admin overrides (docs/BRAND-STORAGE-QUOTAS-F.md)', () => {
  it('resolves confirmed defaults per plan tier (29->200GB, 49->400GB, 69->800GB, project_only->50GB+90d) and enforces admin-only optimistic concurrency + audit log', async () => {
    const initial = await loadOrganizationStorageSummary(f.sql, f.orgId);
    expect(initial.tier).toBe('unassigned');
    expect(initial.effectiveQuotaBytes).toBe(50 * BYTES_PER_GB);
    expect(initial.state).toBe('ok');

    expect(PROPOSED_PLAN_STORAGE_QUOTAS.b2b_29.defaultQuotaBytes).toBe(200 * BYTES_PER_GB);
    expect(PROPOSED_PLAN_STORAGE_QUOTAS.b2b_49.defaultQuotaBytes).toBe(400 * BYTES_PER_GB);
    expect(PROPOSED_PLAN_STORAGE_QUOTAS.b2b_69.defaultQuotaBytes).toBe(800 * BYTES_PER_GB);
    expect(PROPOSED_PLAN_STORAGE_QUOTAS.project_only.defaultQuotaBytes).toBe(50 * BYTES_PER_GB);
    expect(PROPOSED_PLAN_STORAGE_QUOTAS.project_only.defaultRetentionDays).toBe(90);

    const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_49',
      billingMode: 'invoice',
      startedOn: today,
      endsOn: null,
      seats: 10,
      note: '49 plan contract',
      expectedRevision: 0,
    });
    const growth = await loadOrganizationStorageSummary(f.sql, f.orgId);
    expect(growth.tier).toBe('b2b_49');
    expect(growth.effectiveQuotaBytes).toBe(PROPOSED_PLAN_STORAGE_QUOTAS.b2b_49.defaultQuotaBytes);
    expect(growth.effectiveQuotaBytes).toBe(400 * BYTES_PER_GB);

    // Non-admins cannot override quotas.
    expect(
      await setOrganizationStorageQuota({ sql: f.sql }, owner(), {
        organizationId: f.orgId,
        quotaBytes: 500 * BYTES_PER_GB,
        retentionDays: null,
        note: 'try escalate',
        expectedRevision: growth.revision,
      }),
    ).toMatchObject({ ok: false, code: 'forbidden' });

    // Admin sets custom quota + retention override; stale revision fails with conflict.
    const saved1 = await setOrganizationStorageQuota({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      quotaBytes: 350 * BYTES_PER_GB,
      retentionDays: 120,
      note: '26SS enterprise addendum',
      expectedRevision: growth.revision,
    });
    expect(saved1).toEqual({ ok: true, id: f.orgId, revision: growth.revision + 1 });

    expect(
      await setOrganizationStorageQuota({ sql: f.sql }, admin(), {
        organizationId: f.orgId,
        quotaBytes: null,
        retentionDays: null,
        note: 'stale',
        expectedRevision: growth.revision,
      }),
    ).toMatchObject({ ok: false, code: 'conflict' });

    const overridden = await loadOrganizationStorageSummary(f.sql, f.orgId);
    expect(overridden.overrideQuotaBytes).toBe(350 * BYTES_PER_GB);
    expect(overridden.effectiveQuotaBytes).toBe(350 * BYTES_PER_GB);
    expect(overridden.retentionDays).toBe(120);
    expect(overridden.note).toBe('26SS enterprise addendum');

    const events = (
      await f.sql.query<{ revision: number; next_quota_bytes: string; next_retention_days: number; note: string }>(
        'select revision, next_quota_bytes::text, next_retention_days, note from brand_storage_quota_events where organization_id = $1',
        [f.orgId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(Number(events[0]!.next_quota_bytes)).toBe(350 * BYTES_PER_GB);
    expect(events[0]!.next_retention_days).toBe(120);
  });

  it('formats bytes cleanly in ko and en', () => {
    expect(formatStorageBytes(512, 'ko')).toBe('512 B');
    expect(formatStorageBytes(2048, 'en')).toBe('2 KB');
    expect(formatStorageBytes(18.24 * 1024 * 1024, 'ko')).toBe('18.2 MB');
    expect(formatStorageBytes(50 * BYTES_PER_GB, 'ko')).toBe('50 GB');
  });
});

describe('deduplicated byte aggregation, 80% warn vs 100% upload block, and physical cleanup', () => {
  it('counts shared storage_key once when an output is saved into assets or a storyboard creates v2', async () => {
    const created = await createStudioJob(deps, owner(), {
      kind: 'image',
      organizationId: f.orgId,
      requestId: requestId(),
      model: 'seedream-5.5',
      prompt: 'Studio product bottle on stone',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
      references: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });

    const state1 = await loadStudioState(deps, owner(), f.orgId);
    expect(state1.ok).toBe(true);
    if (!state1.ok) return;
    const outId = state1.jobs[0]!.outputs[0]!.id;

    const beforeSave = await calculateOrganizationStorageBreakdown(f.sql, f.orgId);
    expect(beforeSave.breakdown.studioUnsavedOutputsBytes).toBeGreaterThan(0);
    expect(beforeSave.breakdown.studioSavedBytes).toBe(0);

    const saved = await assetFromOutput(deps, owner(), { organizationId: f.orgId, outputId: outId });
    expect(saved.ok).toBe(true);

    const afterSave = await calculateOrganizationStorageBreakdown(f.sql, f.orgId);
    // Physical bytes did not double: they moved from unsaved outputs into saved generation assets!
    expect(afterSave.totalBytes).toBe(beforeSave.totalBytes);
    expect(afterSave.breakdown.studioSavedBytes).toBe(beforeSave.totalBytes);
    expect(afterSave.breakdown.studioUnsavedOutputsBytes).toBe(0);
  });

  it('warns at >= 80% while allowing uploads, blocks ONLY new uploads at >= 100%, and frees space + deletes physical object on delete', async () => {
    const img1 = await pngBytes(240, 240);
    const img2 = await pngBytes(320, 200);
    // Set quota so img1 alone puts usage between 80% and 99%, and img1 + img2 exceeds 100%.
    const quotaBytes = Math.floor(img1.byteLength / 0.85);
    const initSummary = await loadOrganizationStorageSummary(f.sql, f.orgId);
    await setOrganizationStorageQuota({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      quotaBytes,
      retentionDays: null,
      note: 'tight test quota',
      expectedRevision: initSummary.revision,
    });

    const up1 = await uploadImage(img1, 'first.png');
    expect(up1.ok).toBe(true);
    if (!up1.ok) return;

    // Reconcile and verify 80%+ near_limit state (warning shown, uploadBlocked = false).
    await adminReconcileOrganizationStorage({ sql: f.sql }, admin(), f.orgId);
    const stateNear = await loadStudioState(deps, owner(), f.orgId);
    expect(stateNear.ok).toBe(true);
    if (!stateNear.ok) return;
    expect(stateNear.storage?.state).toBe('near_limit');
    expect(stateNear.storage?.uploadBlocked).toBe(false);

    // Attempting to upload img2 pushes total over 100% -> refused with storage_quota_exceeded!
    const blockedStudio = await reserveStudioAsset(deps, owner(), {
      organizationId: f.orgId,
      requestId: requestId(),
      name: 'second.png',
      mime: 'image/png',
      sizeBytes: img2.byteLength,
    });
    expect(blockedStudio).toEqual({ ok: false, code: 'storage_quota_exceeded' });

    // Room attachment & storyboard cut uploads are also refused cleanly with storage_quota_exceeded!
    const roomBlocked = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(),
      'attachment.reserve',
      {
        organizationId: f.orgId,
        projectId: 'general',
        name: 'deck.pdf',
        mime: 'application/pdf',
        size: img2.byteLength,
      },
    );
    expect(roomBlocked.result).toEqual({ ok: false, code: 'storage_quota_exceeded' });

    const boardCreated = await runStoryboardOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(),
      'board.create',
      { organizationId: f.orgId, projectId: f.projectId, title: 'Cut board' },
    );
    expect(boardCreated.ok).toBe(true);
    if (!boardCreated.ok || !('board' in boardCreated)) return;

    const frameBlocked = await runStoryboardOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(),
      'frame.reserve',
      {
        organizationId: f.orgId,
        projectId: f.projectId,
        storyboardId: boardCreated.board.id,
        name: 'cut1.png',
        mime: 'image/png',
        sizeBytes: img2.byteLength,
      },
    );
    expect(frameBlocked).toEqual({ ok: false, code: 'storage_quota_exceeded' });

    // Project brief/workspace attachment upload is also refused for customer, while studio staff delivery remains allowed!
    const projAttBlocked = await reserveBrandAttachment({ sql: f.sql }, owner(), {
      projectId: f.projectId,
      purpose: 'workspace',
      requestId: randomUUID(),
      name: 'brief.pdf',
      mime: 'application/pdf',
      sizeBytes: img2.byteLength,
    });
    expect(projAttBlocked).toEqual({ ok: false, code: 'storage_quota_exceeded' });

    // Lower quota to <= img1.byteLength so state is 'exceeded' (100%): reads & deletes MUST still work!
    const cur = await loadOrganizationStorageSummary(f.sql, f.orgId);
    await setOrganizationStorageQuota({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      quotaBytes: img1.byteLength,
      retentionDays: null,
      note: 'exact 100%',
      expectedRevision: cur.revision,
    });
    const stateFull = await loadStudioState(deps, owner(), f.orgId);
    expect(stateFull.ok).toBe(true);
    if (!stateFull.ok) return;
    expect(stateFull.storage?.state).toBe('exceeded');
    expect(stateFull.storage?.uploadBlocked).toBe(true);
    expect(stateFull.assets).toHaveLength(1);

    const storedKey = (
      await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [up1.asset.id])
    ).rows[0]!.storage_key;
    expect((await deps.media.read(storedKey)).byteLength).toBe(img1.byteLength);

    // Customer deletes first.png while at 100% -> succeeds, physically deletes unreferenced object, and frees quota!
    const deleted = await deleteStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: up1.asset.id });
    expect(deleted).toEqual({ ok: true });
    await expect(deps.media.read(storedKey)).rejects.toThrow();

    const afterDelete = await loadOrganizationStorageSummary(f.sql, f.orgId);
    expect(afterDelete.usedBytes).toBe(0);
    expect(afterDelete.state).toBe('ok');
  });

  it('keeps physical st/ object alive while referenced by a live room message, then deletes it when the message is deleted', async () => {
    const img = await pngBytes(180, 180);
    const up = await uploadImage(img, 'shared.png');
    expect(up.ok).toBe(true);
    if (!up.ok) return;

    const storedKey = (
      await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [up.asset.id])
    ).rows[0]!.storage_key;

    // Reference the exact same st/ key in a live room message attachment.
    const sent = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(),
      'message.send',
      {
        organizationId: f.orgId,
        projectId: 'general',
        requestId: randomUUID(),
        body: 'Sharing product cut',
        attachments: [{ key: storedKey, name: 'shared.png', size: img.byteLength, width: 180, height: 180 }],
      },
    );
    expect(sent.result.ok).toBe(true);
    if (!sent.result.ok || !('message' in sent.result)) return;

    // Deleting the studio asset MUST NOT delete the physical file while the room message still points to it!
    await deleteStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: up.asset.id });
    expect((await deps.media.read(storedKey)).byteLength).toBe(img.byteLength);

    // Deleting the room message drops the last live reference -> physical object is now removed!
    const msgDeleted = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(),
      'message.delete',
      {
        organizationId: f.orgId,
        projectId: 'general',
        messageId: sent.result.message.id,
      },
    );
    expect(msgDeleted.result).toEqual({ ok: true });
    await expect(deps.media.read(storedKey)).rejects.toThrow();
  });
});

describe('project-only retention dry-run & Morphic isolation', () => {
  it('flags expired retention in dry-run mode without deleting data, and hides storage meter from Morphic', async () => {
    const init = await loadOrganizationStorageSummary(f.sql, f.orgId);
    await setOrganizationStorageQuota({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      quotaBytes: 30 * BYTES_PER_GB,
      retentionDays: 90,
      note: 'project-only 90d retention',
      expectedRevision: init.revision,
    });

    // Mark the fixture project completed 95 days ago.
    await f.sql.query(
      "update brand_projects set status = 'completed', updated_at = now() - interval '95 days' where id = $1",
      [f.projectId],
    );
    const report = await inspectProjectOnlyRetention(f.sql, f.orgId);
    expect(report.retentionDays).toBe(90);
    expect(report.daysSinceLastDelivery).toBeGreaterThanOrEqual(95);
    expect(report.expired).toBe(true);

    // Project-only orgs (`self_studio` denied) keep Asset Hub + Storage Meter visible, while Morphic / sandbox / `generative_media`-denied choices get false everywhere.
    expect(
      assetHubVisible(
        { id: randomUUID(), name: 'Project Only Corp', denied: ['self_studio'] },
        true,
      ),
    ).toBe(true);
    expect(
      assetHubVisible(
        { id: 'd425c3b1-4066-4970-8a3b-93c52b3eef70', name: 'Client A', denied: [] },
        true,
      ),
    ).toBe(false);
    expect(
      assetHubVisible(
        { id: randomUUID(), name: 'Morphic Studio', denied: [] },
        true,
      ),
    ).toBe(false);
    expect(
      studioV2Visible(
        { id: randomUUID(), name: 'Project Only Corp', denied: ['generative_media'] },
        true,
      ),
    ).toBe(false);
  });
});
