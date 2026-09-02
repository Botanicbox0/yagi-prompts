import { config as loadEnv } from 'dotenv';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  ArkError,
  arkConfigFromEnv,
  createArkClient,
  isInputRejection,
  isTerminal,
} from '@/lib/ark/client';
import { ARK_MODELS, estimateRenderUsd, isArkModelKey, type ArkModelKey, type ArkResolution } from '@/lib/ark/models';

/**
 * `npm run ark:smoke` — the FIRST live call to ModelArk, and the cheapest one that proves the
 * whole path: auth → create task → poll → video_url → download.
 *
 * It spends real money (≈ $0.35 for the default: Seedance 2.0, 480p, 5 s, text only), so it says
 * what it will cost, does one task, and stops. `--dry` prints the request body and exits without
 * calling anything — the way to check the key is loaded and the body is shaped before paying.
 *
 * Reads `.env.local` first, like `cloud-smoke.ts` — that is where this repo keeps real credentials.
 * The key is never printed; its presence is reported as a boolean.
 *
 * Usage:
 *   npm run ark:smoke -- --dry
 *   npm run ark:smoke
 *   npm run ark:smoke -- --model seedance-2.0-mini --resolution 480p --seconds 5
 *   npm run ark:smoke -- --prompt "…"
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

const DEFAULT_PROMPT =
  'A quiet 1994 Seoul side street at dusk, shot on a Betacam news camera: a neon sign flickers, ' +
  'a bus passes, rain on the pavement. Static tripod shot, no people, archival broadcast look.';

async function main(): Promise<number> {
  const dry = flag('dry') !== null;
  const modelArg = flag('model') ?? 'seedance-2.0';
  if (!isArkModelKey(modelArg)) {
    console.error(`unknown model "${modelArg}" — one of ${Object.keys(ARK_MODELS).join(', ')}`);
    return 2;
  }
  const model: ArkModelKey = modelArg;
  const resolution = (flag('resolution') ?? '480p') as ArkResolution;
  const seconds = Number.parseInt(flag('seconds') ?? '5', 10);
  const prompt = flag('prompt') || DEFAULT_PROMPT;

  const estimate = estimateRenderUsd({ model, resolution, seconds });
  if (!estimate.ok) {
    console.error(`refusing: ${estimate.problem} for ${model} @ ${resolution}, ${seconds}s`);
    return 2;
  }

  const config = arkConfigFromEnv();
  console.log(`ARK_API_KEY present: ${config !== null}`);
  console.log(`model: ${model} (${ARK_MODELS[model].id})  ${resolution}  ${seconds}s  16:9  audio:on`);
  console.log(`estimated cost: $${estimate.usd.toFixed(2)} (billed only if the task succeeds)`);

  const input = {
    model,
    content: [{ type: 'text' as const, text: prompt }],
    resolution,
    ratio: '16:9' as const,
    duration: seconds,
    generateAudio: true,
    watermark: false,
  };

  if (dry) {
    console.log('--dry: not calling. Request body:');
    console.log(JSON.stringify({ ...input, model: ARK_MODELS[model].id }, null, 2));
    return 0;
  }
  if (!config) {
    console.error('ARK_API_KEY is not set in .env.local — nothing to call.');
    return 2;
  }

  const client = createArkClient(config);
  const started = Date.now();
  let id: string;
  try {
    ({ id } = await client.createVideoTask(input));
  } catch (error) {
    return report(error);
  }
  console.log(`task created: ${id}`);

  // Poll. The docs suggest 30 s; 10 s costs nothing and shortens the wait on a 5-second clip.
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    let task;
    try {
      task = await client.getVideoTask(id);
    } catch (error) {
      if (error instanceof ArkError && error.retryable) {
        console.log(`  poll: ${error.code} (retryable), continuing`);
        continue;
      }
      return report(error);
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`  ${elapsed}s  status=${task.status}`);
    if (!isTerminal(task.status)) {
      if (elapsed > 15 * 60) {
        console.error('gave up after 15 minutes; the task may still finish — check the console.');
        return 1;
      }
      continue;
    }
    if (task.status !== 'succeeded' || !task.videoUrl) {
      console.error(`task ${task.status}: ${task.error?.code ?? '-'} ${task.error?.message ?? ''}`);
      if (isInputRejection(task.error?.code)) console.error('(input rejected by policy — not retryable)');
      return 1;
    }
    console.log(`succeeded. completion_tokens=${task.completionTokens ?? '?'}`);
    const url = new URL(task.videoUrl);
    console.log(`video_url host: ${url.host} (valid 24h)`);

    const outDir = resolve(process.cwd(), 'tmp');
    await mkdir(outDir, { recursive: true });
    const outPath = resolve(outDir, `ark-smoke-${id}.mp4`);
    const response = await fetch(task.videoUrl);
    if (!response.ok || !response.body) {
      console.error(`download failed: HTTP ${response.status}`);
      return 1;
    }
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(outPath));
    console.log(`downloaded: ${outPath}`);
    return 0;
  }
}

function report(error: unknown): number {
  if (error instanceof ArkError) {
    console.error(`ArkError ${error.code} (HTTP ${error.status}, retryable=${error.retryable}): ${error.message}`);
  } else {
    console.error(error);
  }
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
