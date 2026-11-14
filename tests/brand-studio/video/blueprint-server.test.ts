import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { analyzeStudioFilm, createStudioJob, previewStudioPrompt } from '@/lib/brand-studio/jobs';
import { estimateVideoUsd, studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import { buildStudioRequest, StudioRequestError } from '@/lib/brand-studio/provider/requests';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { remakeSeconds } from '@/lib/brand-studio/reference-video';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import type { EnhanceInput } from '@/lib/brand-studio/types';
import { remixRunUsd, usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import { requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

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
