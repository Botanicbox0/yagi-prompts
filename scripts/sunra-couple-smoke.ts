import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSunraClient, sunraConfigFromEnv } from '@/lib/sunra/client';
import { SeedanceRequestError, estimateSeedanceUsd, seedanceReferenceRequest, toSunraReferenceSyntax } from '@/lib/sunra/seedance';
import { pollSunraRender, startSunraRender, sunraBookedUsd } from '@/lib/renders/engines-sunra';
import { RenderFailure, type VideoRenderInput } from '@/lib/renders/engines';
import type { VideoAspect } from '@/lib/images/engines';

/**
 * The personal Sunra lane's paid smoke (docs/PERSONAL-STUDIO.md §5.1): ONE Seedance 2.5 reference-to-video run
 * with two people's photos, through the same adapter the render pass will use (lib/renders/engines-sunra.ts).
 * It answers what tests cannot: does Sunra accept two real faces as references, what does it bill, does the
 * film keep both people. It decides nothing.
 *
 * FOR THE FOUNDER TO RUN BY HAND. No agent runs it. It spends real money and sends two people's photos to a
 * third party, so:
 *   - both photos are named on the command line (no default photo): your own, and a person who agreed;
 *   - it prints the estimated cost first and stops unless `--i-accept-the-charge` is on the command line;
 *   - it opens the lane for this one call only (the deployment's TWINGS_PERSONAL_SUNRA_FACES is not changed);
 *   - the key and the photo URLs' signatures are never printed (hosts only).
 *
 * The photos must be public https URLs Sunra can fetch (e.g. a 60-minute signed URL from the renders bucket).
 * Reads `.env.local` first, like the other smokes. Output: tmp/sunra-couple-smoke-*.mp4 and a JSON record.
 *
 * Usage:
 *   npx tsx scripts/sunra-couple-smoke.ts --image <https url: you> --image <https url: partner>
 *   npx tsx scripts/sunra-couple-smoke.ts --image <…> --image <…> --seconds 10 --resolution 720p --ratio 9:16 --i-accept-the-charge
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const CHARGE_FLAG = '--i-accept-the-charge';
const DEFAULT_PROMPT =
  'Image 1 and Image 2 stand side by side on a quiet city street at dusk, turn to each other, laugh, and walk toward the camera together. Handheld medium shot, soft practical light, 24 fps.\n\n' +
  'Image 1, Image 2 show the two people to feature. Keep each person’s identity, face and features exactly as photographed, and keep them two distinct people.';

function values(name: string): string[] {
  const argv = process.argv.slice(2);
  const out: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === `--${name}` && argv[index + 1] !== undefined) out.push(argv[index + 1]!);
  });
  return out;
}

function value(name: string): string | null {
  return values(name)[0] ?? null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(not a URL)';
  }
}

async function save(record: Record<string, unknown>): Promise<void> {
  await mkdir(resolve('tmp'), { recursive: true });
  const out = resolve(`tmp/sunra-couple-smoke-${Date.now()}.json`);
  await writeFile(out, JSON.stringify(record, null, 2));
  console.log(`record    : ${out}`);
}

async function main(): Promise<number> {
  const images = values('image');
  const seconds = Number.parseInt(value('seconds') ?? '10', 10);
  const resolution = (value('resolution') ?? '720p') as '720p' | '1080p';
  const ratio = (value('ratio') ?? '9:16') as VideoAspect;
  const prompt = value('prompt') ?? DEFAULT_PROMPT;
  const accepted = process.argv.slice(2).includes(CHARGE_FLAG);

  if (images.length !== 2) {
    console.error('refusing: name exactly two photos with --image (yours first, then a person who agreed to this test).');
    return 2;
  }
  // Validate the whole request before saying anything about money: a request Sunra would refuse costs nothing.
  try {
    seedanceReferenceRequest({ prompt: toSunraReferenceSyntax(prompt, 2), resolution, ratio, seconds, referenceImages: images });
  } catch (error) {
    console.error(`refusing: ${error instanceof SeedanceRequestError ? error.reason : String(error)}`);
    return 2;
  }

  const billed = estimateSeedanceUsd({ resolution, seconds, referenceVideoSeconds: 0 });
  const booked = sunraBookedUsd(billed);
  const config = sunraConfigFromEnv();
  console.log(`SUNRA_API_KEY present: ${config !== null}`);
  console.log('model     : Seedance 2.5 → POST /v1/queue/bytedance/seedance-2.5/reference-to-video');
  console.log(`settings  : ${resolution} · ${seconds}s · ${ratio} · sound on · no draft`);
  console.log(`photos    : @Image1 on ${hostOf(images[0]!)}, @Image2 on ${hostOf(images[1]!)} (two real people, on purpose)`);
  console.log(`ESTIMATE  : $${billed.toFixed(2)} billed by Sunra, $${booked.toFixed(4)} with the 5% top-up fee`);
  console.log('            charged whether or not the film keeps both faces; a request lost in transit may still be charged.');

  if (!accepted) {
    console.log(`not sent. To spend about $${booked.toFixed(2)} and send both photos to Sunra, run again with ${CHARGE_FLAG}.`);
    return 2;
  }
  if (config === null) {
    console.error('refusing: SUNRA_API_KEY is not set.');
    return 2;
  }

  const base = { at: new Date().toISOString(), settings: { resolution, seconds, ratio }, photoHosts: images.map(hostOf), estimateUsd: billed, estimateBookedUsd: booked };
  const charges: Array<{ taskId: string | null; usd: number; source: string }> = [];
  const circuits: Array<{ state: string; reason: string }> = [];
  const deps = {
    sunra: createSunraClient(config),
    onProviderCharge: async (taskId: string | null, usd: number, source: 'provider_usage' | 'estimate') => {
      charges.push({ taskId, usd, source });
      console.log(`  charge reported on a failure: $${usd} (${source})`);
    },
    onSunraCircuit: async (state: string, reason: string) => {
      circuits.push({ state, reason });
      console.log(`  circuit would open: ${state} — ${reason}`);
    },
  };
  const input: VideoRenderInput = {
    engine: 'seedance-2.5',
    prompt,
    aspect: ratio,
    seconds,
    photo: null,
    resolution,
    lane: 'sunra',
    references: images.map((url) => ({ type: 'image' as const, url })),
  };

  const started = Date.now();
  let taskId: string;
  try {
    // The lane is opened for this call only; the deployment's switch is untouched.
    ({ taskId } = await startSunraRender(input, deps, { ...process.env, TWINGS_PERSONAL_SUNRA_FACES: 'on' }));
  } catch (error) {
    const failure = error instanceof RenderFailure ? { code: error.code, message: error.message, retryable: error.retryable } : { code: 'error', message: String(error), retryable: false };
    console.error(`submit failed: ${failure.code} — ${failure.message}`);
    await save({ ...base, outcome: 'submit_failed', failure, charges, circuits });
    return 1;
  }
  console.log(`submitted: ${taskId}`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const elapsed = Math.round((Date.now() - started) / 1000);
    const polled = await pollSunraRender(taskId, { seconds, resolution }, deps);
    console.log(`  ${elapsed}s  ${polled.status}`);
    if (polled.status === 'pending') {
      if (elapsed > 20 * 60) {
        console.error('gave up after 20 minutes; the request may still finish (and be charged). Check the Sunra console.');
        await save({ ...base, outcome: 'timeout', taskId, elapsedSeconds: elapsed, charges, circuits });
        return 1;
      }
      continue;
    }
    if (polled.status === 'failed') {
      console.error(`failed: ${polled.failure.code} — ${polled.failure.message}`);
      await save({ ...base, outcome: 'failed', taskId, elapsedSeconds: elapsed, failure: { code: polled.failure.code, message: polled.failure.message }, charges, circuits });
      return 1;
    }
    await mkdir(resolve('tmp'), { recursive: true });
    const outPath = resolve('tmp', `sunra-couple-smoke-${taskId.replace(/[^a-z0-9-]/gi, '_')}.mp4`);
    await writeFile(outPath, polled.output.bytes);
    console.log(`succeeded: ${outPath} (${polled.output.bytes.byteLength} bytes)`);
    console.log(`booked    : $${polled.output.costUsd} (${polled.output.costSource}) — estimate was $${booked}`);
    console.log('→ look at the film: are both people there, each with their own face, and nobody else?');
    await save({ ...base, outcome: 'succeeded', taskId, elapsedSeconds: elapsed, savedTo: outPath, bookedUsd: polled.output.costUsd, costSource: polled.output.costSource, charges, circuits });
    return 0;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
