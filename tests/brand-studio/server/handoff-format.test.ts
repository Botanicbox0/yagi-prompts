import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { handoffToCampaign, objectiveWithFormat } from '@/lib/brand-studio/handoff';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import type { StudioOutputView } from '@/lib/brand-studio/contracts';
import { ko } from '@/messages/ko';
import { en } from '@/messages/en';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** docs/BRAND-STUDIO-V2.md §10: a video sent to a campaign can carry "use this as the format". */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const owner = (locale: 'ko' | 'en' = 'ko') => viewerOf(f.ids.owner, locale);
async function result(input: Record<string, unknown>): Promise<StudioOutputView> {
  const created = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!created.ok) throw new Error(created.code);
  await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
  const poll = await pollStudioJobs(deps, owner(), f.orgId, [created.job.id]);
  if (!poll.ok || !poll.jobs[0]!.outputs[0]) throw new Error('no result');
  return poll.jobs[0]!.outputs[0]!;
}
const video = () => result({ kind: 'video', model: 'seedance-2.5', prompt: 'slow push in on the bottle', aspect: '9:16', seconds: 5, audio: 'native', resolution: '720p' });
const picture = () => result({ kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle', aspect: '1:1', resolution: '1K', count: 1 });
const objectiveOf = async (projectId: string) => (await f.sql.query<{ objective: string }>('select objective from brand_projects where id = $1', [projectId])).rows[0]!.objective;
const messages = async (projectId: string) =>
  (await f.sql.query<{ body: string; author_role: string }>('select body, author_role from brand_messages where project_id = $1 order by created_at', [projectId])).rows;

describe('handoff.campaign asFormat', () => {
  it('adds the format sentence to a new campaign goal, in the sender language', async () => {
    const clip = await video();
    const sent = await handoffToCampaign(deps, owner(), {
      organizationId: f.orgId, requestId: requestId(), outputId: clip.id, asFormat: true,
      newProject: { title: '파란 병 출시', objective: '새 병을 알린다' },
    });
    if (!sent.ok) throw new Error(sent.code);
    expect(await objectiveOf(sent.projectId)).toBe(`새 병을 알린다\n\n${ko.brandStudio.handoff.formatObjective}`);
    expect(await messages(sent.projectId)).toEqual([]);

    const english = await handoffToCampaign(deps, owner('en'), {
      organizationId: f.orgId, requestId: requestId(), outputId: clip.id, asFormat: true,
      newProject: { title: 'Blue bottle', objective: 'Launch it' },
    });
    if (!english.ok) throw new Error(english.code);
    expect(await objectiveOf(english.projectId)).toBe(`Launch it\n\n${en.brandStudio.handoff.formatObjective}`);
  });

  it('tells the studio on an existing campaign thread, once per handoff', async () => {
    const clip = await video();
    const input = { organizationId: f.orgId, requestId: requestId(), outputId: clip.id, projectId: f.projectId, asFormat: true };
    expect(await handoffToCampaign(deps, owner(), input)).toMatchObject({ ok: true, projectId: f.projectId });
    expect(await handoffToCampaign(deps, owner(), input)).toMatchObject({ ok: true, projectId: f.projectId });
    expect(await messages(f.projectId)).toEqual([{ body: ko.brandStudio.handoff.formatMessage, author_role: 'brand' }]);
  });

  it('keeps today\'s plain handoff for a picture, and for a video sent without the flag', async () => {
    const pic = await picture();
    const sentPic = await handoffToCampaign(deps, owner(), {
      organizationId: f.orgId, requestId: requestId(), outputId: pic.id, asFormat: true,
      newProject: { title: '파란 병 출시', objective: '새 병을 알린다' },
    });
    if (!sentPic.ok) throw new Error(sentPic.code);
    expect(await objectiveOf(sentPic.projectId)).toBe('새 병을 알린다');
    const clip = await video();
    expect(await handoffToCampaign(deps, owner(), { organizationId: f.orgId, requestId: requestId(), outputId: clip.id, projectId: f.projectId })).toMatchObject({ ok: true });
    expect(await handoffToCampaign(deps, owner(), { organizationId: f.orgId, requestId: requestId(), outputId: pic.id, projectId: f.projectId, asFormat: true })).toMatchObject({ ok: true });
    expect(await messages(f.projectId)).toEqual([]);
  });

  it('keeps a long goal within the campaign limit', () => {
    const sentence = ko.brandStudio.handoff.formatObjective;
    const long = objectiveWithFormat('가'.repeat(2000), sentence);
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long.endsWith(sentence)).toBe(true);
  });
});
