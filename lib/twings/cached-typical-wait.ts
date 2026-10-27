import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { TYPICAL_WAIT_DEFAULT_MINUTES, typicalWaitMinutes, type TypicalWaitInput } from './typical-wait';

/**
 * The template page is static (tag `prompts`, 1h TTL), so "보통 N분" is computed with it: at build
 * time and again whenever the page revalidates. Same tag and TTL as the page, so a catalogue edit
 * that refreshes the page refreshes the number too.
 */
const cached = unstable_cache(
  async (engine: string, medium: TypicalWaitInput['medium'], seconds: number | null) =>
    typicalWaitMinutes(await getSqlRunner(), { engine, medium, seconds }),
  ['typical-wait-v1', resolveRuntimeMode()],
  { tags: ['prompts'], revalidate: 3600 },
);

export async function cachedTypicalWaitMinutes(input: TypicalWaitInput): Promise<number> {
  try {
    return await cached(input.engine, input.medium, input.seconds);
  } catch {
    // Outside a Next request (unit tests, a script) there is no cache to ask: the default is the answer.
    return TYPICAL_WAIT_DEFAULT_MINUTES[input.medium];
  }
}
