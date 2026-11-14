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
  isGoogleEngine,
  isImageEngine,
  isOpenAiEngine,
  sizeString,
  type GptImageQuality,
  type ImageAspect,
  type ImageEngineId,
} from '@/lib/images/engines';
import { OpenAiImageError, createOpenAiImageClient, openAiConfigFromEnv, toEditForm, toGenerationBody } from '@/lib/images/openai';
import { SeedreamError, createSeedreamClient, seedreamConfigFromEnv, toSeedreamBody, type SeedreamGenerateInput } from '@/lib/images/seedream';
import { SELFIE_SLOT, engineStepPrompt, parseRecipe } from '@/lib/recipes/schema';

/**
 * `npm run image:smoke` — one live image render per engine, the cheapest call that proves the
 * whole path: key → request → image → file on disk. Spends real money (≈ $0.05 on Seedream,
 * ≈ $0.2–0.3 on GPT Image 2 at the mandatory `high` quality), says so first, does ONE image.
 *
 * `--dry` prints the request and exits without calling anything. `--photo <path>` sends a
 * reference photo the way a customer's selfie travels: on GPT Image the edits endpoint, on Seedream
 * the photo's own bytes as a base64 data URL (its API refuses `asset://`). This is the real-selfie
 * smoke for Seedream: whether its moderation lets the person's face through
 * (`InputImageSensitiveContentDetected` = no) and whether the face survives is what decides if a
 * Seedream face template may go on sale. Use only a photo of someone who agreed to it — your own.
 *
 * `--manifest <twings_templates_manifest.json> --frame <n>` takes the prompt of the manifest's Nth
 * frame and sends exactly what the recipe path sends for it (`engineStepPrompt`: the manifest text,
 * then the standard identity line), so one paid image measures the template as sold.
 *
 * Reads `.env.local` first, like `ark-smoke.ts`. Keys are never printed.
 *
 * Usage:
 *   npm run image:smoke -- --engine seedream-5.5 --ratio 4:5
 *   npm run image:smoke -- --engine seedream-5.5 --ratio 3:4 --photo ./tmp/me.jpg --manifest <manifest.json> --frame 2
 *   npm run image:smoke -- --engine seedream-5.5 --ratio 1:1 --resolution 2K --background transparent
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

/**
 * The prompt the render pass sends for a manifest frame: the manifest names the customer's photo
 * "Image 1", the recipe stores it as `{{selfie}}`, and `engineStepPrompt` turns it back and adds the
 * identity line — run through the same code so the smoke cannot drift from the product.
 */
async function manifestPrompt(path: string, frame: number, engine: ImageEngineId, aspect: ImageAspect): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(resolve(path), 'utf8'));
  const entries = Array.isArray(raw) ? raw : [];
  const entry = entries[frame - 1] as { prompt?: unknown } | undefined;
  if (typeof entry?.prompt !== 'string') throw new Error(`the manifest has no frame ${frame} (it has ${entries.length})`);
  const checked = parseRecipe({
    version: 2,
    slots: { [SELFIE_SLOT]: { kind: 'image', source: 'user', required: true } },
    steps: [{ id: 'shot', kind: 'image', engine, inputs: [SELFIE_SLOT], prompt: entry.prompt.replace(/\bImage 1\b/g, `{{${SELFIE_SLOT}}}`), params: { aspect } }],
    output: { from: 'shot' },
  });
  if (!checked.ok) throw new Error(`frame ${frame} is not a recipe step: ${JSON.stringify(checked.issues)}`);
  return engineStepPrompt(checked.recipe, checked.recipe.steps[0]!);
}

/** A request body fit to print: a base64 photo becomes its size, never the bytes. */
function printable(body: unknown): string {
  return JSON.stringify(body, (_key, value) => (typeof value === 'string' && value.startsWith('data:') ? `<${value.slice(5, value.indexOf(';'))} base64, ${value.length} chars>` : value), 2);
}

async function main(): Promise<number> {
  const dry = flag('dry') !== null;
  const engineArg = flag('engine') ?? 'seedream-5.5';
  if (!isImageEngine(engineArg)) {
    console.error(`unknown engine "${engineArg}" — one of ${IMAGE_ENGINE_IDS.join(', ')}`);
    return 2;
  }
  const engine: ImageEngineId = engineArg;
  const resolutionArg = flag('resolution');
  const RESOLUTIONS = ['1K', '1.5K', '2K'] as const;
  if (resolutionArg !== null && !RESOLUTIONS.includes(resolutionArg as (typeof RESOLUTIONS)[number])) {
    console.error(`unknown resolution "${resolutionArg}" — one of ${RESOLUTIONS.join(', ')}`);
    return 2;
  }
  const resolution = (resolutionArg ?? undefined) as (typeof RESOLUTIONS)[number] | undefined;
  const backgroundArg = flag('background');
  const BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
  if (backgroundArg !== null && !BACKGROUNDS.includes(backgroundArg as (typeof BACKGROUNDS)[number])) {
    console.error(`unknown background "${backgroundArg}" — one of ${BACKGROUNDS.join(', ')}`);
    return 2;
  }
  const background = (backgroundArg ?? undefined) as (typeof BACKGROUNDS)[number] | undefined;
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
  const manifestPath = flag('manifest');
  const frame = Number(flag('frame') ?? '1');
  if (manifestPath !== null && (!Number.isInteger(frame) || frame < 1)) {
    console.error('--frame is the manifest frame number, from 1');
    return 2;
  }
  const prompt = manifestPath ? await manifestPrompt(manifestPath, frame, engine, aspect) : flag('prompt') || DEFAULT_PROMPT;
  const photoPath = flag('photo');
  const references = photoPath ? 1 : 0;
  const spec = IMAGE_ENGINES[engine];

  console.log(`engine    : ${spec.label} (${spec.model}) via ${spec.provider}`);
  console.log(`size      : ${sizeString(imageSizeFor(engine, aspect, resolution))} (${aspect}${resolution ? `, ${resolution}` : ''})`);
  console.log(`estimate  : ≈ $${estimateImageUsd(engine, references, resolution).toFixed(3)} for one image`);
  console.log(`reference : ${photoPath ?? '(none — text to image)'}`);
  if (manifestPath) console.log(`prompt    : manifest frame ${frame}, as the recipe path sends it (${prompt.length} chars)`);

  if (isGoogleEngine(engine)) {
    console.error('the Gemini engine has its own real-person smoke: npm run gemini:smoke');
    return 2;
  }

  if (!isOpenAiEngine(engine)) {
    const config = seedreamConfigFromEnv();
    console.log(`ARK_API_KEY: ${config ? 'present' : 'MISSING'}`);
    // The render pass's request, field for field: the photo's bytes as a data URL, PNG when transparent else JPEG.
    const references = photoPath ? [`data:${mimeOf(photoPath)};base64,${(await readFile(resolve(photoPath))).toString('base64')}`] : [];
    const outputFormat = background === 'transparent' ? 'png' : 'jpeg';
    const request: SeedreamGenerateInput = {
      engine,
      prompt,
      aspect,
      references,
      resolution,
      background,
      outputFormat,
      responseFormat: 'b64_json',
    };
    if (dry || !config) {
      console.log(printable(toSeedreamBody(request)));
      return config ? 0 : 1;
    }
    const client = createSeedreamClient(config);
    const started = Date.now();
    try {
      const result = await client.generate(request);
      const image = result.images[0];
      console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s · size ${image?.size ?? '?'} · usage ${JSON.stringify(result.usage)}`);
      const bytes = image?.b64 ? new Uint8Array(Buffer.from(image.b64, 'base64')) : image?.url ? new Uint8Array(await (await fetch(image.url)).arrayBuffer()) : null;
      if (bytes) {
        const ext = outputFormat === 'png' ? 'png' : 'jpg';
        const out = resolve(`tmp/image-smoke-${engine}-${aspect.replace(':', 'x')}${manifestPath ? `-frame${frame}` : ''}-${Date.now()}.${ext}`);
        await mkdir(resolve('tmp'), { recursive: true });
        await writeFile(out, bytes);
        console.log(`saved     : ${out} (${bytes.length} bytes)`);
        if (photoPath) console.log('→ the face went through: compare it with the photo before anything goes on sale');
      }
      return 0;
    } catch (error) {
      if (error instanceof SeedreamError) {
        console.error(`Seedream refused: ${error.code ?? error.status} — ${error.message}`);
        if (error.accessProblem) console.error('→ console: Model activation + API keys › edit permission (tick the Seedream models)');
        if (error.inputRejected) console.error('→ Seedream\'s moderation refused the face in the photo: a customer selfie cannot reach this engine, so its face templates stay off sale');
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
