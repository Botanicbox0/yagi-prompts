import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioFixture, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §12, migration 0097: the columns a brand's project invitation adds to
 * `brand_invites`, and the checks that keep its scope (a viewer seat on one project; owner invitations
 * stay the team's; a target only with a project). The grants (0170) are pinned in
 * tests/brands/workspace-security.test.ts.
 */
let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const insert = (values: { role?: string; projectId?: string | null; studio?: boolean; targetKind?: string | null; targetId?: string | null; mailState?: string | null; acceptedEmail?: string | null }) =>
  f.sql.query(
    `insert into brand_invites (organization_id, project_id, email, role, issued_by_studio, token_hash, expires_at, created_by, request_id, target_kind, target_id, mail_state, accepted_email)
       values ($1, $2, 'a@partner.test', $3, $4, $5, now() + interval '7 days', $6, $7, $8, $9, $10, $11)`,
    [
      f.orgId,
      values.projectId === undefined ? f.projectId : values.projectId,
      values.role ?? 'viewer',
      values.studio ?? false,
      randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      f.ids.owner,
      randomUUID(),
      values.targetKind ?? null,
      values.targetId ?? null,
      values.mailState ?? null,
      values.acceptedEmail ?? null,
    ],
  );

describe('0097 brand_invites for room guests', () => {
  it('adds the columns, nullable, with the project-pending index', async () => {
    const columns = (
      await f.sql.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'brand_invites' and column_name in ('accepted_email','mail_state','mail_sent_at','target_kind','target_id') order by column_name`,
      )
    ).rows;
    expect(columns).toEqual([
      { column_name: 'accepted_email', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'mail_sent_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { column_name: 'mail_state', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'target_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'target_kind', data_type: 'text', is_nullable: 'YES' },
    ]);
    expect((await f.sql.query("select indexname from pg_indexes where tablename = 'brand_invites' and indexname = 'brand_invites_project_pending'")).rows).toHaveLength(1);
  });

  it('lets a brand issue a viewer invitation to a project, and nothing wider', async () => {
    await expect(insert({})).resolves.toBeTruthy();
    await expect(insert({ role: 'editor' })).rejects.toThrow(/brand_invites_scope_check/);
    await expect(insert({ role: 'owner', projectId: null })).rejects.toThrow(/brand_invites_scope_check/);
    await expect(insert({ role: 'owner', projectId: null, studio: true })).resolves.toBeTruthy();
    await expect(insert({ role: 'editor', projectId: null })).resolves.toBeTruthy();
  });

  it('keeps the target paired and on project invitations only, and the vocabularies closed', async () => {
    await expect(insert({ targetKind: 'review', targetId: randomUUID() })).resolves.toBeTruthy();
    await expect(insert({ targetKind: 'storyboard', targetId: randomUUID() })).resolves.toBeTruthy();
    await expect(insert({ targetKind: 'review' })).rejects.toThrow(/brand_invites_target_scope/);
    await expect(insert({ targetId: randomUUID() })).rejects.toThrow(/brand_invites_target_scope/);
    await expect(insert({ projectId: null, role: 'editor', targetKind: 'review', targetId: randomUUID() })).rejects.toThrow(/brand_invites_target_scope/);
    await expect(insert({ targetKind: 'message', targetId: randomUUID() })).rejects.toThrow(/check/);
    for (const state of ['sent', 'failed', 'skipped']) await expect(insert({ mailState: state })).resolves.toBeTruthy();
    await expect(insert({ mailState: 'queued' })).rejects.toThrow(/check/);
    await expect(insert({ acceptedEmail: 'Upper@Case.test' })).rejects.toThrow(/check/);
  });
});
