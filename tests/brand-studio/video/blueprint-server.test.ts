import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { analyzeStudioFilm, createStudioJob, previewStudioPrompt } from '@/lib/brand-studio/jobs';
import { laneClaim } from '@/lib/brand-studio/lane-api';
import { recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import { estimateVideoUsd, studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import { prepareJob } from '@/lib/brand-studio/prepare';
import { buildStudioRequest, StudioRequestError } from '@/lib/brand-studio/provider/requests';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { remakeSeconds } from '@/lib/brand-studio/reference-video';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import type { EnhanceInput, JobRow } from '@/lib/brand-studio/types';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { remixRunUsd, usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import { requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * docs/BRAND-STUDIO-V3.md §6 — the `blueprint` remix on the server: it is priced as the text/image run it
 * is (no reference-video input), the video is read (at blueprint depth) but never reaches the provider,
 * the prompt writer gets the customer's shot table and no video reference, and the job reads back as
 * `blueprint` with its table so the panel can be set up again.
 */
const model = studioModel('seedance-2.5') as StudioVideoModel;
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let sent: StudioProviderRequest[];
let enhanced: EnhanceInput[];
let readDepths: Array<string | undefined>;

beforeEach(async () => {
  f = await studioFixture({ capKrw: 5_000_000 });
  deps = studioDeps(f.sql);
  sent = [];
  enhanced = [];
  readDepths = [];
  const submit = deps.provider.submit.bind(deps.provider);
  deps.provider.submit = (request, options) => {
    sent.push(request);
    return submit(request, options);
  };
  const enhance = deps.intel.enhancePrompt.bind(deps.intel);
  deps.intel.enhancePrompt = (input, intelDeps) => {
    enhanced.push(input);
    return enhance(input, intelDeps);
  };
  const read = deps.intel.readFilm.bind(deps.intel);
  deps.intel.readFilm = (input, intelDeps) => {
    readDepths.push(input.depth);
    return read(input, intelDeps);
  };
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const SHOTS = [
  { start: 0, end: 2.5, framing: 'close-up', camera: 'slow push in', action: 'a hand lifts the bottle', transition: 'hard cut' },
  { start: 2.5, end: 6, framing: 'wide', camera: 'locked-off', action: 'she turns away' },
];

async function create(input: Record<string, unknown>): Promise<StudioJobView> {
  const result = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.job;
}
const remix = (film: string, extra: Record<string, unknown> = {}) => ({
  kind: 'video_remix',
  model: 'seedance-2.5',
  prompt: '',
  change: '제품: 우리 병',
  method: 'blueprint',
  keep: ['camera', 'timing', 'composition', 'motion', 'look'],
  aspect: '9:16',
  resolution: 'draft',
  audio: 'native',
  references: [{ assetId: film }],
  ...extra,
});
async function videoAsset(seconds: number, width: number, height: number): Promise<string> {
  const { key } = await deps.media.put(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), 'video/mp4');
  return (
    await f.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, duration_ms, storage_key, source, status, created_by)
        values ($1, 'video', 'clip', 'video/mp4', 8, $2, $3, $4, $5, 'upload', 'ready', $6) returning id`,
      [f.orgId, width, height, seconds * 1000, key, f.ids.owner],
    )
  ).rows[0]!.id;
}

describe('planning a blueprint', () => {
  it('bills no reference-video input: the same as a plain video run, less than following the clip', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(remix(film));
    const seconds = remakeSeconds(model, 6);
    expect(job).toMatchObject({ kind: 'video_remix', method: 'blueprint', seconds, resolution: 'draft' });
    expect(job.estimateKrw).toBe(usageKrw(videoRunUsd({ resolution: 'draft', seconds }), 'video'));
    const follow = usageKrw(remixRunUsd({ model, resolution: 'draft', method: 'reference', seconds, referenceSeconds: 6 }).usd, 'video');
    expect(job.estimateKrw).toBeLessThan(follow);
    // The dock's arithmetic gives the same number for a blueprint.
    expect(usageKrw(remixRunUsd({ model, resolution: 'draft', method: 'blueprint', seconds, referenceSeconds: 6 }).usd, 'video')).toBe(job.estimateKrw);
    const row = (await f.sql.query<{ params: Record<string, unknown>; enhance: boolean }>('select params, enhance from brand_studio_jobs where id = $1', [job.id])).rows[0]!;
    expect(row.params).not.toHaveProperty('referenceVideoSeconds');
    expect(row.enhance).toBe(true);
  });

  it('keeps the customer table (cleaned) and reads it back for "use these settings again"', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(remix(film, { seconds: 8, shots: [{ ...SHOTS[1]!, end: 99 }, { ...SHOTS[0]!, framing: '  close-up  ' }] }));
    expect(job.seconds).toBe(8);
    expect(job.shots).toEqual([
      { start: 0, end: 2.5, framing: 'close-up', camera: 'slow push in', action: 'a hand lifts the bottle', transition: 'hard cut' },
      { start: 2.5, end: 6, framing: 'wide', camera: 'locked-off', action: 'she turns away' },
    ]);
    const polled = await pollStudioJobs(deps, owner(), f.orgId, [job.id]);
    expect(polled.ok && polled.jobs[0]).toMatchObject({ method: 'blueprint', shots: job.shots });
  });

  it('takes a clip too small or >30s to attach via blueprint, refuses >600s, and still refuses a small clip for the other ways', async () => {
    const tiny = await videoAsset(6, 200, 300);
    expect((await create(remix(tiny))).method).toBe('blueprint');
    expect(await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...remix(tiny, { method: 'reference' }) })).toEqual({ ok: false, code: 'invalid' });
    const over30 = await videoAsset(model.referenceVideoSeconds.max + 5, 720, 1280);
    expect((await create(remix(over30))).method).toBe('blueprint');
    const over600 = await videoAsset(605, 720, 1280);
    expect(await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...remix(over600) })).toEqual({ ok: false, code: 'invalid' });
  });

  it('refuses a shape the model cannot make, and an oversized table at the contract', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    expect(await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...remix(film, { aspect: '2:3' }) })).toEqual({ ok: false, code: 'invalid' });
    const many = Array.from({ length: 41 }, (_, i) => ({ start: i * 0.1, end: i * 0.1 + 0.1, framing: '', camera: '', action: '' }));
    expect(await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...remix(film, { shots: many }) })).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('running a blueprint', () => {
  it('reads the clip at blueprint depth, never sends it, and gives the prompt writer the table without a video', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(remix(film, { shots: SHOTS }));
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    const polled = await pollStudioJobs(deps, owner(), f.orgId, [job.id]);
    expect(polled.ok && polled.jobs[0]!.status).toBe('succeeded');
    expect(readDepths).toEqual(['blueprint']);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe('bytedance/seedance-2.5/text-to-video');
    expect(sent[0]!.body).not.toHaveProperty('reference_videos');
    expect(sent[0]!.body).toMatchObject({ ratio: '9:16', duration: 6, draft: true, resolution: '480p' });
    expect(JSON.stringify(sent[0]!.body)).not.toContain('.mp4');
    const input = enhanced[0]!;
    expect(input.video).toMatchObject({ method: 'blueprint', seconds: 6 });
    expect(input.references.some((r) => r.kind === 'video')).toBe(false);
    expect(input.video?.sheet?.shots).toEqual(SHOTS);
    const work = (await f.sql.query<{ work: { inputs: Array<{ kind: string }> } }>('select work from brand_studio_jobs where id = $1', [job.id])).rows[0]!.work;
    expect(work.inputs).toEqual([]);
  });

  it('sends reference pictures (and only them) to the reference endpoint', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const bottle = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'product' });
    const job = await create(remix(film, { references: [{ assetId: film }, { assetId: bottle, role: 'product' }], change: '제품: 이미지 1' }));
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(sent[0]!.endpoint).toBe('bytedance/seedance-2.5/reference-to-video');
    expect(sent[0]!.body).not.toHaveProperty('reference_videos');
    expect((sent[0]!.body.reference_images as string[])).toHaveLength(1);
    expect(enhanced[0]!.references.map((r) => r.kind)).toEqual(['image']);
  });

  it('finishes a blueprint draft at 1080p with no reference-video part either', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const draft = await create(remix(film));
    await advanceStudioJobsWith(deps, { jobIds: [draft.id] });
    const done = await pollStudioJobs(deps, owner(), f.orgId, [draft.id]);
    const outputId = done.ok ? done.jobs[0]!.outputs[0]!.id : '';
    const final = await create({ kind: 'video_final', draftOutputId: outputId });
    expect(final.estimateKrw).toBe(usageKrw(estimateVideoUsd({ resolution: '1080p', seconds: 6, referenceVideoSeconds: 0 }), 'video'));
  });

  it('is refused by the request builder if a video ever reached its inputs', () => {
    expect(() =>
      buildStudioRequest({
        kind: 'video_remix',
        model: 'seedance-2.5',
        prompt: 'x',
        params: { aspect: '9:16', resolution: 'draft', seconds: 6, audio: 'native', count: 1, locale: 'ko', method: 'blueprint' },
        images: [],
        videos: [{ url: 'https://media.example/clip.mp4' }],
      }),
    ).toThrow(StudioRequestError);
  });
});

/**
 * A blueprint is made from its reading alone (the video never reaches the provider). When the reading fails
 * and nothing else gives the direction (no table of the customer's, no earlier prompt to remake), the run is
 * not made and settles at nothing, like every other failed run.
 */
describe('a blueprint whose reference cannot be read', () => {
  const view = async (id: string): Promise<StudioJobView> => {
    const poll = await pollStudioJobs(deps, owner(), f.orgId, [id]);
    if (!poll.ok) throw new Error(poll.code);
    return poll.jobs[0]!;
  };
  const used = async () => (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;
  const unreadable = (reader: () => Promise<null>) => {
    deps.intel.readFilm = async (input) => {
      readDepths.push(input.depth);
      return reader();
    };
  };
  const jobRow = async (id: string) =>
    (
      await f.sql.query<{ status: string; error_code: string | null; error_detail: string | null; usage_krw: number | null; finished_at: unknown; lane: string | null }>(
        'select status, error_code, error_detail, usage_krw, finished_at, lane from brand_studio_jobs where id = $1',
        [id],
      )
    ).rows[0]!;

  it.each([
    ['the reader gives nothing back', async () => null],
    ['the reader throws', async (): Promise<null> => { throw new Error('reader timed out'); }],
  ])('%s and no table was sent: fails before the prompt writer and the provider, and costs nothing', async (_, reader) => {
    unreadable(reader);
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(remix(film));
    expect(job.estimateKrw).toBeGreaterThan(0);
    // Reserved while it is open.
    expect(await used()).toBe(job.estimateKrw);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await view(job.id)).toMatchObject({ status: 'failed', errorCode: 'reference_unreadable', outputs: [], estimateKrw: 0 });
    expect(readDepths).toEqual(['blueprint']);
    expect(enhanced).toEqual([]);
    expect(sent).toEqual([]);
    // Stored as a plain failure (the column's codes are fixed, migration 0076): the view names the reason.
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'failed', error_code: 'failed', usage_krw: 0 });
    expect(row.finished_at).not.toBeNull();
    expect(row.error_detail).toContain('could not be read');
    expect((await f.sql.query('select status from brand_studio_outputs where job_id = $1', [job.id])).rows).toEqual([{ status: 'failed' }]);
    // The reservation is released.
    expect(await used()).toBe(0);
  });

  it("with the customer's own table it still runs: the table is the direction, settled at its quote", async () => {
    unreadable(async () => null);
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(remix(film, { shots: SHOTS }));
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await view(job.id)).toMatchObject({ status: 'succeeded', errorCode: null });
    expect(readDepths).toEqual(['blueprint']);
    expect(sent).toHaveLength(1);
    expect(enhanced[0]!.video?.sheet).toMatchObject({ shots: SHOTS, summary: '' });
    expect((await jobRow(job.id)).usage_krw).toBe(job.estimateKrw);
    expect(await used()).toBe(job.estimateKrw);
  });

  it('judges each clip of a plan on its own: a failed reading is not kept, so every clip tries again', async () => {
    unreadable(async () => null);
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const a = await create(remix(film));
    const b = await create(remix(film));
    await advanceStudioJobsWith(deps, { jobIds: [a.id] });
    await advanceStudioJobsWith(deps, { jobIds: [b.id] });
    for (const id of [a.id, b.id]) expect(await view(id)).toMatchObject({ status: 'failed', errorCode: 'reference_unreadable', estimateKrw: 0 });
    expect(readDepths).toEqual(['blueprint', 'blueprint']);
    expect(sent).toEqual([]);
    expect(await used()).toBe(0);
  });

  it('a clip whose reading comes back runs and keeps it for the next; only the clip without one fails', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const read = deps.intel.readFilm;
    let calls = 0;
    deps.intel.readFilm = async (input, intelDeps) => {
      calls += 1;
      if (calls > 1) return read(input, intelDeps);
      readDepths.push(input.depth);
      return null;
    };
    const a = await create(remix(film));
    const b = await create(remix(film));
    const c = await create(remix(film));
    for (const job of [a, b, c]) await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await view(a.id)).toMatchObject({ status: 'failed', errorCode: 'reference_unreadable', estimateKrw: 0 });
    expect(await view(b.id)).toMatchObject({ status: 'succeeded' });
    expect(await view(c.id)).toMatchObject({ status: 'succeeded' });
    // a failed, b read again (and kept it), c used the kept reading.
    expect(readDepths).toEqual(['blueprint', 'blueprint']);
    expect(sent).toHaveLength(2);
    expect(await used()).toBe(b.estimateKrw + c.estimateKrw);
  });

  it('on the account lane too: it fails before the worker is handed anything', async () => {
    unreadable(async () => null);
    await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
    await recordLaneHeartbeat(f.sql, 'sunra_mcp', {});
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const job = await create(remix(film));
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect(await jobRow(job.id)).toMatchObject({ status: 'failed', error_code: 'failed', usage_krw: 0, lane: 'sunra_mcp' });
    expect(await laneClaim(deps, { limit: 4 })).toEqual({ ok: true, jobs: [] });
    expect(await view(job.id)).toMatchObject({ status: 'failed', errorCode: 'reference_unreadable', estimateKrw: 0 });
    expect(await used()).toBe(0);
  });

  describe('a reshoot of a blueprint clip', () => {
    const MADE_WITH = '0.0–6.0s: a hand lifts our bottle in a close-up, slow push in.';
    async function reshoot(): Promise<StudioJobView> {
      const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
      const root = await seedRun(deps, f.orgId, f.ids.owner, {
        kind: 'video_remix',
        finalPrompt: MADE_WITH,
        refs: [{ assetId: film }],
        params: { method: 'blueprint', keep: ['camera', 'timing'], change: '제품: 우리 병' },
      });
      const made = await createStudioJob(deps, owner(), {
        kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId: root.outputId, mode: 'reshoot', prompt: '병을 파란색으로', references: [],
      });
      if (!made.ok) throw new Error(`reshoot failed: ${made.code}`);
      return made.job;
    }

    it('remakes its earlier prompt, so it still runs when the reading fails (unchanged)', async () => {
      unreadable(async () => null);
      const job = await reshoot();
      await advanceStudioJobsWith(deps, { jobIds: [job.id] });
      expect(await view(job.id)).toMatchObject({ status: 'succeeded' });
      expect(readDepths).toEqual(['blueprint']);
      expect(enhanced[0]!.video).toMatchObject({ method: 'blueprint', sheet: null });
      expect(enhanced[0]!.revision).toMatchObject({ mode: 'reshoot', madeWith: MADE_WITH });
    });

    it('fails like a first run when its earlier prompt is gone too', async () => {
      unreadable(async () => null);
      const job = await reshoot();
      await f.sql.query('update brand_studio_jobs set params = jsonb_set(params, $2, to_jsonb($3::text)) where id = $1', [job.id, '{revision,baseJobId}', '00000000-0000-4000-8000-000000000000']);
      const row = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [job.id])).rows[0]!;
      await expect(prepareJob(deps, row)).rejects.toMatchObject({ name: 'PrepareFailure', code: 'reference_unreadable' });
      expect(enhanced).toEqual([]);
    });
  });
});

describe('reading and previewing', () => {
  it('keeps the blueprint reading apart from the basic one, each read once', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    expect(await analyzeStudioFilm(deps, owner(), { organizationId: f.orgId, assetId: film })).toMatchObject({ ok: true });
    expect(await analyzeStudioFilm(deps, owner(), { organizationId: f.orgId, assetId: film, depth: 'blueprint' })).toMatchObject({ ok: true });
    await analyzeStudioFilm(deps, owner(), { organizationId: f.orgId, assetId: film, depth: 'blueprint' });
    await analyzeStudioFilm(deps, owner(), { organizationId: f.orgId, assetId: film });
    expect(readDepths).toEqual([undefined, 'blueprint']);
    const kept = (await f.sql.query<{ film_sheets: Record<string, unknown> }>('select film_sheets from brand_studio_assets where id = $1', [film])).rows[0]!.film_sheets;
    expect(Object.keys(kept).sort()).toEqual(['blueprint:ko', 'ko']);
    expect(await analyzeStudioFilm(deps, owner(), { organizationId: f.orgId, assetId: film, depth: 'deep' })).toEqual({ ok: false, code: 'invalid' });
  });

  it('previews a blueprint as it will be sent: no video among the references', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const { requestId: _drop, ...preview } = { ...remix(film), organizationId: f.orgId, requestId: randomUUID() };
    const result = await previewStudioPrompt(deps, owner(), preview);
    expect(result.ok).toBe(true);
    expect(enhanced[0]!.references).toEqual([]);
    expect(enhanced[0]!.video?.method).toBe('blueprint');
    expect(readDepths).toEqual(['blueprint']);
  });
});
