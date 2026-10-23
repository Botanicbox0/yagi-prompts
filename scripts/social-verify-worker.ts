/**
 * One pass of the follower-screenshot reader (docs/PLATFORM-2.0.md §17.1), run on the workstation:
 *   npx tsx scripts/social-verify-worker.ts
 *
 * Needs SOCIAL_VERIFY_API_ORIGIN (https://twings.app, or http://localhost:<port> locally),
 * SOCIAL_VERIFY_WORKER_SECRET (the app's value, 32+ chars) and SOCIAL_VERIFY_WORKER_ID. Optional:
 * OLLAMA_URL (default http://127.0.0.1:11434 — the gpu-arbiter, never 11444) and SOCIAL_VERIFY_MODEL
 * (default: the first installed qwen vision model, else gemma). No vision model → stops, "no model".
 *
 * The answer is a suggestion for the admin queue, nothing more. One inference at a time; a failure
 * is reported once and the pass ends, the server re-queues it (three tries in all). Scheduling and
 * quiet (no console window) launching on Windows: docs/qa/influencer-identity/README.md.
 */
import { readBoundedResponse } from '../lib/campaigns/risk/transport';
import { ollamaBase, pickVisionModel, readFollowerScreenshot } from '../lib/influencers/local-vision';
import type { SocialClaim } from '../lib/influencers/worker';

const MAX_IMAGE_BYTES = 5_000_000;

async function main() {
  const origin = process.env.SOCIAL_VERIFY_API_ORIGIN;
  const secret = process.env.SOCIAL_VERIFY_WORKER_SECRET;
  const workerId = process.env.SOCIAL_VERIFY_WORKER_ID;
  if (!origin || !secret || secret.length < 32 || !workerId) throw Error('worker_configuration_required');
  const api = new URL(origin);
  if (
    api.username || api.password || api.search || api.hash || api.pathname !== '/' ||
    (api.protocol !== 'https:' && !(api.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname)))
  ) throw Error('invalid_api_origin');
  const ollama = ollamaBase(process.env.OLLAMA_URL);
  const model = await pickVisionModel(ollama, process.env.SOCIAL_VERIFY_MODEL?.trim() || undefined);
  if (!model) {
    console.error('social-verify worker: no vision model installed (qwen or gemma family) — nothing claimed');
    process.exitCode = 2;
    return;
  }

  async function call(action: string, body: unknown): Promise<Response> {
    const r = await fetch(new URL(`/api/social-verify-worker/${action}`, api), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error(`worker_api_${action}_${r.status}`);
    return r;
  }
  const callJson = async (action: string, body: unknown) => JSON.parse(await readBoundedResponse(await call(action, body), 200_000));

  async function image(job: SocialClaim): Promise<Uint8Array> {
    let r: Response;
    if (job.imageUrl) {
      const url = new URL(job.imageUrl);
      if (url.protocol !== 'https:') throw Error('image_unavailable');
      r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw Error('image_unavailable');
    } else {
      r = await call('evidence', { id: job.id, leaseToken: job.leaseToken });
    }
    const reader = r.body?.getReader();
    if (!reader) throw Error('image_unavailable');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw Error('image_unavailable'); }
      chunks.push(chunk.value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  if (!(await callJson('heartbeat', { id: workerId, modelId: model })).ok) throw Error('worker_configuration_rejected');
  let done = 0;
  for (let n = 0; n < 20; n++) {
    const jobs = (await callJson('claim', { limit: 1 })).jobs as SocialClaim[];
    if (!jobs.length) break;
    for (const job of jobs) {
      let result: unknown;
      try {
        result = await readFollowerScreenshot(await image(job), model, ollama);
      } catch (error) {
        const code = (error as Error).message === 'image_unavailable' ? 'image_unavailable' : (error as Error).message === 'invalid_result' ? 'invalid_result' : 'model_unavailable';
        await callJson('complete', { id: job.id, leaseToken: job.leaseToken, modelId: model, error: code });
        // Stop after a failure; do not queue more work on the shared GPU.
        throw Error(`job_failed_${code}`);
      }
      if (!(await callJson('complete', { id: job.id, leaseToken: job.leaseToken, modelId: model, result })).ok) throw Error('worker_result_rejected');
      done++;
    }
    await callJson('heartbeat', { id: workerId, modelId: model });
  }
  console.log(`social-verify worker pass completed (${model}, ${done} read)`);
}

main().catch((error: Error) => {
  // Codes only: never the screenshot, the handle or the secret.
  console.error(`social-verify worker pass failed: ${/^[\w-]+$/.test(error.message) ? error.message : 'unexpected'}`);
  process.exitCode = 1;
});
