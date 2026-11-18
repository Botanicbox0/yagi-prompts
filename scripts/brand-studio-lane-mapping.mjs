/**
 * The account-lane worker's mapping (scripts/brand-studio-lane-worker.mjs, docs/BRAND-STUDIO-LANE-WORKER.md):
 * how a claimed job becomes one `sunra` CLI call, and how its reference videos become uploads the CLI takes.
 * No CLI and no app calls here; the network is passed in. Plain Node, no dependencies, so the worker still
 * runs from any checkout, and tests/brand-studio/server/lane-worker.test.ts runs this without the CLI.
 */

/** The CLI said no: a refusal is an answer, not a bad moment to retry. */
export class CliRefusal extends Error {}

/** A reference video could not be moved to the account lane. Nothing was generated or charged. */
export class ReferenceUploadError extends Error {}

/** Same cap as a studio upload (`STUDIO_LIMITS.videoBytesMax`, lib/brand-studio/contracts.ts). */
export const REFERENCE_VIDEO_MAX_BYTES = 50_000_000;
export const REFERENCE_DOWNLOAD_TIMEOUT_MS = 120_000;
export const REFERENCE_UPLOAD_TIMEOUT_MS = 180_000;

/** The video types `get_upload_url` takes on a personal account (CLI help, 2026-11-18). */
const UPLOAD_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

/** A message as it may be logged or reported: every URL without its query string or fragment (signed addresses keep their secret there). */
export function redactUrls(text) {
  return String(text).replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1');
}

/** How a refusal of the generation reads to the app (lib/brand-studio/lane-api.ts `laneFail`). */
export function failureCode(message) {
  if (/safety|policy|sensitive|moderat|violat|prohibit|not allowed|copyright/i.test(message)) return 'provider_rejected';
  if (/insufficient|credit|balance|concurren|rate limit|too many|unavailable|timeout/i.test(message)) return 'provider_unavailable';
  return 'failed';
}

/**
 * The code a failed run is reported with. A reference upload that failed is a plain failure: the run took
 * nothing and can be pressed again. It is never `provider_unavailable`, which closes the whole account lane
 * for ten minutes as a lane that cannot pay, nor `provider_rejected`, which rewords the prompt and retries.
 */
export function failureCodeOf(error) {
  if (error instanceof ReferenceUploadError) return 'failed';
  if (error instanceof CliRefusal) return failureCode(error.message);
  return 'failed';
}

/* ------------------------------------------------------------- mapping */

const imagesOf = (job) => job.inputs.filter((i) => i.kind === 'image');

/**
 * The run follows its reference video's length (`duration: -1`): an edit, or a new take whose length was not
 * picked. The same rule as lib/brand-studio/reference-video.ts `followsReferenceLength`.
 */
export function followsReference(job) {
  const p = job.params;
  return job.kind === 'video_remix' && p.method !== 'blueprint' && (p.method === 'edit' || typeof p.seconds !== 'number');
}

/** One CLI call per result slot; an image job with count N is N calls. */
export function toolCall(job, project) {
  const p = job.params;
  const base = { project_id: project, model: job.model, prompt: job.prompt, count: 1, auto_confirm: true };
  if (job.kind === 'image' || job.kind === 'region_edit') {
    const urls = imagesOf(job).map((i) => i.url);
    return {
      tool: 'create_image',
      input: {
        ...base,
        ...(p.aspect ? { aspect_ratio: p.aspect } : {}),
        ...(p.resolution ? { resolution: p.resolution } : {}),
        // GPT Image: low / medium / high (absent for models without a quality choice).
        ...(p.quality ? { quality: p.quality } : {}),
        ...(urls.length ? { image_urls: urls } : {}),
        // A region edit is pasted back into the original, so it stays lossless; a plain picture travels lighter.
        output_format: job.kind === 'region_edit' ? 'png' : 'jpeg',
      },
    };
  }
  if (job.kind === 'video_final') {
    if (!job.draftTaskId) throw new CliRefusal('final without a draft id');
    return { tool: 'create_video', input: { project_id: project, model: job.model, draft_source_task_id: job.draftTaskId, auto_confirm: true } };
  }
  const video = job.inputs.find((i) => i.kind === 'video');
  const audios = job.inputs.filter((i) => i.kind === 'audio').map((i) => i.url);
  const start = imagesOf(job).find((i) => i.frame === 'start');
  const end = imagesOf(job).find((i) => i.frame === 'end');
  const refs = imagesOf(job).filter((i) => !i.frame).map((i) => i.url);
  const edit = job.kind === 'video_remix' && p.method === 'edit';
  const follow = followsReference(job);
  // A reference run cannot mix first/last frames with reference media: frames then travel as references.
  const referenceRun = Boolean(video) || refs.length > 0 || audios.length > 0;
  const frameRefs = referenceRun ? [start, end].filter(Boolean).map((i) => i.url) : [];
  // The CLI: "Duration -1 cannot be a preview". The app plans such a run as a standard 480p video
  // (lib/brand-studio/reference-video.ts `isDraftRun`); this holds for a job planned before that rule too.
  const preview = Boolean(p.draft) && !follow;
  return {
    tool: 'create_video',
    input: {
      ...base,
      generate_audio: p.audio !== 'silent',
      resolution: p.resolution ?? '720p',
      // Following the source: length -1, as the API lane sends it; an edit also keeps the source's shape.
      ...(follow
        ? { duration: -1, ...(!edit && p.aspect ? { aspect_ratio: p.aspect } : {}) }
        : { ...(p.aspect ? { aspect_ratio: p.aspect } : {}), ...(p.seconds ? { duration: p.seconds } : {}) }),
      // At 480p the CLI makes a preview unless told otherwise, so the answer is always explicit there.
      ...(p.resolution === '480p' ? { draft: preview } : {}),
      ...(!referenceRun && start ? { start_image: start.url } : {}),
      ...(!referenceRun && start && end ? { end_image: end.url } : {}),
      ...(referenceRun && [...frameRefs, ...refs].length ? { reference_images: [...frameRefs, ...refs] } : {}),
      ...(video ? { reference_videos: [video.url] } : {}),
      ...(audios.length ? { reference_audios: audios } : {}),
    },
  };
}

/** The draft id a finished task leaves: its own task id, and only when it was sent as a preview. */
export function draftTaskIdOf(call, created) {
  return call.tool === 'create_video' && call.input.draft === true && created?.task_id ? String(created.task_id) : undefined;
}

export function mimeOf(url, type) {
  if (type === 'VIDEO' || /\.(mp4|mov)(\?|$)/i.test(url)) return /\.mov(\?|$)/i.test(url) ? 'video/quicktime' : 'video/mp4';
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

/* ------------------------------------------------- reference videos */

const reason = (error) => (error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timed out' : String(error?.name ?? 'error'));

async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {
    /* nothing to release */
  }
}

/** The video's bytes from its stored address, never more than `maxBytes`. */
async function fetchVideo(url, deps) {
  const max = deps.maxBytes ?? REFERENCE_VIDEO_MAX_BYTES;
  let res;
  try {
    res = await deps.fetch(url, { signal: AbortSignal.timeout(deps.downloadTimeoutMs ?? REFERENCE_DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new ReferenceUploadError(`reference video not fetched (${reason(error)})`);
  }
  if (!res.ok) {
    await discard(res);
    throw new ReferenceUploadError(`reference video not fetched (${res.status})`);
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await discard(res);
    throw new ReferenceUploadError(`reference video over ${max} bytes`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new ReferenceUploadError('reference video is empty');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new ReferenceUploadError(`reference video over ${max} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ReferenceUploadError) throw error;
    throw new ReferenceUploadError(`reference video not fetched (${reason(error)})`);
  }
  if (total === 0) throw new ReferenceUploadError('reference video is empty');
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

const isHttps = (value) => typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value);

async function uploadOne(input, deps) {
  const contentType = Object.hasOwn(UPLOAD_TYPES, String(input.mime ?? '').toLowerCase()) ? String(input.mime).toLowerCase() : 'video/mp4';
  const bytes = await fetchVideo(input.url, deps);
  let slot;
  try {
    slot = await deps.uploadSlot({ content_type: contentType, filename: `reference.${UPLOAD_TYPES[contentType]}` });
  } catch (error) {
    // The slot is asked of the CLI; its words go no further than this (they could name a signed address).
    throw new ReferenceUploadError(`no upload slot (${error instanceof CliRefusal ? 'refused' : reason(error)})`);
  }
  if (!slot || !isHttps(slot.upload_url) || !isHttps(slot.asset_url)) throw new ReferenceUploadError('upload slot incomplete');
  const method = typeof slot.method === 'string' && /^[a-z]+$/i.test(slot.method) ? slot.method.toUpperCase() : 'PUT';
  // Every header the slot names, as named (some are signed); nothing else.
  const headers = Object.fromEntries(Object.entries(slot.headers ?? {}).filter(([, value]) => typeof value === 'string'));
  let res;
  try {
    res = await deps.fetch(slot.upload_url, { method, headers, body: bytes, signal: AbortSignal.timeout(deps.uploadTimeoutMs ?? REFERENCE_UPLOAD_TIMEOUT_MS) });
  } catch (error) {
    throw new ReferenceUploadError(`reference upload failed (${reason(error)})`);
  }
  await discard(res);
  if (!res.ok) throw new ReferenceUploadError(`reference upload refused (${res.status})`);
  return { url: slot.asset_url, bytes: bytes.byteLength };
}

/**
 * The account lane takes a reference video only as one of its own uploads ("Reference video must be an
 * uploaded asset", 2026-11-18; reference pictures and sounds from other hosts are taken as they are). Each
 * distinct video of the job is fetched from its stored address, PUT on a fresh slot from `get_upload_url`
 * with every header the slot names, and replaced by the slot's `asset_url`: one upload per distinct video
 * per run, however many results the run makes. Nothing is generated or charged by this.
 *
 * deps: { uploadSlot({ content_type, filename }) -> { upload_url, method?, headers?, asset_url }, fetch,
 *         maxBytes?, downloadTimeoutMs?, uploadTimeoutMs? }
 * Returns the job with the asset URLs (the claimed job itself is not changed), and what was uploaded.
 */
export async function withUploadedVideos(job, deps) {
  if (!job.inputs.some((i) => i.kind === 'video')) return { job, uploads: 0, bytes: 0 };
  const pending = new Map();
  const uploaded = (input) => {
    if (!pending.has(input.url)) pending.set(input.url, uploadOne(input, deps));
    return pending.get(input.url);
  };
  // One after another: a run has one reference video, and the workstation's connection serves the other jobs too.
  const inputs = [];
  for (const input of job.inputs) inputs.push(input.kind === 'video' ? { ...input, url: (await uploaded(input)).url } : input);
  let bytes = 0;
  for (const done of pending.values()) bytes += (await done).bytes;
  return { job: { ...job, inputs }, uploads: pending.size, bytes };
}
