import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { rewriteBlockedPrompt } from '@/lib/brand-studio/enhancer/blocked';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { laneClaim } from '@/lib/brand-studio/lane-api';
import { recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';
import { prepareJob, withSelectionLine } from '@/lib/brand-studio/prepare';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { compositeRegion, cropForEdit, describeSelection, planRegion, planRegionWindow, selectionLine } from '@/lib/brand-studio/region-edit';
import type { JobRow } from '@/lib/brand-studio/types';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { fakeIntel, requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * How long the text sent for one run may be (lib/brand-studio/prepare.ts): Seedance 2.5 takes up to 15,000
 * characters per clip (founder, 2026-11-25; lib/engines/prompt-limits.ts), so a compiled video prompt is no
 * longer cut at 8,000 and keeps its closing Audio and Exclusions blocks. Every other engine keeps the 8,000
 * it had: no provider limit for it is recorded there.
 */

/** The closing blocks of a compiled video prompt: what a cut in the middle loses first. */
const TAIL = '\nAudio: soft room tone, one glass clink at 3 s.\nExclusions: no on-screen text, no extra hands.';

/** A compiled prompt of exactly `n` characters, ending with its closing blocks. */
function compiled(n: number): string {
  let body = '';
  for (let shot = 1; body.length < n - TAIL.length; shot += 1) {
    body += `Shot ${shot}: slow push in on the glass bottle on wet stone, soft window light from the left.\n`;
  }
  const text = body.slice(0, n - TAIL.length) + TAIL;
  if (text.length !== n || text.trim() !== text) throw new Error('bad fixture');
  return text;
}

/** A prompt writer whose answer is `text`, as the director or the enhancer would hand it back. */
function writing(text: string, base = fakeIntel()) {
  return { ...base, enhancePrompt: async () => ({ prompt: text, notes: 'fake', source: 'model' as const }) };
}

const VIDEO = { kind: 'video', model: 'seedance-2.5', prompt: 'slow push in on the bottle', aspect: '9:16', seconds: 5, audio: 'native', resolution: '720p', enhance: true };
const IMAGE_MODELS = STUDIO_MODELS.filter((m) => m.medium === 'image');

let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

async function made(deps: ReturnType<typeof studioDeps>, input: Record<string, unknown>): Promise<JobRow> {
  const result = await createStudioJob(deps, viewerOf(f.ids.owner), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [result.job.id])).rows[0]!;
}

async function prepared(input: Record<string, unknown>, text: string) {
  const deps = studioDeps(f.sql, { intel: writing(text) as never });
  return prepareJob(deps, await made(deps, input));
}

describe('Seedance 2.5 video: up to 15,000 characters per clip', () => {
  it('keeps a 12,000-character compiled prompt whole, closing blocks included (it used to be cut at 8,000)', async () => {
    const text = compiled(12_000);
    const out = await prepared(VIDEO, text);
    expect(out.finalPrompt).toBe(text);
    expect(out.finalPrompt!.length).toBe(12_000);
    expect(out.finalPrompt!.endsWith(TAIL)).toBe(true);
  });

  it('keeps exactly 15,000 and cuts at 15,000 above it (no structural trimmer on this path: the last resort)', async () => {
    expect((await prepared(VIDEO, compiled(15_000))).finalPrompt).toBe(compiled(15_000));
    const over = compiled(16_000);
    const out = await prepared(VIDEO, over);
    expect(out.finalPrompt).toBe(over.slice(0, 15_000));
    expect(out.finalPrompt!.length).toBe(15_000);
  });

  it('a remix of a reference video keeps its 12,000 characters too', async () => {
    const text = compiled(12_000);
    const deps = studioDeps(f.sql, { intel: writing(text) as never });
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await made(deps, { kind: 'video_remix', model: 'seedance-2.5', prompt: '', change: '병을 파란 병으로', method: 'edit', keep: ['camera', 'timing'], aspect: '9:16', resolution: 'draft', audio: 'ambient', references: [{ assetId: film }] });
    expect((await prepareJob(deps, job)).finalPrompt).toBe(text);
  });

  // The function on its own: in a run the line is appended only to a partial edit, which runs on an image
  // model (8,000, below), never on Seedance. This pins that whatever limit is passed holds the line too.
  it('the selection line counts inside the limit: 12,000 + line kept whole, 16,000 + line is 15,000 in all', () => {
    const plan = planRegionWindow({ width: 640, height: 480 }, { x: 0.25, y: 0.25, w: 0.25, h: 0.25 });
    const line = selectionLine(describeSelection(plan));
    const twelve = compiled(12_000);
    expect(withSelectionLine(twelve, plan, 15_000)).toBe(`${twelve}\n${line}`);
    const sixteen = compiled(16_000);
    const cut = withSelectionLine(sixteen, plan, 15_000);
    expect(cut.length).toBe(15_000);
    expect(cut).toBe(`${sixteen.slice(0, 15_000 - line.length - 1)}\n${line}`);
    // At 8,000 the function answers exactly what origin/main answered.
    expect(withSelectionLine(twelve, plan, 8_000)).toBe(`${twelve.slice(0, 8_000 - line.length - 1)}\n${line}`);
  });
});

describe('every other engine: exactly as on origin/main', () => {
  it.each(IMAGE_MODELS.map((m) => [m.id, m] as const))('%s cuts a 12,000-character prompt at 8,000', async (_id, model) => {
    const text = compiled(12_000);
    const out = await prepared({ kind: 'image', model: model.id, prompt: 'a glass bottle on wet stone', aspect: '1:1', resolution: model.defaultResolution, count: 1, enhance: true }, text);
    expect(out.finalPrompt).toBe(text.slice(0, 8_000));
  });

  it('a partial edit (v2, selection line) still ends at 8,000 with the line', async () => {
    const intel = writing(compiled(12_000), { ...fakeIntel(), planRegion, planRegionWindow: (image, box) => planRegionWindow(image, box), cropForEdit, compositeRegion });
    const deps = { ...studioDeps(f.sql, { intel: intel as never }), env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_STUDIO_REGION_V2: 'on' }) };
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 640, height: 480 });
    const job = await made(deps, { kind: 'region_edit', model: 'nano-banana-pro', prompt: 'make it a gold star', enhance: true, source: { assetId: source }, box: { x: 0.25, y: 0.25, w: 0.25, h: 0.25 } });
    expect(job.model).toBe('seedream-5.5');
    const out = await prepareJob(deps, job);
    const line = selectionLine(describeSelection(out.work.region!.plan));
    expect(out.finalPrompt).toBe(`${compiled(12_000).slice(0, 8_000 - line.length - 1)}\n${line}`);
    expect(out.finalPrompt!.length).toBe(8_000);
  });
});

describe('prompts under 8,000: byte for byte, every engine', () => {
  it.each([...IMAGE_MODELS.map((m) => m.id), 'seedance-2.5'])('%s sends 7,999 and 8,000 characters untouched', async (id) => {
    const model = STUDIO_MODELS.find((m) => m.id === id)!;
    const input =
      model.medium === 'video'
        ? VIDEO
        : { kind: 'image', model: id, prompt: 'a glass bottle on wet stone', aspect: '1:1', resolution: model.defaultResolution, count: 1, enhance: true };
    for (const n of [7_999, 8_000]) {
      const text = compiled(n);
      expect((await prepared(input, text)).finalPrompt).toBe(text);
    }
  });
});

describe('the run around it is unchanged', () => {
  function capture(deps: ReturnType<typeof studioDeps>): StudioProviderRequest[] {
    const sent: StudioProviderRequest[] = [];
    const submit = deps.provider.submit.bind(deps.provider);
    deps.provider.submit = (request, options) => {
      sent.push(request);
      return submit(request, options);
    };
    return sent;
  }
  const row = async (id: string) =>
    (await f.sql.query<{ status: string; final_prompt: string; estimate_krw: number; usage_krw: number; claimed_at: unknown }>('select status, final_prompt, estimate_krw, usage_krw, claimed_at from brand_studio_jobs where id = $1', [id])).rows[0]!;

  it('a 12,000-character Seedance run is stored and sent whole, and costs, settles and counts exactly as a short one', async () => {
    const long = compiled(12_000);
    const longDeps = studioDeps(f.sql, { intel: writing(long) as never });
    const longSent = capture(longDeps);
    const longJob = await made(longDeps, VIDEO);
    await advanceStudioJobsWith(longDeps, { jobIds: [longJob.id] });

    const shortDeps = studioDeps(f.sql, { intel: writing('slow push in on the bottle, soft light') as never });
    const shortSent = capture(shortDeps);
    const shortJob = await made(shortDeps, VIDEO);
    await advanceStudioJobsWith(shortDeps, { jobIds: [shortJob.id] });

    const a = await row(longJob.id);
    const b = await row(shortJob.id);
    expect(a.final_prompt).toBe(long);
    expect(longSent).toHaveLength(1);
    expect(longSent[0]!.body.prompt).toBe(long);
    // Same request shape apart from the prompt text.
    expect({ ...longSent[0]!, body: { ...longSent[0]!.body, prompt: null } }).toEqual({ ...shortSent[0]!, body: { ...shortSent[0]!.body, prompt: null } });
    // Same state, same estimate, same settled usage, the allowance counts both.
    expect([a.status, b.status]).toEqual(['succeeded', 'succeeded']);
    expect(a.claimed_at).toBeNull();
    expect(Number(a.estimate_krw)).toBe(Number(b.estimate_krw));
    expect(Number(a.usage_krw)).toBe(Number(a.estimate_krw));
    expect(Number(b.usage_krw)).toBe(Number(b.estimate_krw));
    expect((await loadAllowance(f.sql, f.orgId, longDeps.env)).usedKrw).toBe(Number(a.usage_krw) + Number(b.usage_krw));
  });

  it('the account lane worker is handed the whole 12,000 characters', async () => {
    const long = compiled(12_000);
    const deps = studioDeps(f.sql, { intel: writing(long) as never });
    await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
    await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});
    const job = await made(deps, VIDEO);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await row(job.id)).status).toBe('queued');
    const claimed = await laneClaim(deps, { limit: 4 });
    if (!claimed.ok) throw new Error();
    expect(claimed.jobs.find((j) => j.jobId === job.id)).toMatchObject({ model: 'seedance-2.5', prompt: long });
  });

  it('a final made from a 12,000-character draft hands the account lane worker the whole draft text', async () => {
    const long = compiled(12_000);
    const deps = studioDeps(f.sql, { intel: writing(long) as never });
    const draftJob = await made(deps, { ...VIDEO, resolution: 'draft' });
    await advanceStudioJobsWith(deps, { jobIds: [draftJob.id] });
    expect((await row(draftJob.id)).final_prompt).toBe(long);
    const draftOutput = (await f.sql.query<{ id: string }>('select id from brand_studio_outputs where job_id = $1', [draftJob.id])).rows[0]!;
    await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
    await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});
    // A final sticks to its draft's lane: the draft lives on the API lane in this fixture, so move it.
    await f.sql.query("update brand_studio_jobs set lane = 'sunra_mcp' where id = $1", [draftJob.id]);
    const finalJob = await made(deps, { kind: 'video_final', draftOutputId: draftOutput.id });
    await advanceStudioJobsWith(deps, { jobIds: [finalJob.id] });
    const claimed = await laneClaim(deps, { limit: 4 });
    if (!claimed.ok) throw new Error();
    expect(claimed.jobs.find((j) => j.jobId === finalJob.id)).toMatchObject({ kind: 'video_final', prompt: long });
  });

  it('a blocked 12,000-character run is retried once with the whole text when the rewrite cannot shorten it', async () => {
    const long = compiled(12_000);
    const deps = studioDeps(f.sql, { intel: { ...writing(long), rewriteBlockedPrompt } as never });
    const sent: string[] = [];
    const tasks: string[] = [];
    const submit = deps.provider.submit.bind(deps.provider);
    const status = deps.provider.status.bind(deps.provider);
    deps.provider.submit = async (request, options) => {
      sent.push(String(request.body.prompt ?? ''));
      const answer = await submit(request, options);
      tasks.push(answer.taskId);
      return answer;
    };
    // The first task is stopped by the safety review; the retry finishes as the fake provider finishes it.
    deps.provider.status = async (taskId, ...rest) =>
      taskId === tasks[0] ? { state: 'failed', code: 'provider_rejected', detail: 'unsafe_content/moderation_blocked' } : status(taskId, ...rest);
    const job = await made(deps, { ...VIDEO, resolution: 'draft' });
    for (let i = 0; i < 8 && !['succeeded', 'failed'].includes((await row(job.id)).status); i += 1) {
      await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    }
    // No model key in tests: the rewriter answers "the same words", as it does when its answer is too long.
    expect(sent).toEqual([long, long]);
    const done = await row(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.final_prompt).toBe(long);
  });

  it('an image run with 12,000 characters still stores and sends 8,000', async () => {
    const long = compiled(12_000);
    const deps = studioDeps(f.sql, { intel: writing(long) as never });
    const sent = capture(deps);
    const job = await made(deps, { kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 1, enhance: true });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const done = await row(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.final_prompt).toBe(long.slice(0, 8_000));
    expect(sent[0]!.body.prompt).toBe(long.slice(0, 8_000));
    expect(Number(done.usage_krw)).toBe(Number(done.estimate_krw));
  });
});
