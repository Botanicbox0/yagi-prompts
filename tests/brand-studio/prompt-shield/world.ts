/**
 * One fixed set of runs, one of every kind a job answer can carry (docs: the video prompt shield brief, Step 0).
 * Ids, keys and times are fixed so `jobView` of these rows is the same on every machine; the database copy of
 * the same rows feeds the state, poll and assets-page answers. Every video run's sent text carries `SENTINEL`
 * so a later test can look for it in a serialized answer.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { JobRow, OutputRow, StudioJobParams } from '@/lib/brand-studio/types';

/** A sentence that never appears anywhere else in the repository. */
export const SENTINEL = 'Quillwort sentinel 7Q: the violet heron folds a brass map twice';
/** What the writer kept in `work.enhanceNotes` for a designed video run. */
export const NOTES_SENTINEL = 'Notes sentinel 4K: lantern moss under copper rain';

export const fixedId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (n: number, ext: string): string => `st/${String(n).padStart(64, '0')}.${ext}`;
const at = (minute: number): string => new Date(Date.UTC(2026, 10, 20, 10, minute)).toISOString();

export const WORLD = {
  imageAsset: fixedId(901),
  videoAsset: fixedId(902),
  job: {
    image: fixedId(101),
    region: fixedId(102),
    videoTyped: fixedId(103),
    videoDesigned: fixedId(104),
    videoReviewed: fixedId(105),
    remixBasic: fixedId(106),
    remixBlueprint: fixedId(107),
    videoFinal: fixedId(108),
    videoRevision: fixedId(109),
    preset: fixedId(110),
    music: fixedId(111),
    videoBlockRetry: fixedId(112),
    videoQueued: fixedId(113),
  },
  output: {
    image0: fixedId(201),
    image1: fixedId(202),
    region: fixedId(203),
    videoTyped: fixedId(204),
    videoDesigned: fixedId(205),
    videoReviewed: fixedId(206),
    remixBasic: fixedId(207),
    remixBlueprint: fixedId(208),
    videoFinal: fixedId(209),
    videoRevision: fixedId(210),
    preset: fixedId(211),
    music: fixedId(212),
    videoBlockRetry: fixedId(213),
    videoQueued: fixedId(214),
  },
} as const;

/** The text each run sent (or would send). Every video one carries the sentinel. */
export const SENT = {
  image: 'Image designed: a cobalt bottle on white seamless paper, soft top light.',
  region: 'Region designed: replace the label with a plain white one.',
  videoDesigned: `[Scene] ${SENTINEL}. Slow dolly in on the bottle, 5 seconds.\n[Look] cool daylight.`,
  videoReviewed: `Reviewed sentence: ${SENTINEL}. The bottle turns slowly on a turntable.`,
  remixBasic: `Remix designed: ${SENTINEL}. Keep the camera, change the colour to blue.`,
  remixBlueprint: `Blueprint designed: ${SENTINEL}.\nShot 1 0-2s wide.\nShot 2 2-5s close-up.`,
  videoRevision: `Revision designed: ${SENTINEL}. Same shot, slower turn.`,
  preset: `Preset text (server only): character sheet ${SENTINEL}.`,
  music: 'Music designed: bright acoustic pop, 100 bpm.',
  videoBlockRetry: `Block retry rewrite: ${SENTINEL}. A calm product shot.`,
} as const;

const imageParams = (extra: Partial<StudioJobParams> = {}): StudioJobParams =>
  ({ aspect: '1:1', resolution: '2K', seconds: null, audio: null, count: 1, locale: 'ko', ...extra }) as StudioJobParams;
const videoParams = (extra: Partial<StudioJobParams> = {}): StudioJobParams =>
  ({ aspect: '9:16', resolution: '720p', seconds: 5, audio: 'native', count: 1, locale: 'ko', ...extra }) as StudioJobParams;

function job(id: string, organizationId: string, by: string, minute: number, fields: Partial<JobRow> & Pick<JobRow, 'kind' | 'model' | 'prompt'>): JobRow {
  return {
    id,
    organization_id: organizationId,
    created_by: by,
    request_id: `req_world_${id.slice(-4)}`,
    status: 'succeeded',
    lane: 'sunra_api',
    final_prompt: null,
    enhance: true,
    params: videoParams(),
    refs: [],
    parent_output_id: null,
    estimate_usd: 0.5,
    cost_usd: null,
    estimate_krw: 700,
    usage_krw: 700,
    error_code: null,
    error_detail: null,
    work: {},
    claimed_at: null,
    attempts: 1,
    created_at: at(minute),
    started_at: at(minute),
    finished_at: at(minute + 1),
    ...fields,
  } as JobRow;
}

function output(id: string, jobId: string, organizationId: string, idx: number, minute: number, fields: Partial<OutputRow> & Pick<OutputRow, 'kind' | 'storage_key'>): OutputRow {
  return {
    id,
    job_id: jobId,
    organization_id: organizationId,
    idx,
    status: 'ready',
    provider_task_id: `task_${id.slice(-4)}`,
    draft_task_id: null,
    thumb_key: null,
    mime: fields.kind === 'image' ? 'image/png' : fields.kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
    bytes: 1000,
    width: fields.kind === 'audio' ? null : 720,
    height: fields.kind === 'audio' ? null : 1280,
    duration_ms: fields.kind === 'image' ? null : 5000,
    sha256: null,
    is_draft: false,
    saved_asset_id: null,
    created_at: at(minute + 1),
    deleted_at: null,
    ...fields,
  } as OutputRow;
}

/** Every run of the world, newest last, with its results. */
export function worldRows(organizationId: string, by: string): { jobs: JobRow[]; outputs: OutputRow[] } {
  const j = WORLD.job;
  const o = WORLD.output;
  const jobs: JobRow[] = [
    job(j.image, organizationId, by, 0, { kind: 'image', model: 'seedream-5.5', prompt: '흰 배경의 코발트 병', final_prompt: SENT.image, params: imageParams({ count: 2 }), work: { enhanceNotes: 'image notes' } as JobRow['work'] }),
    job(j.region, organizationId, by, 2, {
      kind: 'region_edit', model: 'seedream-5.5', prompt: '라벨을 흰색으로', final_prompt: SENT.region,
      params: imageParams({ aspect: null, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, source: { assetId: WORLD.imageAsset }, regionWindow: true }),
      work: { region: { patches: { '0': { patchKey: key(31, 'png'), maskKey: key(32, 'png'), box: { left: 72, top: 128, width: 360, height: 640 } } } } } as unknown as JobRow['work'],
    }),
    job(j.videoTyped, organizationId, by, 4, { kind: 'video', model: 'seedance-2.5', prompt: 'A bottle turns, typed only', enhance: false, final_prompt: null }),
    job(j.videoDesigned, organizationId, by, 6, {
      kind: 'video', model: 'seedance-2.5', prompt: '병이 천천히 돈다', final_prompt: SENT.videoDesigned,
      params: videoParams({ resolution: '480p' }),
      work: { enhanceNotes: NOTES_SENTINEL, prepared: true, sheet: null } as unknown as JobRow['work'],
    }),
    job(j.videoReviewed, organizationId, by, 8, {
      kind: 'video', model: 'seedance-2.5', prompt: '턴테이블 위의 병', enhance: false, final_prompt: SENT.videoReviewed,
      params: videoParams({ reviewedPrompt: SENT.videoReviewed }),
    }),
    job(j.remixBasic, organizationId, by, 10, {
      kind: 'video_remix', model: 'seedance-2.5', prompt: '색만 파랗게', final_prompt: SENT.remixBasic,
      params: videoParams({ method: 'reference', keep: ['camera'], change: 'make it blue', referenceVideoSeconds: 6 }),
      refs: [{ assetId: WORLD.videoAsset }],
      work: { enhanceNotes: NOTES_SENTINEL, sheet: { seconds: 6, shots: [] } } as unknown as JobRow['work'],
    }),
    job(j.remixBlueprint, organizationId, by, 12, {
      kind: 'video_remix', model: 'seedance-2.5', prompt: '같은 구성으로 우리 제품', final_prompt: SENT.remixBlueprint,
      params: videoParams({
        method: 'blueprint', keep: ['timing', 'composition'], change: '',
        shots: [
          { start: 0, end: 2, framing: 'wide', camera: 'locked-off', action: 'the bottle stands on stone' },
          { start: 2, end: 5, framing: 'close-up', camera: 'slow push', action: 'a hand lifts the bottle', transition: 'hard cut' },
        ],
      }),
      refs: [{ assetId: WORLD.imageAsset }],
    }),
    job(j.videoFinal, organizationId, by, 14, {
      kind: 'video_final', model: 'seedance-2.5', prompt: '', enhance: false, final_prompt: SENT.videoDesigned,
      params: videoParams({ resolution: '1080p', draftOutputId: o.videoDesigned }),
      parent_output_id: o.videoDesigned,
    }),
    job(j.videoRevision, organizationId, by, 16, {
      kind: 'video', model: 'seedance-2.5', prompt: '① 더 천천히 돌게', final_prompt: SENT.videoRevision,
      parent_output_id: o.videoDesigned,
      params: videoParams({
        revision: {
          rootJobId: j.videoDesigned, version: 2, baseJobId: j.videoDesigned, baseOutputId: o.videoDesigned, mode: 'reshoot', added: 0,
          marks: [{ time: 1.2, x: 0.3, y: 0.4, w: 0.1, h: 0.1, label: '병뚜껑', what: 'the brass bottle cap' }],
          clarified: { question: '얼마나 천천히요?', answer: '절반 속도' },
          // `keep` holds an object the sheet cleaner drops (pinned as such by the Step 0 snapshot).
          dialogue: { sheet: { change: [{ text: '회전을 더 천천히', kind: 'motion' }], keep: [{ text: '조명' }], exclude: [] }, questions: [], transcript: [] },
        },
      } as unknown as Partial<StudioJobParams>),
    }),
    job(j.preset, organizationId, by, 18, {
      kind: 'image', model: 'seedream-5.5', prompt: '영상용 시트', enhance: false, final_prompt: SENT.preset,
      params: imageParams({ preset: { id: 'video-character-sheet', vars: {} } }),
    }),
    job(j.music, organizationId, by, 20, {
      kind: 'music', model: 'suno-v6', prompt: '밝은 어쿠스틱', final_prompt: SENT.music, refs: [],
      params: { aspect: null, resolution: null, seconds: null, audio: null, count: 2, locale: 'ko', music: { mode: 'describe', vocal: false, language: 'ko', title: '밝은 어쿠스틱', careful: false } } as StudioJobParams,
      work: { enhancer: { profile: 'suno', title: 'Morning Bottle' } } as unknown as JobRow['work'],
    }),
    job(j.videoBlockRetry, organizationId, by, 22, {
      kind: 'video', model: 'seedance-2.5', prompt: '조용한 제품 컷', enhance: false, final_prompt: SENT.videoBlockRetry,
      work: { blockRetry: { source: 'model' } } as unknown as JobRow['work'],
    }),
    job(j.videoQueued, organizationId, by, 24, {
      kind: 'video', model: 'seedance-2.5', prompt: '아직 설계 전', status: 'queued', final_prompt: null, usage_krw: null, finished_at: null,
    }),
  ];
  const outputs: OutputRow[] = [
    output(o.image0, j.image, organizationId, 0, 0, { kind: 'image', storage_key: key(1, 'png'), width: 1024, height: 1024 }),
    output(o.image1, j.image, organizationId, 1, 0, { kind: 'image', storage_key: key(2, 'png'), width: 1024, height: 1024 }),
    output(o.region, j.region, organizationId, 0, 2, { kind: 'image', storage_key: key(3, 'png') }),
    output(o.videoTyped, j.videoTyped, organizationId, 0, 4, { kind: 'video', storage_key: key(4, 'mp4') }),
    output(o.videoDesigned, j.videoDesigned, organizationId, 0, 6, { kind: 'video', storage_key: key(5, 'mp4'), is_draft: true, draft_task_id: 'draft_world_1' }),
    output(o.videoReviewed, j.videoReviewed, organizationId, 0, 8, { kind: 'video', storage_key: key(6, 'mp4') }),
    output(o.remixBasic, j.remixBasic, organizationId, 0, 10, { kind: 'video', storage_key: key(7, 'mp4') }),
    output(o.remixBlueprint, j.remixBlueprint, organizationId, 0, 12, { kind: 'video', storage_key: key(8, 'mp4') }),
    output(o.videoFinal, j.videoFinal, organizationId, 0, 14, { kind: 'video', storage_key: key(9, 'mp4'), width: 1080, height: 1920 }),
    output(o.videoRevision, j.videoRevision, organizationId, 0, 16, { kind: 'video', storage_key: key(10, 'mp4') }),
    output(o.preset, j.preset, organizationId, 0, 18, { kind: 'image', storage_key: key(11, 'png') }),
    output(o.music, j.music, organizationId, 0, 20, { kind: 'audio', storage_key: key(12, 'mp3'), waveform: [0.1, 0.5, 0.9] }),
    output(o.videoBlockRetry, j.videoBlockRetry, organizationId, 0, 22, { kind: 'video', storage_key: key(13, 'mp4') }),
    output(o.videoQueued, j.videoQueued, organizationId, 0, 24, { kind: 'video', storage_key: null, status: 'pending', provider_task_id: null }),
  ];
  return { jobs, outputs };
}

/** The world's library entries (the region edit's source picture and the remix's reference film). */
async function seedAssets(sql: SqlRunner, organizationId: string, by: string): Promise<void> {
  await sql.query(
    `insert into brand_studio_assets (id, organization_id, kind, role, name, mime, size_bytes, width, height, storage_key, source, status, created_by, sha256, created_at)
      values ($1, $2, 'image', 'product', 'bottle', 'image/png', 100, 720, 1280, $3, 'upload', 'ready', $4, $5, $6)`,
    [WORLD.imageAsset, organizationId, key(41, 'png'), by, '1'.repeat(64), at(0)],
  );
  await sql.query(
    `insert into brand_studio_assets (id, organization_id, kind, name, mime, size_bytes, width, height, duration_ms, storage_key, source, status, created_by, created_at)
      values ($1, $2, 'video', 'ref film', 'video/mp4', 12, 720, 1280, 6000, $3, 'upload', 'ready', $4, $5)`,
    [WORLD.videoAsset, organizationId, key(42, 'mp4'), by, at(0)],
  );
}

/** The same rows, in the database (results before the runs that point at them). */
export async function seedWorld(sql: SqlRunner, organizationId: string, by: string): Promise<{ jobs: JobRow[]; outputs: OutputRow[] }> {
  const rows = worldRows(organizationId, by);
  await seedAssets(sql, organizationId, by);
  for (const r of rows.jobs) {
    await sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, lane, model, prompt, final_prompt, enhance,
          params, refs, parent_output_id, estimate_usd, estimate_krw, usage_krw, work, attempts, created_at, started_at, finished_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, null, $14, $15, $16, $17::jsonb, $18, $19, $20, $21)`,
      [r.id, r.organization_id, r.created_by, r.request_id, r.kind, r.status, r.lane, r.model, r.prompt, r.final_prompt, r.enhance,
        JSON.stringify(r.params), JSON.stringify(r.refs), r.estimate_usd, r.estimate_krw, r.usage_krw, JSON.stringify(r.work), r.attempts,
        r.created_at, r.started_at, r.finished_at],
    );
  }
  for (const o of rows.outputs) {
    await sql.query(
      `insert into brand_studio_outputs (id, job_id, organization_id, idx, kind, status, provider_task_id, draft_task_id, storage_key, mime, bytes,
          width, height, duration_ms, is_draft, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [o.id, o.job_id, o.organization_id, o.idx, o.kind, o.status, o.provider_task_id, o.draft_task_id, o.storage_key, o.mime, o.bytes,
        o.width, o.height, o.duration_ms, o.is_draft, o.created_at],
    );
  }
  for (const r of rows.jobs.filter((x) => x.parent_output_id)) {
    await sql.query('update brand_studio_jobs set parent_output_id = $2 where id = $1', [r.id, r.parent_output_id]);
  }
  return rows;
}

/**
 * An answer as stable text: ids, media keys, request ids and times are replaced by their order of first
 * appearance, so a snapshot pins everything else byte for byte.
 */
export function stable(value: unknown): string {
  const seen = new Map<string, string>();
  const name = (prefix: string, raw: string): string => {
    const k = `${prefix}:${raw}`;
    if (!seen.has(k)) seen.set(k, `<${prefix}${[...seen.keys()].filter((x) => x.startsWith(`${prefix}:`)).length + 1}>`);
    return seen.get(k)!;
  };
  return `${JSON.stringify(value, null, 2)}\n`
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (m) => (m.startsWith('00000000-0000-4000-8000-') ? m : name('id', m.toLowerCase())))
    .replace(/\bst\/[0-9a-f]{64}\.[a-z0-9]+/g, (m) => (/^st\/0+\d+\./.test(m) ? m : name('key', m)))
    .replace(/\breq_[A-Za-z0-9_-]{8,}/g, (m) => (m.startsWith('req_world_') ? m : name('req', m)))
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, (m) => (m.startsWith('2026-11-20T10:') ? m : '<time>'));
}
