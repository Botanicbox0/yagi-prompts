import { config as loadEnv } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DEFAULT_IMAGE_ASPECT,
  IMAGE_ENGINES,
  IMAGE_ENGINE_IDS,
  estimateImageUsd,
  imageSizeFor,
  isImageAspect,
  isImageEngine,
  isOpenAiEngine,
  sizeString,
  type GptImageQuality,
  type ImageAspect,
  type ImageEngineId,
} from '@/lib/images/engines';
import { OpenAiImageError, createOpenAiImageClient, openAiConfigFromEnv, toEditForm, toGenerationBody } from '@/lib/images/openai';
import { SeedreamError, createSeedreamClient, seedreamConfigFromEnv, toSeedreamBody } from '@/lib/images/seedream';

/**
 * `npm run image:smoke` — one live image render per engine, the cheapest call that proves the
 * whole path: key → request → image → file on disk. Spends real money (≈ $0.05 on Seedream,
 * ≈ $0.2–0.3 on GPT Image 2 at the mandatory `high` quality), says so first, does ONE image.
 *
 * `--dry` prints the request and exits without calling anything. `--photo <path>` sends a
 * reference photo: on GPT Image 2 that is the edits endpoint (the visitor's-face path); on
 * Seedream a real face is refused by policy, so pass an `asset://` id or a non-face image there.
 *
 * Reads `.env.local` first, like `ark-smoke.ts`. Keys are never printed.
 *
 * Usage:
 *   npm run image:smoke -- --engine seedream-5.0-pro --ratio 4:5
 *   npm run image:smoke -- --engine gpt-image-2.5-flare --ratio 4:5 --photo ./tmp/me.jpg
 *   npm run image:smoke -- --engine gpt-image-2.5-sunburst --ratio 4:5 --photo ./tmp/me.jpg --quality max   # measure a tier
 *   npm run image:smoke -- --engine gpt-image-2 --dry
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

const DEFAULT_PROMPT =
  'Editorial portrait template plate: an empty 1994 Seoul photo studio, seamless grey paper, ' +
  'one softbox from the left, a wooden stool, Betacam-era colour, no people, no text.';

function mimeOf(path: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function main(): Promise<number> {
  const dry = flag('dry') !== null;
  const engineArg = flag('engine') ?? 'seedream-5.0-pro';
  if (!isImageEngine(engineArg)) {
    console.error(`unknown engine "${engineArg}" — one of ${IMAGE_ENGINE_IDS.join(', ')}`);
    return 2;
  }
  const engine: ImageEngineId = engineArg;
  const qualityArg = flag('quality');
  const QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
  if (qualityArg !== null && !QUALITIES.includes(qualityArg)) {
    console.error(`unknown quality "${qualityArg}" — one of ${QUALITIES.join(', ')}`);
    return 2;
  }
  const quality = (qualityArg ?? undefined) as GptImageQuality | undefined;
  const ratioArg = flag('ratio') ?? DEFAULT_IMAGE_ASPECT;
  if (!isImageAspect(ratioArg)) {
    console.error(`unknown ratio "${ratioArg}"`);
    return 2;
  }
  const aspect: ImageAspect = ratioArg;
  const prompt = flag('prompt') || DEFAULT_PROMPT;
  const photoPath = flag('photo');
  const references = photoPath ? 1 : 0;
  const spec = IMAGE_ENGINES[engine];

  console.log(`engine    : ${spec.label} (${spec.model}) via ${spec.provider}`);
  console.log(`size      : ${sizeString(imageSizeFor(engine, aspect))} (${aspect})`);
  console.log(`estimate  : ≈ $${estimateImageUsd(engine, references).toFixed(3)} for one image`);
  console.log(`reference : ${photoPath ?? '(none — text to image)'}`);

  if (!isOpenAiEngine(engine)) {
    const config = seedreamConfigFromEnv();
    console.log(`ARK_API_KEY: ${config ? 'present' : 'MISSING'}`);
    const body = toSeedreamBody({ engine, prompt, aspect, references: photoPath ? [photoPath] : [] });
    if (dry || !config) {
      console.log(JSON.stringify(body, null, 2));
      return config ? 0 : 1;
    }
    const client = createSeedreamClient(config);
    const started = Date.now();
    try {
      const result = await client.generate({
        engine,
        prompt,
        aspect,
        references: photoPath ? [photoPath] : [],
        outputFormat: 'jpeg',
      });
      const image = result.images[0];
      console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s · size ${image?.size ?? '?'} · usage ${JSON.stringify(result.usage)}`);
      if (image?.url) {
        const bytes = new Uint8Array(await (await fetch(image.url)).arrayBuffer());
        const out = resolve(`tmp/image-smoke-${engine}-${aspect.replace(':', 'x')}-${Date.now()}.jpg`);
        await mkdir(resolve('tmp'), { recursive: true });
        await writeFile(out, bytes);
        console.log(`saved     : ${out} (${bytes.length} bytes)`);
      }
      return 0;
    } catch (error) {
      if (error instanceof SeedreamError) {
        console.error(`Seedream refused: ${error.code ?? error.status} — ${error.message}`);
        if (error.accessProblem) console.error('→ console: Model activation + API keys › edit permission (tick the Seedream models)');
        if (error.inputRejected) console.error('→ the reference contains a real face: use the asset library (asset://…)');
        return 1;
      }
      throw error;
    }
  }

  const config = openAiConfigFromEnv();
  console.log(`OPENAI_API_KEY: ${config ? 'present' : 'MISSING'}`);
  console.log(`quality   : ${quality ?? spec.quality ?? 'high'}${quality ? ' (override — measurement only)' : ' (engine table)'}`);
  const photo = photoPath ? { bytes: new Uint8Array(await readFile(resolve(photoPath))), mime: mimeOf(photoPath) } : null;
  const request = { engine, prompt, aspect, ...(quality ? { quality } : {}) };
  if (dry || !config) {
    if (photo) {
      const form = toEditForm({ ...request, references: [photo] });
      console.log(JSON.stringify(Object.fromEntries([...form.entries()].map(([k, v]) => [k, v instanceof Blob ? `<${v.type} ${v.size} bytes>` : v])), null, 2));
    } else {
      console.log(JSON.stringify(toGenerationBody(request), null, 2));
    }
    return config ? 0 : 1;
  }
  const client = createOpenAiImageClient(config);
  const started = Date.now();
  try {
    const result = photo ? await client.edit({ ...request, references: [photo] }) : await client.generate(request);
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s · size ${result.size} · quality ${result.quality} · usage ${JSON.stringify(result.usage)} · usd ${result.usd ?? '?'}`);
    const bytes = Buffer.from(result.b64, 'base64');
    const out = resolve(`tmp/image-smoke-${engine}-${result.quality}-${aspect.replace(':', 'x')}-${Date.now()}.${result.outputFormat}`);
    await mkdir(resolve('tmp'), { recursive: true });
    await writeFile(out, bytes);
    console.log(`saved     : ${out} (${bytes.length} bytes)`);
    return 0;
  } catch (error) {
    if (error instanceof OpenAiImageError) {
      console.error(`OpenAI refused: ${error.status} ${error.code ?? ''} — ${error.message}`);
      if (error.moderated) console.error('→ content policy: the photo or prompt was refused, not a transient failure');
      if (error.auth) console.error('→ check OPENAI_API_KEY (organization, billing)');
      return 1;
    }
    throw error;
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
