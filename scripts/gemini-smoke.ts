import { config as loadEnv } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_IMAGE_ASPECT, IMAGE_ENGINES, estimateImageUsd, imageSizeFor, isImageAspect, sizeString, type ImageAspect } from '@/lib/images/engines';
import { GeminiImageError, createGeminiImageClient, geminiConfigFromEnv, toGeminiBody } from '@/lib/images/gemini';
import { looksLikeFaceRefusal } from '@/lib/renders/engines';

/**
 * `npm run gemini:smoke` — the real-person policy smoke for Nano Banana (docs/PLATFORM-2.0.md
 * §7.3, §18 R2): ONE image edit with a test selfie as the reference, and a record of what the
 * provider did with it — an image came back, or a refusal and its words. That record is what
 * decides whether `nano-banana-2.1` joins the maker engine list (lib/recipes/schema.ts); the
 * script decides nothing.
 *
 * Spends real money (≈ $0.05 for one 2K image plus the input tokens), says so first, does ONE
 * image. `--dry` prints the request and exits. No `GEMINI_API_KEY` → prints `skip` and exits 0.
 * The key is never printed.
 *
 * Reads `.env.local` first, like `image-smoke.ts`.
 *
 * Usage:
 *   npm run gemini:smoke -- --dry
 *   npm run gemini:smoke -- --photo ./tmp/me.jpg
 *   npm run gemini:smoke -- --photo ./tmp/me.jpg --ratio 4:5
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

const ENGINE = 'nano-banana-2.1' as const;
/** A licensed demo selfie the studio reel already ships; pass `--photo` for your own. */
const DEFAULT_PHOTO = 'public/reel/studio-demo/reference-selfie.jpeg';
const DEFAULT_PROMPT =
  'Image 1 shows the person to feature. Keep their identity, face and features exactly as photographed. ' +
  'Editorial portrait of them in an empty 1994 Seoul photo studio: seamless grey paper, one softbox from the left, Betacam-era colour, no text.';

function mimeOf(path: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

interface SmokeRecord {
  engine: typeof ENGINE;
  model: string;
  realPersonInput: true;
  photo: string;
  aspect: string;
  size: string;
  outcome: 'skipped' | 'dry' | 'accepted' | 'refused' | 'failed';
  looksLikeFaceRefusal: boolean | null;
  status: number | null;
  interactionStatus: string | null;
  code: string | null;
  message: string | null;
  interactionId: string | null;
  savedTo: string | null;
  usage: unknown;
  usd: number | null;
  estimatedUsd: number;
  elapsedSeconds: number | null;
  at: string;
}

async function save(record: SmokeRecord): Promise<void> {
  await mkdir(resolve('tmp'), { recursive: true });
  const out = resolve(`tmp/gemini-smoke-${Date.now()}.json`);
  await writeFile(out, JSON.stringify(record, null, 2));
  console.log(`record    : ${out}`);
}

async function main(): Promise<number> {
  const dry = flag('dry') !== null;
  const ratioArg = flag('ratio') ?? DEFAULT_IMAGE_ASPECT;
  if (!isImageAspect(ratioArg)) {
    console.error(`unknown ratio "${ratioArg}"`);
    return 2;
  }
  const aspect: ImageAspect = ratioArg;
  const photoPath = flag('photo') || DEFAULT_PHOTO;
  const prompt = flag('prompt') || DEFAULT_PROMPT;
  const config = geminiConfigFromEnv();
  const spec = IMAGE_ENGINES[ENGINE];
  const size = sizeString(imageSizeFor(ENGINE, aspect));
  const estimate = estimateImageUsd(ENGINE, 1);

  console.log(`GEMINI_API_KEY present: ${config !== null}`);
  console.log(`engine    : ${spec.label} (${config?.model ?? spec.model}) via Interactions API`);
  console.log(`size      : ${size} (${aspect}, 2K)`);
  console.log(`photo     : ${photoPath} (sent as the first image — a real person, on purpose)`);
  console.log(`estimate  : ≈ $${estimate.toFixed(4)} for one image`);

  const base = { engine: ENGINE, model: config?.model ?? spec.model, realPersonInput: true as const, photo: photoPath, aspect, size, estimatedUsd: estimate, at: new Date().toISOString() };
  const empty = { looksLikeFaceRefusal: null, status: null, interactionStatus: null, code: null, message: null, interactionId: null, savedTo: null, usage: null, usd: null, elapsedSeconds: null };

  const photo = { bytes: new Uint8Array(await readFile(resolve(photoPath))), mime: mimeOf(photoPath) };
  const input = { engine: ENGINE, prompt, aspect, references: [photo] };
  if (dry) {
    const body = toGeminiBody(input, config?.model ?? spec.model);
    const shown = { ...body, input: (body.input as Array<Record<string, unknown>>).map((item) => (typeof item.data === 'string' ? { ...item, data: `<base64 ${item.data.length} chars>` } : item)) };
    console.log('--dry: not calling. Request body:');
    console.log(JSON.stringify(shown, null, 2));
    await save({ ...base, ...empty, outcome: 'dry' });
    return 0;
  }
  if (!config) {
    console.log('skip: GEMINI_API_KEY is not set — nothing to call. The maker engine list stays as it is.');
    await save({ ...base, ...empty, outcome: 'skipped' });
    return 0;
  }

  const client = createGeminiImageClient(config);
  const started = Date.now();
  try {
    const result = await client.generate(input);
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`done in ${elapsed}s · ${result.mime} · usage ${JSON.stringify(result.usage)} · usd ${result.usd ?? '?'}`);
    const bytes = Buffer.from(result.b64, 'base64');
    await mkdir(resolve('tmp'), { recursive: true });
    const out = resolve(`tmp/gemini-smoke-${ENGINE}-${aspect.replace(':', 'x')}-${Date.now()}.${result.mime === 'image/png' ? 'png' : 'jpg'}`);
    await writeFile(out, bytes);
    console.log(`saved     : ${out} (${bytes.length} bytes)`);
    console.log('→ a real selfie was ACCEPTED as a reference. Look at the image before deciding anything about face fidelity.');
    await save({ ...base, ...empty, outcome: 'accepted', interactionId: result.interactionId, savedTo: out, usage: result.usage, usd: result.usd, elapsedSeconds: elapsed });
    return 0;
  } catch (error) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (error instanceof GeminiImageError) {
      console.error(`Gemini refused: HTTP ${error.status} ${error.code ?? ''} ${error.interactionStatus ?? ''} — ${error.message}`);
      if (error.moderated) console.error('→ safety / prohibited content: the photo or prompt was refused, not a transient failure');
      if (error.auth) console.error('→ check GEMINI_API_KEY (project, billing, model access)');
      await save({ ...base, ...empty, outcome: error.moderated ? 'refused' : 'failed', looksLikeFaceRefusal: error.moderated ? looksLikeFaceRefusal(error.message) : null, status: error.status, interactionStatus: error.interactionStatus, code: error.code, message: error.message, elapsedSeconds: elapsed });
      return 1;
    }
    console.error(error);
    await save({ ...base, ...empty, outcome: 'failed', message: error instanceof Error ? error.message : String(error), elapsedSeconds: elapsed });
    return 1;
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
