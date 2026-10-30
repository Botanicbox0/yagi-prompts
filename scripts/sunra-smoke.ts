import { config as loadEnv } from 'dotenv';
import { SunraError, createSunraClient, isSunraTerminal, sunraConfigFromEnv } from '@/lib/sunra/client';

/**
 * `npm run sunra:smoke` — one text-only image on Sunra, the cheapest documented queue call
 * (Seedream 5.0 Pro at 1K, list $0.045). No photo is sent: the prompt names no person. Exercises
 * key, queue, status, result and the billing units. `--dry` prints the request; no `SUNRA_API_KEY`
 * prints `skip`. The key is never printed, and an empty balance stops here: nothing tops it up.
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const ENDPOINT = 'bytedance/seedream-5.0-pro/text-to-image';
const INPUT = { prompt: 'A blue ceramic cup on a white table, soft daylight, product photograph.', aspect_ratio: '1:1', resolution: '1K', output_format: 'jpeg' };

async function main(): Promise<number> {
  const config = sunraConfigFromEnv();
  console.log(`SUNRA_API_KEY present: ${config !== null}`);
  console.log(`request: POST /v1/queue/${ENDPOINT} ${JSON.stringify(INPUT)}`);
  console.log('estimate: $0.045');
  if (process.argv.includes('--dry')) return 0;
  if (!config) {
    console.log('skip: SUNRA_API_KEY is not set.');
    return 0;
  }
  const client = createSunraClient(config);
  const started = Date.now();
  try {
    const { id } = await client.submit(ENDPOINT, INPUT);
    console.log(`task created: ${id}`);
    while (Date.now() - started < 5 * 60_000) {
      await new Promise((r) => setTimeout(r, 3_000));
      const task = await client.getTask(id);
      console.log(`  ${Math.round((Date.now() - started) / 1000)}s status=${task.status}`);
      if (!isSunraTerminal(task.status)) continue;
      console.log(`success=${task.success} code=${task.errorCode ?? '-'} message=${task.errorMessage ?? '-'}`);
      console.log(`billedUsd=${task.billedUsd ?? '(not reported)'} resultHost=${task.url ? new URL(task.url).host : '-'}`);
      return task.success && task.url ? 0 : 1;
    }
    console.error('gave up after 5 minutes');
    return 1;
  } catch (error) {
    if (error instanceof SunraError) {
      console.error(`SunraError ${error.code} (HTTP ${error.status}): ${error.message}`);
      if (error.accessProblem) console.error('→ key or balance: console work. Do not top up without the founder.');
      return 1;
    }
    throw error;
  }
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 1; });
