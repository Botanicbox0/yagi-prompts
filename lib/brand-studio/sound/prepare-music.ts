/**
 * The prepare step of a music run (docs/BRAND-SOUND-STUDIO.md §12.2): the engine's `queued` step calls this once,
 * after the job is committed and before anything is sent, exactly where an image run gets its prompt designed
 * (../prepare.ts). It never fails a run: any problem is the deterministic design.
 *
 * Local mode without a text-model key (`BRAND_STUDIO_PROVIDER=fake`) uses a fixed local design instead of the
 * fallback, so a laptop can see the whole designed path without a paid call.
 */
import { studioGeminiConfig } from '../enhancer/gemini';
import { brandSummary } from '../prepare';
import type { JobRow, StudioDeps, StudioJobWork } from '../types';
import { designMeta, designMusic, MUSIC_PROFILE_VERSION, type MusicDesign, type MusicDesignInput } from './architect';
import { markLyrics, musicWay } from './lyrics';

export function musicDesignInputOf(job: Pick<JobRow, 'prompt' | 'params'>, brand: MusicDesignInput['brand'] = null): MusicDesignInput {
  const m = job.params.music!;
  return {
    prompt: job.prompt,
    vocal: m.vocal,
    lyrics: m.lyrics ?? '',
    careful: m.careful,
    structure: m.structure ?? null,
    video: m.video ?? null,
    words: m.words ?? null,
    language: m.language,
    locale: job.params.locale === 'en' ? 'en' : 'ko',
    brand,
  };
}

/** The fixed design local mode shows (never used with a real provider). */
export function localDesign(input: MusicDesignInput): MusicDesign {
  const mode = musicWay({ vocal: input.vocal, lyrics: input.lyrics, careful: input.careful });
  const words = input.prompt.replace(/\s+/g, ' ').trim().slice(0, 200);
  const voice = input.vocal
    ? `A warm, close ${input.language === 'ko' ? 'Korean' : 'English'} vocal sings in a relaxed, conversational way.`
    : 'Instrumental: a soft felt piano carries the melody.';
  const style =
    `Local design for: "${words}". Warm acoustic pop with a light, hopeful feel, around 96 BPM with a gentle swing. ${voice} ` +
    'Fingerpicked acoustic guitar keeps a steady pulse, a round upright bass walks under it, and brushed drums keep time softly. ' +
    'A short intro, the hook arrives early and returns once. Warm and close, with a little room. Ends cleanly on a held chord.';
  return {
    mode,
    style,
    title: input.locale === 'ko' ? '맑은 하루' : 'Clear Day',
    lyrics: markLyrics(input.vocal ? input.lyrics : '', input.structure ?? null),
    notes: input.locale === 'ko' ? '로컬 설계 예시예요. 실제 설계는 운영 환경에서 만들어져요.' : 'A local design example; the real design is made in production.',
    source: 'model',
    profileVersion: MUSIC_PROFILE_VERSION,
    llmModel: 'local',
  };
}

/** Designs a music run and returns what the job keeps: the sent paragraph and the design record. */
export async function designForDeps(deps: Pick<StudioDeps, 'env' | 'intelDeps' | 'log'>, input: MusicDesignInput): Promise<MusicDesign> {
  if (deps.env.provider === 'fake' && !studioGeminiConfig(deps.intelDeps.env)) return localDesign(input);
  return designMusic(input, { fetch: deps.intelDeps.fetch, env: deps.intelDeps.env, log: deps.log });
}

export async function prepareMusic(deps: StudioDeps, job: JobRow): Promise<{ finalPrompt: string; work: StudioJobWork }> {
  const org = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
  const brand = await brandSummary(deps, job.organization_id, org?.name ?? '');
  const design = await designForDeps(deps, musicDesignInputOf(job, brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null));
  return { finalPrompt: design.style, work: { ...job.work, prepared: true, enhancer: designMeta(design) } };
}
