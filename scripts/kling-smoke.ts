import { config as loadEnv } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KlingError, createKlingClient, isKlingTerminal, klingConfigFromEnv, toKlingBody } from '@/lib/kling/client';
import { KLING_MODELS, estimateKlingUsd, type KlingAspect, type KlingResolution } from '@/lib/kling/models';
import { looksLikeFaceRefusal } from '@/lib/renders/engines';

/**
 * `npm run kling:smoke` — the real-person policy smoke for Kling (docs/PLATFORM-2.0.md §7.3,
 * §18 R2): ONE image-to-video task with a test selfie as `@image_1`, and a record of what the
 * provider did with it — accepted and rendered, or refused and with which code. That record is
 * what decides whether `kling-omni` joins the maker engine list (lib/recipes/schema.ts); the
 * script decides nothing.
 *
 * Spends real money (≈ $0.56 for the default: 3.0 Omni, 720p, 5 s with audio), says so first,
 * does one task. `--dry` prints the request and exits. No `KLING_API_KEY` → prints `skip` and
 * exits 0, so a machine without the key can run the whole script set. The key is never printed.
 *
 * Reads `.env.local` first, like `ark-smoke.ts`.
 *
 * Usage:
 *   npm run kling:smoke -- --dry
 *   npm run kling:smoke -- --photo ./tmp/me.jpg
 *   npm run kling:smoke -- --photo ./tmp/me.jpg --resolution 1080p --seconds 5 --ratio 9:16
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

/** A licensed demo selfie the studio reel already ships; pass `--photo` for your own. */
const DEFAULT_PHOTO = 'public/reel/studio-demo/reference-selfie.jpeg';
const DEFAULT_PROMPT =
  'Image 1 shows the person to feature. Keep their identity, face and features exactly as photographed. ' +
  'They look up from a phone, smile at the camera and give a small wave. Static tripod shot, soft window light, 24 fps.';

function mimeOf(path: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

interface SmokeRecord {
  engine: 'kling-omni';
  model: string;
  modelId: string;
  realPersonInput: true;
  photo: string;
  settings: { resolution: string; seconds: number; aspect: string };
  outcome: 'skipped' | 'dry' | 'accepted' | 'refused' | 'failed';
  refusedAtInput: boolean;
  looksLikeFaceRefusal: boolean | null;
  code: string | null;
  message: string | null;
  taskId: string | null;
  resultHost: string | null;
  savedTo: string | null;
  billedUsd: number | null;
  estimatedUsd: number | null;
  elapsedSeconds: number | null;
  at: string;
}

async function save(record: SmokeRecord): Promise<void> {
  await mkdir(resolve('tmp'), { recursive: true });
  const out = resolve(`tmp/kling-smoke-${Date.now()}.json`);
  await writeFile(out, JSON.stringify(record, null, 2));
  console.log(`record    : ${out}`);
}

async function main(): Promise<number> {
  const dry = flag('dry') !== null;
  const config = klingConfigFromEnv();
  const model = config?.model ?? 'kling-3.0-omni';
  const spec = KLING_MODELS[model];
  const resolution = (flag('resolution') ?? '720p') as KlingResolution;
  const aspect = (flag('ratio') ?? '9:16') as KlingAspect;
  const seconds = Number.parseInt(flag('seconds') ?? '5', 10);
  const photoPath = flag('photo') || DEFAULT_PHOTO;
  const prompt = flag('prompt') || DEFAULT_PROMPT;
  if (!(spec.resolutions as readonly string[]).includes(resolution) || !(spec.aspects as readonly string[]).includes(aspect)) {
    console.error(`refusing: ${model} renders ${spec.resolutions.join('/')} at ${spec.aspects.join(' · ')}`);
    return 2;
  }
  const estimate = estimateKlingUsd({ model, resolution, seconds });
  if (estimate === null) {
    console.error(`refusing: ${seconds}s is outside ${model}'s ${spec.minDurationSeconds}–${spec.maxDurationSeconds}s`);
    return 2;
  }

  console.log(`KLING_API_KEY present: ${config !== null}`);
  console.log(`model     : ${model} → POST /omni-video/${config?.modelId ?? spec.id}`);
  console.log(`settings  : ${resolution} · ${seconds}s · ${aspect} · audio native`);
  console.log(`photo     : ${photoPath} (sent as @image_1 — a real person, on purpose)`);
  console.log(`estimate  : $${estimate.toFixed(3)} (billed only if the task succeeds)`);

  const base = { engine: 'kling-omni' as const, model, modelId: config?.modelId ?? spec.id, realPersonInput: true as const, photo: photoPath, settings: { resolution, seconds, aspect }, at: new Date().toISOString() };
  const empty = { refusedAtInput: false, looksLikeFaceRefusal: null, code: null, message: null, taskId: null, resultHost: null, savedTo: null, billedUsd: null, estimatedUsd: estimate, elapsedSeconds: null };

  const photo = new Uint8Array(await readFile(resolve(photoPath)));
  const input = { prompt, references: [{ type: 'image' as const, url: `data:${mimeOf(photoPath)};base64,${Buffer.from(photo).toString('base64')}` }], resolution, aspect, duration: seconds, audio: 'native' as const };
  if (dry) {
    const body = toKlingBody(input, model);
    const shown = { ...body, contents: (body.contents as Array<Record<string, unknown>>).map((item) => (typeof item.url === 'string' ? { ...item, url: `<base64 ${item.url.length} chars>` } : item)) };
    console.log('--dry: not calling. Request body:');
    console.log(JSON.stringify(shown, null, 2));
    await save({ ...base, ...empty, outcome: 'dry' });
    return 0;
  }
  if (!config) {
    console.log('skip: KLING_API_KEY is not set — nothing to call. The maker engine list stays as it is.');
    await save({ ...base, ...empty, outcome: 'skipped' });
    return 0;
  }

  const client = createKlingClient(config);
  const started = Date.now();
  let id: string;
  try {
    ({ id } = await client.createVideoTask(input));
  } catch (error) {
    return report(error, base, empty, estimate, true);
  }
  console.log(`task created: ${id}`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    let task;
    try {
      task = await client.getVideoTask(id);
    } catch (error) {
      if (error instanceof KlingError && error.retryable) {
        console.log(`  poll: ${error.code} (retryable), continuing`);
        continue;
      }
      return report(error, base, { ...empty, taskId: id }, estimate, false);
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`  ${elapsed}s  status=${task.status}`);
    if (!isKlingTerminal(task.status)) {
      if (elapsed > 20 * 60) {
        console.error('gave up after 20 minutes; the task may still finish — check the console.');
        await save({ ...base, ...empty, outcome: 'failed', taskId: id, message: 'timeout', elapsedSeconds: elapsed });
        return 1;
      }
      continue;
    }
    if (task.status !== 'succeeded' || !task.videoUrl) {
      const message = task.message ?? '(no message)';
      const policy = /risk control|content security|policy|sensitive|violat|prohibit/i.test(message);
      console.error(`task ${task.status}: ${message}`);
      if (policy) console.error('→ refused by the platform policy after submission (not retryable)');
      await save({ ...base, ...empty, outcome: policy ? 'refused' : 'failed', refusedAtInput: false, looksLikeFaceRefusal: policy ? looksLikeFaceRefusal(message) : null, message, taskId: id, elapsedSeconds: elapsed });
      return 1;
    }
    const url = new URL(task.videoUrl);
    console.log(`succeeded. duration=${task.durationSeconds ?? '?'}s billed=${task.billedUsd ?? '(not reported in USD)'} host=${url.host} (kept 30 days)`);
    const response = await fetch(task.videoUrl);
    if (!response.ok) {
      console.error(`download failed: HTTP ${response.status}`);
      await save({ ...base, ...empty, outcome: 'accepted', taskId: id, resultHost: url.host, billedUsd: task.billedUsd, elapsedSeconds: elapsed, message: `download HTTP ${response.status}` });
      return 1;
    }
    await mkdir(resolve('tmp'), { recursive: true });
    const outPath = resolve('tmp', `kling-smoke-${id}.mp4`);
    await writeFile(outPath, new Uint8Array(await response.arrayBuffer()));
    console.log(`downloaded: ${outPath}`);
    console.log('→ a real selfie was ACCEPTED as a reference. Look at the film before deciding anything about face fidelity.');
    await save({ ...base, ...empty, outcome: 'accepted', taskId: id, resultHost: url.host, savedTo: outPath, billedUsd: task.billedUsd, elapsedSeconds: elapsed });
    return 0;
  }
}

async function report(error: unknown, base: Omit<SmokeRecord, 'outcome' | keyof typeof EMPTY>, empty: typeof EMPTY, estimate: number, atInput: boolean): Promise<number> {
  if (error instanceof KlingError) {
    console.error(`KlingError ${error.code} (HTTP ${error.status}, retryable=${error.retryable}): ${error.message}`);
    if (error.moderated) console.error(atInput ? '→ the input was refused by the platform policy (1300/1301) — not retryable' : '→ refused by policy');
    if (error.accessProblem) console.error('→ key, balance, model permission or IP allowlist: console work');
    await save({ ...base, ...empty, outcome: error.moderated ? 'refused' : 'failed', refusedAtInput: error.moderated && atInput, looksLikeFaceRefusal: error.moderated ? looksLikeFaceRefusal(error.message) : null, code: error.code, message: error.message, estimatedUsd: estimate });
  } else {
    console.error(error);
    await save({ ...base, ...empty, outcome: 'failed', message: error instanceof Error ? error.message : String(error), estimatedUsd: estimate });
  }
  return 1;
}

const EMPTY = { refusedAtInput: false, looksLikeFaceRefusal: null as boolean | null, code: null as string | null, message: null as string | null, taskId: null as string | null, resultHost: null as string | null, savedTo: null as string | null, billedUsd: null as number | null, estimatedUsd: null as number | null, elapsedSeconds: null as number | null };

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
