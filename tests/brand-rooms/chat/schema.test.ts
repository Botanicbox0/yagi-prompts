import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readMigration } from '@/lib/db/migrations';
import { expectReject } from '@/tests/helpers/pglite';
import { studioFixture, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §8 — the three conversation tables. The service checks every rule first; these
 * constraints are the floor under it: a reply never leaves its channel or organization, a project
 * channel is named by its project, an event line is the system's and points at something, a reaction
 * stays in its message's organization.
 */
let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
});

async function setup() {
  f = await studioFixture();
  const other = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', f.ids.owner, randomUUID()]);
  const insert = (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    return f!.sql.query<{ id: string }>(
      `insert into brand_room_messages (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      Object.values(fields),
    );
  };
  return { other, insert };
}

describe('brand room conversation schema (0082)', () => {
  it('names a project channel by its project and the general channel by nothing', async () => {
    const { insert } = await setup();
    const ok = await insert({ organization_id: f!.orgId, project_id: f!.projectId, channel: f!.projectId, author_id: f!.ids.owner, author_role: 'brand', body: 'hi' });
    expect(ok.rows[0]!.id).toMatch(/[0-9a-f-]{36}/);
    await insert({ organization_id: f!.orgId, channel: 'general', author_id: f!.ids.owner, author_role: 'brand', body: 'hello' });
    expect(await expectReject(() => insert({ organization_id: f!.orgId, project_id: f!.projectId, channel: 'general', author_role: 'brand', body: 'x' }))).toMatch(
      /brand_room_messages_channel/,
    );
    expect(await expectReject(() => insert({ organization_id: f!.orgId, channel: randomUUID(), author_role: 'brand', body: 'x' }))).toMatch(/brand_room_messages_channel/);
  });

  it('keeps a project channel inside its organization', async () => {
    const { other, insert } = await setup();
    expect(
      await expectReject(() => insert({ organization_id: other, project_id: f!.projectId, channel: f!.projectId, author_role: 'brand', body: 'x' })),
    ).toMatch(/brand_room_messages_project_fk|foreign key/);
  });

  it('keeps a reply in its parent channel and organization, the general channel included', async () => {
    const { other, insert } = await setup();
    const general = (await insert({ organization_id: f!.orgId, channel: 'general', author_role: 'brand', body: 'root' })).rows[0]!.id;
    const project = (await insert({ organization_id: f!.orgId, project_id: f!.projectId, channel: f!.projectId, author_role: 'brand', body: 'root' })).rows[0]!.id;
    await insert({ organization_id: f!.orgId, channel: 'general', parent_id: general, author_role: 'studio', body: 'reply' });
    expect(
      await expectReject(() => insert({ organization_id: f!.orgId, project_id: f!.projectId, channel: f!.projectId, parent_id: general, author_role: 'brand', body: 'x' })),
    ).toMatch(/brand_room_messages_parent_fk|foreign key/);
    expect(await expectReject(() => insert({ organization_id: f!.orgId, channel: 'general', parent_id: project, author_role: 'brand', body: 'x' }))).toMatch(
      /brand_room_messages_parent_fk|foreign key/,
    );
    expect(await expectReject(() => insert({ organization_id: other, channel: 'general', parent_id: general, author_role: 'brand', body: 'x' }))).toMatch(
      /brand_room_messages_parent_fk|foreign key/,
    );
  });

  it('refuses an empty text line, a system text line and an event that points at nothing', async () => {
    const { insert } = await setup();
    expect(await expectReject(() => insert({ organization_id: f!.orgId, channel: 'general', author_role: 'brand', body: '   ' }))).toMatch(/brand_room_messages_text/);
    expect(await expectReject(() => insert({ organization_id: f!.orgId, channel: 'general', author_role: 'system', body: 'x' }))).toMatch(/brand_room_messages_text/);
    expect(
      await expectReject(() => insert({ organization_id: f!.orgId, project_id: f!.projectId, channel: f!.projectId, author_role: 'system', kind: 'event', event: 'review_posted' })),
    ).toMatch(/brand_room_messages_event/);
    const ref = { kind: 'review', reviewId: randomUUID() };
    await insert({
      organization_id: f!.orgId,
      project_id: f!.projectId,
      channel: f!.projectId,
      author_role: 'system',
      kind: 'event',
      event: 'review_posted',
      ref: JSON.stringify(ref),
      ref_key: `review:${ref.reviewId}`,
    });
    expect(await expectReject(() => insert({ organization_id: f!.orgId, channel: 'general', author_role: 'brand', body: 'x', ref: JSON.stringify(ref), ref_key: `review:${ref.reviewId}` }))).toMatch(
      /brand_room_messages_ref_project/,
    );
    expect(
      await expectReject(() =>
        insert({ organization_id: f!.orgId, project_id: f!.projectId, channel: f!.projectId, author_role: 'brand', body: 'x', ref: JSON.stringify(ref), ref_key: 'review:nope' }),
      ),
    ).toMatch(/brand_room_messages_ref_key/);
  });

  it('allows one send per request id and author', async () => {
    const { insert } = await setup();
    const requestId = randomUUID();
    await insert({ organization_id: f!.orgId, channel: 'general', author_id: f!.ids.owner, author_role: 'brand', body: 'once', request_id: requestId });
    expect(
      await expectReject(() => insert({ organization_id: f!.orgId, channel: 'general', author_id: f!.ids.owner, author_role: 'brand', body: 'twice', request_id: requestId })),
    ).toMatch(/brand_room_messages_request_key|duplicate/);
  });

  it('keeps a reaction in its message organization and to the six names', async () => {
    const { other, insert } = await setup();
    const id = (await insert({ organization_id: f!.orgId, channel: 'general', author_role: 'brand', body: 'react to me' })).rows[0]!.id;
    await f!.sql.query("insert into brand_room_reactions (message_id, organization_id, user_id, emoji) values ($1, $2, $3, 'heart')", [id, f!.orgId, f!.ids.owner]);
    expect(
      await expectReject(() =>
        f!.sql.query("insert into brand_room_reactions (message_id, organization_id, user_id, emoji) values ($1, $2, $3, 'heart')", [id, other, f!.ids.editor]),
      ),
    ).toMatch(/brand_room_reactions_message_fk|foreign key/);
    expect(
      await expectReject(() =>
        f!.sql.query("insert into brand_room_reactions (message_id, organization_id, user_id, emoji) values ($1, $2, $3, 'fire')", [id, f!.orgId, f!.ids.editor]),
      ),
    ).toMatch(/brand_room_reactions_emoji/);
  });

  it('names a read mark by a channel only', async () => {
    await setup();
    await f!.sql.query("insert into brand_room_reads (organization_id, channel, user_id) values ($1, 'general', $2)", [f!.orgId, f!.ids.owner]);
    await f!.sql.query('insert into brand_room_reads (organization_id, channel, user_id) values ($1, $2, $3)', [f!.orgId, f!.projectId, f!.ids.owner]);
    expect(
      await expectReject(() => f!.sql.query("insert into brand_room_reads (organization_id, channel, user_id) values ($1, 'random', $2)", [f!.orgId, f!.ids.owner])),
    ).toMatch(/brand_room_reads_channel/);
  });

  it('closes all three tables to every browser key in the glue file', () => {
    const glue = readMigration('0156_glue_brand_room_messages.sql');
    for (const table of ['brand_room_messages', 'brand_room_reactions', 'brand_room_reads']) expect(glue).toContain(`'${table}'`);
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).not.toMatch(/create\s+policy/i);
  });
});
