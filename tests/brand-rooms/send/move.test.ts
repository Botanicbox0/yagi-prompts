import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SendInboxPage, SendPosted, SendThreadPage } from '@/lib/brand-rooms/send-contracts';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { seedRun } from '../../brand-studio/server/revision-helpers';
import { as, closeWorld, imageResult, libraryPicture, ok, openSend, selfProject, sendWorld, type SendWorld } from './helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §4.3, §8.3 and the coordinator's decision 7: a file's threads follow the file. The spine's
 * one move operation (`project.move`, a single file or many, a run with its whole family: "the ones made together move
 * together") carries the roots about every moved file and their replies to the new project's members channel, or to
 * `members` for 미분류, in the move's own transaction; a refused move leaves the files and their threads where they were;
 * per-thread read marks and notices still find the thread afterwards.
 */
let w: SendWorld;
beforeEach(async () => {
  w = await sendWorld();
  openSend(w.f.orgId);
});
afterEach(async () => {
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const editor = () => as(w.f.ids.editor);
const output = (outputId: string) => ({ kind: 'output', outputId });
const send = (by: Viewer, file: Record<string, unknown>, body: string, mentions: string[] = []) => ok<SendPosted>(w, by, 'send.post', { requestId: randomUUID(), file, body, mentions });
const answer = (by: Viewer, rootId: string, body: string) => ok<SendPosted>(w, by, 'send.reply', { requestId: randomUUID(), rootId, body });
const move = (input: Record<string, unknown>) => runStudioOperation(w.deps, owner(), 'project.move', { organizationId: w.f.orgId, ...input });
async function where(...ids: string[]): Promise<Array<[string | null, string]>> {
  return (
    await w.f.sql.query<{ project_id: string | null; channel: string }>('select project_id::text as project_id, channel from brand_room_messages where id = any($1::uuid[]) order by created_at, id', [ids])
  ).rows.map((r) => [r.project_id, r.channel]);
}

describe('a thread follows its file', () => {
  it('one run: its roots and replies move to the new project, to 미분류 and back', async () => {
    const own = await selfProject(w);
    const run = await imageResult(w, w.f.projectId);
    const sent = await send(owner(), output(run.outputId), '@editor', [w.f.ids.editor]);
    const reply = await answer(editor(), sent.thread.rootId, 'On it');
    expect(await where(sent.message.id, reply.message.id)).toEqual([
      [w.f.projectId, `members:${w.f.projectId}`],
      [w.f.projectId, `members:${w.f.projectId}`],
    ]);
    expect((await move({ projectId: own, jobIds: [run.jobId] })).ok).toBe(true);
    expect(await where(sent.message.id, reply.message.id)).toEqual([
      [own, `members:${own}`],
      [own, `members:${own}`],
    ]);
    expect((await move({ projectId: null, jobIds: [run.jobId] })).ok).toBe(true);
    expect(await where(sent.message.id, reply.message.id)).toEqual([
      [null, 'members'],
      [null, 'members'],
    ]);
    expect((await move({ projectId: w.f.projectId, jobIds: [run.jobId] })).ok).toBe(true);
    expect(await where(sent.message.id, reply.message.id)).toEqual([
      [w.f.projectId, `members:${w.f.projectId}`],
      [w.f.projectId, `members:${w.f.projectId}`],
    ]);
    // A reply after the move lands in the new channel; the thread, its read mark and the inbox still find it.
    const later = await answer(owner(), sent.thread.rootId, 'Back here');
    expect(await where(later.message.id)).toEqual([[w.f.projectId, `members:${w.f.projectId}`]]);
    const page = await ok<SendThreadPage>(w, editor(), 'send.thread', { rootId: sent.thread.rootId });
    expect(page.replies.map((r) => r.body)).toEqual(['On it', 'Back here']);
    expect(page.thread.file.project).toEqual({ id: w.f.projectId, title: 'Spring launch', selectable: true });
    expect((await ok<SendInboxPage>(w, editor(), 'send.inbox', {})).threads.map((t) => [t.rootId, t.unread])).toEqual([[sent.thread.rootId, false]]);
  });

  it('a run’s whole family moves together, with every thread about any of its results; files not moved stay', async () => {
    const own = await selfProject(w);
    const first = await seedRun(w.deps, w.f.orgId, w.f.ids.owner, { kind: 'image' });
    const second = await seedRun(w.deps, w.f.orgId, w.f.ids.owner, { kind: 'image', parentOutputId: first.outputId });
    const third = await seedRun(w.deps, w.f.orgId, w.f.ids.owner, { kind: 'image', parentOutputId: second.outputId });
    const bystander = await imageResult(w);
    const asset = await libraryPicture(w);
    const lines: string[] = [];
    for (const outputId of [first.outputId, second.outputId, third.outputId]) lines.push((await send(owner(), output(outputId), 'Family')).message.id);
    const assetLine = (await send(owner(), { kind: 'asset', assetId: asset }, 'Library')).message.id;
    const stay = (await send(owner(), output(bystander.outputId), 'Stays')).message.id;
    const moved = await move({ projectId: own, jobIds: [second.jobId], assetIds: [asset] });
    expect(moved).toMatchObject({ ok: true, projectId: own });
    expect(await where(...lines, assetLine)).toEqual(Array.from({ length: 4 }, () => [own, `members:${own}`]));
    expect(await where(stay)).toEqual([[null, 'members']]);
  });

  it('a refused move leaves the files and their threads where they were; a preview moves nothing', async () => {
    const own = await selfProject(w);
    const run = await imageResult(w, w.f.projectId);
    const sent = await send(owner(), output(run.outputId), 'Here');
    // Another organization's run in the same call: the whole move is not_found.
    const other = randomUUID();
    await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', w.f.ids.owner, randomUUID()]);
    const theirs = await imageResult(w, null, other);
    expect(await move({ projectId: own, jobIds: [run.jobId, theirs.jobId] })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await move({ projectId: randomUUID(), jobIds: [run.jobId] })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await move({ projectId: own, jobIds: [run.jobId], preview: true })).toMatchObject({ ok: true });
    expect(await where(sent.message.id)).toEqual([[w.f.projectId, `members:${w.f.projectId}`]]);
    expect((await w.f.sql.query<{ brand_project_id: string }>('select brand_project_id::text from brand_studio_jobs where id = $1', [run.jobId])).rows[0]!.brand_project_id).toBe(w.f.projectId);
    // A viewer may not move (the spine's rule): nothing moves either.
    expect((await runStudioOperation(w.deps, as(w.f.ids.viewer), 'project.move', { organizationId: w.f.orgId, projectId: own, jobIds: [run.jobId] })).ok).toBe(false);
    expect(await where(sent.message.id)).toEqual([[w.f.projectId, `members:${w.f.projectId}`]]);
  });

  it('a failure while carrying the threads rolls the whole move back', async () => {
    const own = await selfProject(w);
    const run = await imageResult(w, w.f.projectId);
    const sent = await send(owner(), output(run.outputId), 'Here');
    // Make the thread update fail inside the move's transaction (a check that refuses the new channel).
    await w.f.sql.query(`alter table brand_room_messages add constraint test_no_move check (channel <> 'members:' || '${own}')`);
    await expect(move({ projectId: own, jobIds: [run.jobId] })).rejects.toThrow();
    expect(await where(sent.message.id)).toEqual([[w.f.projectId, `members:${w.f.projectId}`]]);
    expect((await w.f.sql.query<{ brand_project_id: string }>('select brand_project_id::text from brand_studio_jobs where id = $1', [run.jobId])).rows[0]!.brand_project_id).toBe(w.f.projectId);
  });

  it('threads move with their files whatever the switch says (a file never leaves its thread behind)', async () => {
    const own = await selfProject(w);
    const run = await imageResult(w, w.f.projectId);
    const sent = await send(owner(), output(run.outputId), 'Here');
    vi.stubEnv('BRAND_SEND', 'off');
    expect((await move({ projectId: own, jobIds: [run.jobId] })).ok).toBe(true);
    expect(await where(sent.message.id)).toEqual([[own, `members:${own}`]]);
  });
});
