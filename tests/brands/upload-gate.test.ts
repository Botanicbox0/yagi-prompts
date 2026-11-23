import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlanAssignment } from '@/lib/brands/plans';
import {
  countOrganizationUploadedFiles,
  isOrganizationUploadApproved,
  UPLOAD_GATE_APPLIES_FROM,
  UNAPPROVED_UPLOAD_MAX_FILES,
  UNAPPROVED_UPLOAD_QUOTA_BYTES,
} from '@/lib/brands/upload-gate';
import {
  loadOrganizationStorageSummary,
  reconcileOrganizationStorage,
  setOrganizationStorageQuota,
} from '@/lib/brands/storage-quota';
import { reserveStudioAsset } from '@/lib/brand-studio/assets';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { runStoryboardOperation } from '@/lib/brand-rooms/storyboards';
import { reserveBrandAttachment, storeBrandOrganizationLogo } from '@/lib/brands/workspace/service';
import {
  pngBytes,
  requestId,
  studioDeps,
  studioFixture,
  viewerOf,
  type StudioFixture,
} from '@/tests/brand-studio/server/helpers';

const fixtures: StudioFixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const f = fixtures.pop()!;
    await f.db.close();
  }
});

async function setupFixture(options: { capKrw?: number | null; createdAt?: string } = {}) {
  const f = await studioFixture({ capKrw: options.capKrw });
  fixtures.push(f);
  const createdAt = options.createdAt ?? '2026-11-25T00:00:00+09:00';
  await f.sql.query('update brand_organizations set created_at = $2 where id = $1', [f.orgId, createdAt]);
  return { f, deps: studioDeps(f.sql) };
}

const owner = (f: StudioFixture) => viewerOf(f.ids.owner);
const admin = (f: StudioFixture) => ({ ...viewerOf(f.ids.admin), isAdmin: true });

describe('unapproved workspace upload gate (500 MB & 50 files)', () => {
  it('applies ONLY to new self-created workspaces at/after cutoff without plan, allowance, staff record, or override (B1)', async () => {
    expect(UPLOAD_GATE_APPLIES_FROM).toBe('2026-11-24T00:00:00+09:00');

    // 1) Organization created BEFORE cutoff is NEVER gated, even with capKrw=0, no plan, and 600 files!
    const oldOrg = await setupFixture({ capKrw: null, createdAt: '2026-11-23T23:59:59+09:00' });
    expect(await isOrganizationUploadApproved(oldOrg.f.sql, oldOrg.f.orgId)).toBe(true);
    for (let i = 0; i < 60; i++) {
      await oldOrg.f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', 1024, $4, 'upload', 'ready', $5, $6)`,
        [randomUUID(), oldOrg.f.orgId, `old-${i}.png`, `st/old-${i}.png`, oldOrg.f.ids.owner, randomUUID()],
      );
    }
    const oldUpload = await reserveStudioAsset(oldOrg.deps, owner(oldOrg.f), {
      organizationId: oldOrg.f.orgId,
      requestId: requestId(),
      name: 'old-61.png',
      mime: 'image/png',
      sizeBytes: 1024,
    });
    expect(oldUpload.ok).toBe(true);

    // 2) Brand-new workspace at/after cutoff starts gated until approved.
    const { f } = await setupFixture({ capKrw: null });
    expect(await isOrganizationUploadApproved(f.sql, f.orgId)).toBe(false);

    await f.sql.query(
      'insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 0)',
      [f.orgId],
    );
    expect(await isOrganizationUploadApproved(f.sql, f.orgId)).toBe(false);

    // 3) ANY plan assignment that has ever existed (even ended) approves the organization.
    const yesterday = new Date(Date.now() + 9 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() + 9 * 3_600_000 - 7 * 86_400_000).toISOString().slice(0, 10);
    await setPlanAssignment({ sql: f.sql }, admin(f), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: weekAgo,
      endsOn: yesterday,
      seats: 5,
      note: 'historical plan',
      expectedRevision: 0,
    });
    expect(await isOrganizationUploadApproved(f.sql, f.orgId)).toBe(true);

    // 4) Campaign-only / commissioned client created after cutoff with a staff-created project is NEVER gated.
    const commissioned = await setupFixture({ capKrw: null });
    await commissioned.f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, created_by, request_id, client_visible)
       values ($1, $2, 'Staff Project', 'Campaign brief', 'creator', 'active', $3, $4, true)`,
      [randomUUID(), commissioned.f.orgId, commissioned.f.ids.admin, randomUUID()],
    );
    expect(await isOrganizationUploadApproved(commissioned.f.sql, commissioned.f.orgId)).toBe(true);

    // 5) Admin storage-quota override ALWAYS wins, is NEVER reduced to 500 MB, and exempts from pre-approval gate.
    const overridden = await setupFixture({ capKrw: null });
    const overrideRes = await setOrganizationStorageQuota({ sql: overridden.f.sql }, admin(overridden.f), {
      organizationId: overridden.f.orgId,
      quotaBytes: 2 * 1024 * 1024 * 1024,
      retentionDays: null,
      note: 'B1 admin override test',
      expectedRevision: 0,
    });
    expect(overrideRes.ok).toBe(true);
    expect(await isOrganizationUploadApproved(overridden.f.sql, overridden.f.orgId)).toBe(true);
    const overSummary = await loadOrganizationStorageSummary(overridden.f.sql, overridden.f.orgId);
    expect(overSummary.effectiveQuotaBytes).toBe(2 * 1024 * 1024 * 1024);

    // Separate fixture approved solely by allowance capKrw > 0.
    const byAllowance = await setupFixture({ capKrw: 10_000 });
    expect(await isOrganizationUploadApproved(byAllowance.f.sql, byAllowance.f.orgId)).toBe(true);
  });

  it('caps unapproved workspaces at 500 MB across every customer upload path and allows exact boundary', async () => {
    expect(UNAPPROVED_UPLOAD_QUOTA_BYTES).toBe(500 * 1024 * 1024);
    expect(UNAPPROVED_UPLOAD_MAX_FILES).toBe(50);

    const { f, deps } = await setupFixture({ capKrw: null });
    const summary = await loadOrganizationStorageSummary(f.sql, f.orgId);
    expect(summary.effectiveQuotaBytes).toBe(UNAPPROVED_UPLOAD_QUOTA_BYTES);

    const boardRes = await runStoryboardOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'board.create',
      { organizationId: f.orgId, projectId: f.projectId, title: 'Board' },
    );
    expect(boardRes.ok).toBe(true);
    if (!boardRes.ok || !('board' in boardRes)) return;

    // Seed ready assets totaling 490 MB across 25 files (< 50 files) so 10 MB remains up to the exact 500 MB boundary.
    const chunk = 10 * 1024 * 1024;
    for (let i = 0; i < 25; i++) {
      const size = i < 24 ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
      await f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', $4, $5, 'upload', 'ready', $6, $7)`,
        [randomUUID(), f.orgId, `p${i}.png`, size, `st/seed-${i}.png`, f.ids.owner, randomUUID()],
      );
    }
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(25);
    await reconcileOrganizationStorage(f.sql, f.orgId);

    // Exactly remaining 10 MB fits inside 500 MB + 50 files!
    const exactFit = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'attachment.reserve',
      { organizationId: f.orgId, projectId: 'general', name: 'fit.pdf', mime: 'application/pdf', size: chunk },
    );
    expect(exactFit.result.ok).toBe(true);

    // 1 byte over 500 MB is refused across every customer upload path.
    const studioBlocked = await reserveStudioAsset(deps, owner(f), {
      organizationId: f.orgId,
      requestId: requestId(),
      name: 'over.png',
      mime: 'image/png',
      sizeBytes: chunk + 1,
    });
    expect(studioBlocked).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' });

    const roomBlocked = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'attachment.reserve',
      { organizationId: f.orgId, projectId: 'general', name: 'over.pdf', mime: 'application/pdf', size: chunk + 1 },
    );
    expect(roomBlocked.result).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' });

    const frameBlocked = await runStoryboardOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'frame.reserve',
      { organizationId: f.orgId, projectId: f.projectId, storyboardId: boardRes.board.id, name: 'over.png', mime: 'image/png', sizeBytes: chunk + 1 },
    );
    expect(frameBlocked).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' });

    const projectBlocked = await reserveBrandAttachment({ sql: f.sql }, owner(f), {
      projectId: f.projectId,
      purpose: 'workspace',
      requestId: randomUUID(),
      name: 'over.pdf',
      mime: 'application/pdf',
      sizeBytes: chunk + 1,
    });
    expect(projectBlocked).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' });
  });

  it('caps unapproved workspaces at 50 files across all customer upload paths, and lifts both limits once approved', async () => {
    const { f, deps } = await setupFixture({ capKrw: null });
    const boardRes = await runStoryboardOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'board.create',
      { organizationId: f.orgId, projectId: f.projectId, title: 'File cap board' },
    );
    expect(boardRes.ok).toBe(true);
    if (!boardRes.ok || !('board' in boardRes)) return;

    // Seed 49 small uploaded assets across tables so the 50th succeeds and the 51st fails.
    for (let i = 0; i < 49; i++) {
      await f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', 1024, $4, 'upload', 'ready', $5, $6)`,
        [randomUUID(), f.orgId, `small-${i}.png`, `st/small-${i}.png`, f.ids.owner, randomUUID()],
      );
    }

    // 50th file (studio asset) succeeds.
    const fifty = await reserveStudioAsset(deps, owner(f), {
      organizationId: f.orgId,
      requestId: requestId(),
      name: 'fiftieth.png',
      mime: 'image/png',
      sizeBytes: 1024,
    });
    expect(fifty.ok).toBe(true);
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(50);

    // 51st file is refused on studio asset, room attachment, storyboard frame, project attachment, and org logo!
    expect(
      await reserveStudioAsset(deps, owner(f), {
        organizationId: f.orgId,
        requestId: requestId(),
        name: 'fiftyfirst.png',
        mime: 'image/png',
        sizeBytes: 1024,
      }),
    ).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });

    const roomRefused = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'attachment.reserve',
      { organizationId: f.orgId, projectId: 'general', name: 'fiftyfirst.pdf', mime: 'application/pdf', size: 1024 },
    );
    expect(roomRefused.result).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });

    expect(
      await runStoryboardOperation(
        { sql: f.sql, media: deps.media, staging: deps.staging },
        owner(f),
        'frame.reserve',
        { organizationId: f.orgId, projectId: f.projectId, storyboardId: boardRes.board.id, name: 'fiftyfirst.png', mime: 'image/png', sizeBytes: 1024 },
      ),
    ).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });

    expect(
      await reserveBrandAttachment({ sql: f.sql }, owner(f), {
        projectId: f.projectId,
        purpose: 'workspace',
        requestId: randomUUID(),
        name: 'fiftyfirst.pdf',
        mime: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });

    const logoBytes = await pngBytes(32, 32);
    expect(
      await storeBrandOrganizationLogo({ sql: f.sql, storage: deps.staging }, owner(f), {
        organizationId: f.orgId,
        requestId: randomUUID(),
        expectedRevision: 0,
        bytes: logoBytes,
        mime: 'image/png',
      }),
    ).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });

    // Approving the workspace via allowance capKrw > 0 lifts the 50-file / 500 MB cap immediately.
    await f.sql.query(
      'insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 100000)',
      [f.orgId],
    );
    expect(await isOrganizationUploadApproved(f.sql, f.orgId)).toBe(true);
    const afterApprove = await reserveStudioAsset(deps, owner(f), {
      organizationId: f.orgId,
      requestId: requestId(),
      name: 'fiftyfirst.png',
      mime: 'image/png',
      sizeBytes: 1024,
    });
    expect(afterApprove.ok).toBe(true);
  });

  it('never counts or blocks staff uploads, tracks pending room uploads, refuses 49+10 message sends, and allows logo replacement at 50 files (B1, S2, S6)', async () => {
    const { f, deps } = await setupFixture({ capKrw: null });
    // Staff upload on a project attachment is never blocked and never counted toward member quota/file count.
    const staffProjectAtt = await reserveBrandAttachment({ sql: f.sql }, admin(f), {
      projectId: f.projectId,
      purpose: 'workspace',
      requestId: randomUUID(),
      name: 'staff-brief.pdf',
      mime: 'application/pdf',
      sizeBytes: 10 * 1024 * 1024,
    });
    expect(staffProjectAtt.ok).toBe(true);
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(0);
    expect(await isOrganizationUploadApproved(f.sql, f.orgId)).toBe(false);

    // S6: Seed 49 studio uploads + 1 active member logo = 50 total files (organization STILL gated).
    for (let i = 0; i < 49; i++) {
      await f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', 1024, $4, 'upload', 'ready', $5, $6)`,
        [randomUUID(), f.orgId, `s${i}.png`, `st/s${i}.png`, f.ids.owner, randomUUID()],
      );
    }
    const logoBytes = await pngBytes(32, 32);
    const firstLogo = await storeBrandOrganizationLogo({ sql: f.sql, storage: deps.staging }, owner(f), {
      organizationId: f.orgId,
      requestId: randomUUID(),
      expectedRevision: 0,
      bytes: logoBytes,
      mime: 'image/png',
    });
    expect(firstLogo.ok).toBe(true);
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(50);

    // Replacing existing logo at 50 files on a gated org must succeed (not +1).
    const replaceLogo = await storeBrandOrganizationLogo({ sql: f.sql, storage: deps.staging }, owner(f), {
      organizationId: f.orgId,
      requestId: randomUUID(),
      expectedRevision: 1,
      bytes: logoBytes,
      mime: 'image/png',
    });
    expect(replaceLogo.ok).toBe(true);
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(50);
    expect(await isOrganizationUploadApproved(f.sql, f.orgId)).toBe(false);

    // Staff upload on behalf of this 50-file gated org still succeeds and never counts toward member uploads!
    const staffUploadAt50 = await reserveBrandAttachment({ sql: f.sql }, admin(f), {
      projectId: f.projectId,
      purpose: 'contract',
      requestId: randomUUID(),
      name: 'staff-contract.pdf',
      mime: 'application/pdf',
      sizeBytes: 2 * 1024 * 1024,
    });
    expect(staffUploadAt50.ok).toBe(true);
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(50);
    // Staff studio delivery asset also never counts toward member uploads (and marks org commissioned/approved).
    await f.sql.query(
      `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
       values ($1, $2, 'image', 'delivery.png', 'image/png', 100000000, 'st/delivery.png', 'delivery', 'ready', $3, $4)`,
      [randomUUID(), f.orgId, f.ids.admin, randomUUID()],
    );
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(50);
    expect(await isOrganizationUploadApproved(f.sql, f.orgId)).toBe(true);

    // S2: Fresh 49-file gated org: reserve room attachment without sending -> pending reservation counts toward 50!
    const roomOrg = await setupFixture({ capKrw: null });
    for (let i = 0; i < 48; i++) {
      await roomOrg.f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', 1024, $4, 'upload', 'ready', $5, $6)`,
        [randomUUID(), roomOrg.f.orgId, `r${i}.png`, `st/r${i}.png`, roomOrg.f.ids.owner, randomUUID()],
      );
    }
    const r49 = await runRoomOperation(
      { sql: roomOrg.f.sql, media: roomOrg.deps.media, staging: roomOrg.deps.staging },
      owner(roomOrg.f),
      'attachment.reserve',
      { organizationId: roomOrg.f.orgId, projectId: 'general', name: 'pending49.png', mime: 'image/png', size: logoBytes.byteLength },
    );
    expect(r49.result.ok).toBe(true);
    if (!r49.result.ok || !('stagingKey' in r49.result)) return;
    await roomOrg.deps.staging.putStaging(r49.result.stagingKey, logoBytes, 'image/png');
    const c49 = await runRoomOperation(
      { sql: roomOrg.f.sql, media: roomOrg.deps.media, staging: roomOrg.deps.staging },
      owner(roomOrg.f),
      'attachment.complete',
      { organizationId: roomOrg.f.orgId, projectId: 'general', stagingKey: r49.result.stagingKey, name: 'pending49.png', mime: 'image/png', size: logoBytes.byteLength },
    );
    expect(c49.result.ok).toBe(true);
    expect(await countOrganizationUploadedFiles(roomOrg.f.sql, roomOrg.f.orgId)).toBe(49);

    // 50th reserve works, 51st reserve without sending ANY message must be refused!
    const r50 = await runRoomOperation(
      { sql: roomOrg.f.sql, media: roomOrg.deps.media, staging: roomOrg.deps.staging },
      owner(roomOrg.f),
      'attachment.reserve',
      { organizationId: roomOrg.f.orgId, projectId: 'general', name: 'pending50.pdf', mime: 'application/pdf', size: 1024 },
    );
    expect(r50.result.ok).toBe(true);
    const r51 = await runRoomOperation(
      { sql: roomOrg.f.sql, media: roomOrg.deps.media, staging: roomOrg.deps.staging },
      owner(roomOrg.f),
      'attachment.reserve',
      { organizationId: roomOrg.f.orgId, projectId: 'general', name: 'pending51.pdf', mime: 'application/pdf', size: 1024 },
    );
    expect(r51.result).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });

    // Refusing a message send that carries more attachments than remaining file allowance (49 -> 59).
    if (!c49.result.ok || !('attachment' in c49.result)) return;
    const baseKey = c49.result.attachment.key;
    const tenAttachments = Array.from({ length: 10 }, (_, idx) => ({
      key: `${baseKey.slice(0, -4)}-${idx}.png`.replace(/-/g, '0').slice(0, baseKey.length),
      name: `att-${idx}.png`,
      size: 1024,
      width: 32,
      height: 32,
    }));
    // Use valid distinct 64-hex st/ keys matching attachment key schema
    const validTen = Array.from({ length: 10 }, (_, idx) => ({
      key: `st/${String(idx).padStart(64, 'a')}.png`,
      name: `att-${idx}.png`,
      size: 1024,
      width: 32,
      height: 32,
    }));
    void tenAttachments;
    const sendBlocked = await runRoomOperation(
      { sql: roomOrg.f.sql, media: roomOrg.deps.media, staging: roomOrg.deps.staging },
      owner(roomOrg.f),
      'message.send',
      {
        organizationId: roomOrg.f.orgId,
        projectId: 'general',
        requestId: randomUUID(),
        body: 'Too many files at once',
        attachments: validTen,
        mentions: [],
        mentionsTeam: false,
      },
    );
    expect(sendBlocked.result).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });
  });

  it('keeps HEAD behavior for existing/non-gated over-quota orgs on logo upload and room message.send (C1c #1)', async () => {
    const logoBytes = await pngBytes(32, 32);

    // 1a) Existing over-quota workspace (55+ GB used on 50 GB default) can still upload/replace its logo.
    const oldLogoOrg = await setupFixture({ capKrw: null, createdAt: '2026-11-23T23:59:59+09:00' });
    for (let i = 0; i < 28; i++) {
      await oldLogoOrg.f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', 2000000000, $4, 'upload', 'ready', $5, $6)`,
        [randomUUID(), oldLogoOrg.f.orgId, `big-${i}.png`, `st/big-${i}.png`, oldLogoOrg.f.ids.owner, randomUUID()],
      );
    }
    await reconcileOrganizationStorage(oldLogoOrg.f.sql, oldLogoOrg.f.orgId);
    const logoRes = await storeBrandOrganizationLogo(
      { sql: oldLogoOrg.f.sql, storage: oldLogoOrg.deps.staging },
      owner(oldLogoOrg.f),
      {
        organizationId: oldLogoOrg.f.orgId,
        requestId: randomUUID(),
        expectedRevision: 0,
        bytes: logoBytes,
        mime: 'image/png',
      },
    );
    expect(logoRes.ok).toBe(true);

    // 1b) Existing workspace at ~49.8 GB of 50 GB that sends 10 x 25 MB room attachments (total > 50 GB) succeeds as on HEAD.
    const oldRoomOrg = await setupFixture({ capKrw: null, createdAt: '2026-11-23T23:59:59+09:00' });
    for (let i = 0; i < 27; i++) {
      await oldRoomOrg.f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', 1980457142, $4, 'upload', 'ready', $5, $6)`,
        [randomUUID(), oldRoomOrg.f.orgId, `rm-${i}.png`, `st/rm-${i}.png`, oldRoomOrg.f.ids.owner, randomUUID()],
      );
    }
    await reconcileOrganizationStorage(oldRoomOrg.f.sql, oldRoomOrg.f.orgId);
    const ten25Mb = Array.from({ length: 10 }, (_, idx) => ({
      key: `st/${String(idx).padStart(64, 'b')}.png`,
      name: `att-${idx}.png`,
      size: 25 * 1024 * 1024,
      width: 32,
      height: 32,
    }));
    const oldSend = await runRoomOperation(
      { sql: oldRoomOrg.f.sql, media: oldRoomOrg.deps.media, staging: oldRoomOrg.deps.staging },
      owner(oldRoomOrg.f),
      'message.send',
      {
        organizationId: oldRoomOrg.f.orgId,
        projectId: 'general',
        requestId: randomUUID(),
        body: 'Existing org room send over 50GB',
        attachments: ten25Mb,
        mentions: [],
        mentionsTeam: false,
      },
    );
    expect(oldSend.result.ok).toBe(true);
  });

  it('never expires unsent room reservations after 30 minutes for gated orgs (C1c #2)', async () => {
    const { f, deps } = await setupFixture({ capKrw: null });
    for (let i = 0; i < 49; i++) {
      await f.sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
         values ($1, $2, 'image', $3, 'image/png', 1024, $4, 'upload', 'ready', $5, $6)`,
        [randomUUID(), f.orgId, `u-${i}.png`, `st/u-${i}.png`, f.ids.owner, randomUUID()],
      );
    }
    // 50th upload reserved in room, never sent in a message.
    const r50 = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'attachment.reserve',
      { organizationId: f.orgId, projectId: 'general', name: 'old-pending-50.pdf', mime: 'application/pdf', size: 1024 },
    );
    expect(r50.result.ok).toBe(true);

    // Backdate any timestamp/expiresAt in breakdown._pendingRoomUploads by 2 hours (> 30 min).
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const row = (await f.sql.query<{ breakdown: Record<string, unknown> }>('select breakdown from brand_storage_quotas where organization_id = $1', [f.orgId])).rows[0]!;
    const entries = (row.breakdown._pendingRoomUploads as Array<Record<string, unknown>>).map((e) => ({
      ...e,
      expiresAt: twoHoursAgo,
      reservedAt: twoHoursAgo,
    }));
    await f.sql.query('update brand_storage_quotas set breakdown = $2::jsonb where organization_id = $1', [
      f.orgId,
      JSON.stringify({ ...row.breakdown, _pendingRoomUploads: entries }),
    ]);

    // Still counts all 50 files hours later, so #51 must STILL be refused.
    expect(await countOrganizationUploadedFiles(f.sql, f.orgId)).toBe(50);
    const r51 = await runRoomOperation(
      { sql: f.sql, media: deps.media, staging: deps.staging },
      owner(f),
      'attachment.reserve',
      { organizationId: f.orgId, projectId: 'general', name: 'repeat-51.pdf', mime: 'application/pdf', size: 1024 },
    );
    expect(r51.result).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' });
  });
});
