import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import { studioSeat } from '@/lib/brand-studio/access';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { planSceneContinuation } from '@/lib/brand-studio/continuity/planner';
import type { StudioJobView, StudioShieldedPromptPreview } from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { dispatchMcpJsonRpc } from '@/lib/brand-studio/mcp/server';
import { promptPageCount } from '@/lib/brand-studio/prompt-shield/layout';
import { jobView } from '@/lib/brand-studio/repo';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { loadMusicJobs } from '@/lib/brand-studio/sound/load';
import type { JobRow } from '@/lib/brand-studio/types';
import { loadWorkflowsHubState, runWorkflowOperation } from '@/lib/brand-studio/workflows/service';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { NOTES_SENTINEL, SENT, SENTINEL, WORLD, seedWorld, worldRows } from './world';

/**
 * The video prompt shield open (BRAND_STUDIO_VIDEO_PROMPT_SHIELD=on for the organization): no answer carries a
 * VIDEO run's sent text, image and sound answers are untouched, and a designed sentence is reused by reference.
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' };
const NOW = new Date('2026-11-21T09:00:00.000Z');
const ORG = '00000000-0000-4000-8000-00000000a001';
const OTHER_ORG = '00000000-0000-4000-8000-00000000a002';
const DESIGNED = 'ENHANCED(seedance)';
const VIDEO_KINDS = new Set(['video', 'video_remix', 'video_final']);

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

const open = (orgs = ORG) => {
  vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'on');
  vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS', orgs);
};
const close = () => {
  vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'off');
};

beforeEach(async () => {
  resetSpineProbe();
  resetFreeIntelRateLimits();
  f = await studioFixture({ orgId: ORG });
  deps = studioDeps(f.sql, { env: studioEnv(ENV), now: () => NOW });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f.db.close();
});

const owner = (): Viewer => viewerOf(f.ids.owner);
const leaks = (answer: unknown): string[] => {
  const text = JSON.stringify(answer);
  return [SENTINEL, 'Quillwort', NOTES_SENTINEL, DESIGNED].filter((s) => text.includes(s));
};
const strip = (view: StudioJobView) => {
  const { finalPrompt: _f, sent: _s, architect: _a, ...rest } = view;
  return rest;
};
const videoRequest = (extra: Record<string, unknown> = {}) => ({
  kind: 'video', organizationId: ORG, requestId: requestId(), model: 'seedance-2.5', prompt: '같은 설정으로 다시', aspect: '9:16', resolution: '720p', seconds: 5, ...extra,
});
async function row(jobId: string): Promise<JobRow> {
  return (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [jobId])).rows[0]!;
}

describe('jobView', () => {
  const rows = () => worldRows(ORG, '00000000-0000-4000-8000-00000000b001');

  it('a video run carries no sent text, only sent/architect; every other field and kind is as closed', () => {
    const { jobs, outputs } = rows();
    const media = createMemoryMediaStore();
    close();
    const closed = new Map(jobs.map((j) => [j.id, jobView(j, outputs, media)]));
    open();
    for (const j of jobs) {
      const shut = closed.get(j.id)!;
      const view = jobView(j, outputs, media);
      if (!VIDEO_KINDS.has(j.kind)) {
        expect(JSON.stringify(view), j.kind).toBe(JSON.stringify(shut));
        continue;
      }
      expect(leaks(view), j.id).toEqual([]);
      expect(view.finalPrompt).toBeNull();
      expect(strip(view)).toEqual(strip(shut));
      expect(view.architect).toBe(shut.finalPrompt !== null);
      if (shut.finalPrompt === null) expect(view.sent).toBeNull();
      else expect(view.sent).toEqual({ shielded: true, pages: promptPageCount(shut.finalPrompt), version: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/) });
    }
    const byId = (id: string) => jobView(jobs.find((j) => j.id === id)!, outputs, media);
    expect(byId(WORLD.job.videoTyped)).toMatchObject({ sent: null, architect: false });
    expect(byId(WORLD.job.videoFinal)).toMatchObject({ sent: null, architect: false });
    expect(byId(WORLD.job.videoQueued)).toMatchObject({ sent: null, architect: false });
    expect(byId(WORLD.job.videoReviewed)).toMatchObject({ reviewed: true, architect: true });
    // The customer's own edits and answers stay: marks, the sheet, the question answered, the shot table.
    expect(byId(WORLD.job.videoRevision).revision?.marks?.[0]?.what).toBe('the brass bottle cap');
    expect(byId(WORLD.job.remixBlueprint).shots).toHaveLength(2);
  });

  it('the key order of a closed answer is kept; sent and architect come after reviewed', () => {
    const { jobs, outputs } = rows();
    open();
    const keys = Object.keys(jobView(jobs.find((j) => j.id === WORLD.job.videoReviewed)!, outputs, createMemoryMediaStore()));
    expect(keys.slice(5, 10)).toEqual(['finalPrompt', 'reviewed', 'sent', 'architect', 'expected']);
  });

  it('the version follows the stored text', () => {
    const { jobs, outputs } = rows();
    open();
    const media = createMemoryMediaStore();
    const designed = jobs.find((j) => j.id === WORLD.job.videoDesigned)!;
    const a = jobView(designed, outputs, media).sent!;
    const b = jobView({ ...designed, final_prompt: `${designed.final_prompt} More.` }, outputs, media).sent!;
    expect(jobView(designed, outputs, media).sent!.version).toBe(a.version);
    expect(b.version).not.toBe(a.version);
  });

  it('an organization not on the list gets the closed answer', () => {
    const { jobs, outputs } = rows();
    const media = createMemoryMediaStore();
    close();
    const shut = jobs.map((j) => JSON.stringify(jobView(j, outputs, media)));
    open(OTHER_ORG);
    expect(jobs.map((j) => JSON.stringify(jobView(j, outputs, media)))).toEqual(shut);
  });
});

describe('sentinel walk: no entry point that answers a run carries a video run sent text', () => {
  /** Every exported server entry point that returns job views (directly or after reading them), by name. */
  async function walk(): Promise<Record<string, unknown>> {
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', ORG);
    const { jobs, outputs } = await seedWorld(f.sql, ORG, f.ids.owner);
    const designed = jobs.find((j) => j.id === WORLD.job.videoDesigned)!;
    const mcpSeat = await studioSeat(f.sql, f.ids.owner, ORG, { requireSelfStudio: true });
    const mcp = async (name: string, args: Record<string, unknown>) =>
      dispatchMcpJsonRpc({ deps, seat: mcpSeat, viewer: owner() }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const answers: Record<string, unknown> = {};
    for (const role of ['owner', 'editor', 'viewer', 'guest'] as const) answers[`loadStudioState:${role}`] = await loadStudioState(deps, viewerOf(f.ids[role]), ORG);
    answers['loadStudioState:unfiled'] = await loadStudioState(deps, owner(), ORG, { scope: { kind: 'unfiled' } });
    answers.pollStudioJobs = await pollStudioJobs(deps, owner(), ORG, Object.values(WORLD.job));
    answers['job.create:replay'] = await runStudioOperation(deps, owner(), 'job.create', {
      kind: 'video', organizationId: ORG, requestId: designed.request_id, model: 'seedance-2.5', prompt: designed.prompt, aspect: '9:16', resolution: '480p', seconds: 5,
    });
    answers['job.create:reviewedFrom'] = await runStudioOperation(deps, owner(), 'job.create', videoRequest({ reviewedFrom: { jobId: WORLD.job.videoReviewed } }));
    answers['project.files:unfiled'] = await runStudioOperation(deps, owner(), 'project.files', { organizationId: ORG, scope: { kind: 'unfiled' } });
    answers['project.overview'] = await runStudioOperation(deps, owner(), 'project.overview', { organizationId: ORG });
    answers['prompt.enhance:video'] = await runStudioOperation(deps, owner(), 'prompt.enhance', {
      kind: 'video', organizationId: ORG, model: 'seedance-2.5', prompt: '병이 천천히 돈다', aspect: '9:16', resolution: '720p', seconds: 5,
    });
    answers['prompt.enhance:remix'] = await runStudioOperation(deps, owner(), 'prompt.enhance', {
      kind: 'video_remix', organizationId: ORG, model: 'seedance-2.5', prompt: '색만 파랗게', aspect: '9:16', resolution: '720p', method: 'reference',
      references: [{ assetId: WORLD.videoAsset }],
    });
    // The reference video's file is in storage, so its blueprint step can be read (a blueprint that cannot be read is not made).
    const film = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [WORLD.videoAsset])).rows[0]!;
    deps.media.objects.set(film.storage_key, { bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), mime: 'video/mp4' });
    answers['workflows:run'] = await runWorkflowOperation(deps, viewerOf(f.ids.owner, 'ko'), 'run', {
      organizationId: ORG, requestId: 'req_walk_workflow_run', workflowId: 'reference-video-ad-pack',
      inputs: { video1Ref: { assetId: WORLD.videoAsset }, image1Ref: { assetId: WORLD.imageAsset }, subject: '글로우 세럼', prompt: '유리 보틀 반사광', packs: ['cut_hook'] },
    });
    answers['workflows:hub'] = await loadWorkflowsHubState(deps, owner(), ORG);
    answers['mcp:twings_list_assets'] = await mcp('twings_list_assets', {});
    answers.loadMusicJobs = await loadMusicJobs(f.sql, deps.media, ORG);
    answers['continuity.plan'] = await planSceneContinuation(deps, { organizationId: ORG, locale: 'ko', clipLabel: '', outputId: outputs.find((o) => o.job_id === designed.id)!.id, clipDurationSec: 5, sequenceDurationSec: 0, targetNextSeconds: 6 });
    return answers;
  }

  it('open: none of them carries the sentinel, the writer notes or a designed sentence', async () => {
    open();
    const answers = await walk();
    for (const [name, answer] of Object.entries(answers)) {
      expect((answer as { ok?: boolean }).ok, name).not.toBe(false);
      expect(leaks(answer), name).toEqual([]);
    }
    // The walk really reached video runs with sent text: the views say so without it.
    const state = answers['loadStudioState:owner'] as { jobs: StudioJobView[] };
    expect(state.jobs.filter((j) => j.sent).length).toBeGreaterThanOrEqual(6);
    const run = answers['workflows:run'] as { jobs: StudioJobView[] };
    expect(run.jobs[0]!.kind).toBe('video_remix');
    expect(run.jobs[0]!.architect).toBe(true);
    expect((await row(run.jobs[0]!.id)).final_prompt).toContain(DESIGNED);
  });

  it('closed: the same walk shows the sent text as before (the test can see a leak), but never the writer notes', async () => {
    close();
    const answers = await walk();
    const all = JSON.stringify(answers);
    expect(all).toContain(SENTINEL);
    expect(all).toContain(DESIGNED);
    expect(all).not.toContain(NOTES_SENTINEL);
  });
});

describe('continuity.plan fallback', () => {
  const longestShared = (a: string, b: string): number => {
    let best = 0;
    const prev = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i += 1) {
      let diag = 0;
      for (let j = 1; j <= b.length; j += 1) {
        const keep = prev[j]!;
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j]! > best) best = prev[j]!;
        diag = keep;
      }
    }
    return best;
  };

  it('closed, it repeats the compiled prompt; open, nothing of it beyond the typed words', async () => {
    const { outputs } = await seedWorld(f.sql, ORG, f.ids.owner);
    const outputId = outputs.find((o) => o.job_id === WORLD.job.videoDesigned)!.id;
    const input = { organizationId: ORG, locale: 'en' as const, clipLabel: '', outputId, clipDurationSec: 5, sequenceDurationSec: 0, targetNextSeconds: 6 };
    const closedPlan = await planSceneContinuation(deps, input, { env: {} });
    const echoed = longestShared(SENT.videoDesigned, closedPlan.recommendedPrompt);
    // Measured for the report: the closed fallback repeats this many characters of the compiled prompt verbatim.
    console.log(`[prompt-shield continuity] closed fallback echoes ${echoed} characters of the sent prompt`);
    expect(echoed).toBeGreaterThan(60);
    const openPlan = await planSceneContinuation(deps, input, { env: { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on' } });
    expect(JSON.stringify(openPlan)).not.toContain('Quillwort');
    expect(longestShared(SENT.videoDesigned, openPlan.recommendedPrompt)).toBeLessThan(20);
  });
});

describe('job.create reuse without the text', () => {
  beforeEach(async () => {
    await seedWorld(f.sql, ORG, f.ids.owner);
  });

  it('reviewedFrom sends the stored sentence exactly as reviewedPrompt would, at the same price', async () => {
    open();
    const made = await runStudioOperation(deps, owner(), 'job.create', videoRequest({ reviewedFrom: { jobId: WORLD.job.videoReviewed } }));
    expect(made.ok).toBe(true);
    const job = (made as { job: StudioJobView }).job;
    expect(leaks(made)).toEqual([]);
    const stored = await row(job.id);
    expect(stored.params.reviewedPrompt).toBe(SENT.videoReviewed);
    expect(stored.enhance).toBe(false);
    // The re-run sends `enhance: true` with the name (a fallback for a closed server); the sentence still goes as read.
    const named = await runStudioOperation(deps, owner(), 'job.create', videoRequest({ enhance: true, reviewedFrom: { jobId: WORLD.job.videoReviewed } }));
    expect((await row((named as { job: StudioJobView }).job.id)).enhance).toBe(false);
    const literal = await runStudioOperation(deps, owner(), 'job.create', videoRequest({ reviewedPrompt: SENT.videoReviewed }));
    expect(literal.ok).toBe(true);
    const twin = await row((literal as { job: StudioJobView }).job.id);
    expect({ ...stored.params, locale: 'x' }).toEqual({ ...twin.params, locale: 'x' });
    expect([stored.enhance, stored.estimate_krw, stored.model]).toEqual([twin.enhance, twin.estimate_krw, twin.model]);
    // A designed run that was not read first can be reused the same way.
    const fromDesigned = await runStudioOperation(deps, owner(), 'job.create', videoRequest({ reviewedFrom: { jobId: WORLD.job.videoDesigned } }));
    expect((await row((fromDesigned as { job: StudioJobView }).job.id)).params.reviewedPrompt).toBe(SENT.videoDesigned);
  });

  it('refusals: nothing designed, a preset or image run, another organization, both at once, a viewer', async () => {
    open();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [OTHER_ORG, 'Other brand', f.ids.owner, randomUUID()]);
    const foreign = randomUUID();
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, model, prompt, final_prompt, enhance, params, finished_at)
        values ($1, $2, $3, 'req_foreign_job_0001', 'video', 'succeeded', 'seedance-2.5', 'x', $4, true, $5::jsonb, now())`,
      [foreign, OTHER_ORG, f.ids.owner, SENT.videoDesigned, JSON.stringify({ aspect: '9:16', resolution: '720p', seconds: 5, audio: 'native', count: 1, locale: 'ko' })],
    );
    const code = async (extra: Record<string, unknown>, viewer = owner()) => {
      const r = await runStudioOperation(deps, viewer, 'job.create', videoRequest(extra));
      return r.ok ? 'ok' : (r as { code: string }).code;
    };
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoTyped } })).toBe('invalid');
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoFinal } })).toBe('invalid');
    expect(await code({ reviewedFrom: { jobId: WORLD.job.preset } })).toBe('invalid');
    expect(await code({ reviewedFrom: { jobId: WORLD.job.image } })).toBe('invalid');
    expect(await code({ reviewedFrom: { jobId: foreign } })).toBe('not_found');
    expect(await code({ reviewedFrom: { jobId: randomUUID() } })).toBe('not_found');
    expect(await code({ reviewedFrom: { jobId: 'not-a-uuid' } })).toBe('invalid');
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoReviewed }, reviewedPrompt: 'mine' })).toBe('invalid');
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoReviewed }, reviewedToken: 'x'.repeat(60) })).toBe('invalid');
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoReviewed } }, viewerOf(f.ids.viewer))).toBe('forbidden');
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoReviewed } }, viewerOf(f.ids.guest))).toBe('forbidden');
    // A bad request from someone with no seat is refused for the seat, as with the shield closed: nothing about the switch.
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoReviewed }, reviewedPrompt: 'mine' }, viewerOf(f.ids.outsider))).toBe('not_found');
    expect(await code({ reviewedToken: 42 }, viewerOf(f.ids.outsider))).toBe('not_found');
    // A removed run is gone for reuse too.
    await f.sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [WORLD.job.videoBlockRetry]);
    expect(await code({ reviewedFrom: { jobId: WORLD.job.videoBlockRetry } })).toBe('not_found');
    // A literal reviewed sentence is still taken while the shield is open.
    expect(await code({ reviewedPrompt: 'My own reviewed words for the clip.' })).toBe('ok');
  });

  it('closed, reviewedFrom and reviewedToken are dropped unread, as before', async () => {
    close();
    const made = await runStudioOperation(deps, owner(), 'job.create', videoRequest({ reviewedFrom: { jobId: WORLD.job.videoReviewed }, reviewedToken: 'anything' }));
    expect(made.ok).toBe(true);
    const stored = await row((made as { job: StudioJobView }).job.id);
    expect(stored.params.reviewedPrompt).toBeUndefined();
    expect(stored.enhance).toBe(true);
  });

  it('an image run is unchanged with the shield open: the keys are not read', async () => {
    open();
    const made = await runStudioOperation(deps, owner(), 'job.create', {
      kind: 'image', organizationId: ORG, requestId: requestId(), model: 'seedream-5.5', prompt: '병', aspect: '1:1', resolution: '2K',
      reviewedFrom: { jobId: 'not-a-uuid' }, reviewedToken: 1,
    });
    expect(made.ok).toBe(true);
    expect((made as { job: StudioJobView }).job).not.toHaveProperty('sent');
  });
});

describe('prompt.enhance and reviewedToken', () => {
  const enhanceVideo = (viewer = owner()) =>
    runStudioOperation(deps, viewer, 'prompt.enhance', { kind: 'video', organizationId: ORG, model: 'seedance-2.5', prompt: '병이 천천히 돈다', aspect: '9:16', resolution: '720p', seconds: 5 });

  it('a video model answers a token and pages, never the sentence or the notes; an image model is unchanged', async () => {
    open();
    const video = await enhanceVideo();
    expect(Object.keys(video).sort()).toEqual(['ok', 'pages', 'shielded', 'source', 'token']);
    expect(video).toMatchObject({ ok: true, source: 'model', shielded: true, pages: 1 });
    expect(leaks(video)).toEqual([]);
    const image = await runStudioOperation(deps, owner(), 'prompt.enhance', { kind: 'image', organizationId: ORG, model: 'seedream-5.5', prompt: '흰 배경의 코발트 병', aspect: '1:1', resolution: '2K' });
    expect(image).toEqual({ ok: true, prompt: 'ENHANCED(seedream): 흰 배경의 코발트 병', notes: 'fake', source: 'model' });
  });

  it('the token makes the run with the designed sentence; another member, a tampered or a foreign token is refused alike', async () => {
    open();
    const token = ((await enhanceVideo()) as StudioShieldedPromptPreview).token;
    const made = await runStudioOperation(deps, owner(), 'job.create', videoRequest({ prompt: '병이 천천히 돈다', reviewedToken: token }));
    expect(made.ok).toBe(true);
    expect(leaks(made)).toEqual([]);
    const stored = await row((made as { job: StudioJobView }).job.id);
    expect(stored.params.reviewedPrompt).toBe('ENHANCED(seedance): 병이 천천히 돈다');
    expect(stored.enhance).toBe(false);
    const code = async (extra: Record<string, unknown>, viewer = owner()) => {
      const r = await runStudioOperation(deps, viewer, 'job.create', videoRequest(extra));
      return r.ok ? 'ok' : (r as { code: string }).code;
    };
    const raw = Buffer.from(token, 'base64url');
    raw[raw.length >> 1] = raw[raw.length >> 1]! ^ 0x01;
    expect(await code({ reviewedToken: raw.toString('base64url') })).toBe('conflict');
    expect(await code({ reviewedToken: token }, viewerOf(f.ids.editor))).toBe('conflict');
    expect(await code({ reviewedToken: 'A'.repeat(200_000) })).toBe('conflict');
    expect(await code({ reviewedToken: 42 })).toBe('conflict');
    expect(await code({ reviewedToken: token, reviewedPrompt: 'mine' })).toBe('invalid');
  });

  it('a token made for one organization does not open in another', async () => {
    open('all');
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [OTHER_ORG, 'Other brand', f.ids.owner, randomUUID()]);
    await f.sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [OTHER_ORG, f.ids.owner, 'owner']);
    await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, $2)', [OTHER_ORG, 1_000_000]);
    const token = ((await enhanceVideo()) as StudioShieldedPromptPreview).token;
    const other = await runStudioOperation(deps, owner(), 'job.create', { ...videoRequest({ reviewedToken: token }), organizationId: OTHER_ORG });
    expect(other).toEqual({ ok: false, code: 'conflict' });
  });
});
