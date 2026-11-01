import { isGoogleEngine, isImageAspect, isImageEngine, isOpenAiEngine, isVideoAspect, isVideoEngine, type ImageAspect, type VideoAspect } from '@/lib/images/engines';
import type { RenderProvider } from '@/lib/renders/repo';
import { RenderFailure, runImageRender, startVideoRender, type EngineOutput, type RenderEngineDeps, type RenderPhoto, type StepReference } from '@/lib/renders/engines';
import { extensionFor, type RenderStore } from '@/lib/renders/store';
import { assetReference } from '@/lib/identity/service';
import { engineStepPrompt, identityPath, isMakerEngine, isStudioRecipeEngine, outputSteps, personInputs, SELFIE_SLOT, type Recipe, type RecipeStep } from './schema';
import type { RecipeState, StepRecord } from './repo';

/**
 * Runs a recipe's steps for one render job (docs/PLATFORM-2.0.md §7.3), reusing the engine adapters
 * the single-prompt path uses — no second engine client, no second failure vocabulary.
 *
 *   · image steps finish here, in order; each result is stored privately as `{job}/step-{id}.{ext}`
 *     and recorded, so a retry (or the pass after a face-asset wait) resumes after the done steps;
 *   · a film step is always last: it is handed to ModelArk and the pass's poll finishes the job;
 *   · references keep the step's `inputs` order — the same order `engineStepPrompt` numbers.
 *
 * How a reference reaches the engine: OpenAI, Gemini, Kling and Seedream take bytes (photo, maker file,
 * earlier result; `identityPath` = 'bytes'). Seedance takes the customer's face — the selfie OR an
 * earlier result made from it — only as an `asset://` from their verified group (`person()`), never as bytes;
 * a maker file goes as a short-lived private URL (or a data URL when the store serves none). Nothing
 * here bypasses the face check: a face that is still being compared parks the job (`wait`), a
 * refused one fails it, and the bytes providers run their own moderation on what they receive.
 *
 * Every failure carries the step id, recorded on the row as `code:step`.
 */

export type PersonReference = { kind: 'asset'; assetId: string } | { kind: 'wait'; assetId: string };
export interface MakerFile { key: string; mime: string; kind: 'image' | 'video'; bytes: Uint8Array }

export interface RecipeRunContext {
  jobId: string;
  recipe: Recipe;
  /** The buyer's aspect, applied to the result step(s) when it fits that kind; the recipe's own otherwise. */
  outputAspect: string;
  state: RecipeState;
  store: RenderStore;
  engines: RenderEngineDeps;
  /** The customer's photo as stored on the job (`{job}/input.*`). */
  selfie: (RenderPhoto & { key: string }) | null;
  /** A maker file by its `ast_…` handle (private bucket), or null when it is gone. */
  makerFile(handle: string): Promise<MakerFile | null>;
  /** The customer's face (selfie or a result made from it) as a verified-library asset. Throws RenderFailure on refusal. */
  person(photo: { bytes: Uint8Array; key: string }): Promise<PersonReference>;
  saveStep(stepId: string, record: StepRecord): Promise<void>;
  callbackUrl?: string;
}

export interface RecipeResult { step: string; key: string; mime: string; bytes: number }
export type RecipeRun =
  | { kind: 'done'; results: RecipeResult[]; usd: number | null; assets: string[] }
  | { kind: 'handed'; step: string; taskId: string; provider: RenderProvider; seconds: number; usd: number | null; assets: string[] }
  | { kind: 'wait'; assetId: string };

const FILE_URL_TTL_SECONDS = 30 * 60;

function photoMime(mime: string): RenderPhoto['mime'] {
  return mime === 'image/png' || mime === 'image/webp' ? mime : 'image/jpeg';
}
function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
function addUsd(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 10000) / 10000;
}

/** Sum of the recorded steps' provider cost (the pass adds the film's when the poll finishes it). */
export function recordedUsd(state: RecipeState): number | null {
  return Object.values(state.steps ?? {}).reduce<number | null>((sum, record) => addUsd(sum, record.usd), null);
}

function tagged(error: unknown, step: string): RenderFailure {
  const failure = error instanceof RenderFailure ? error : new RenderFailure('engine_error', error instanceof Error ? error.message : String(error), false);
  return new RenderFailure(failure.code, `[${step}] ${failure.message}`, failure.retryable, step);
}

export async function runRecipe(ctx: RecipeRunContext): Promise<RecipeRun> {
  const { recipe } = ctx;
  const person = personInputs(recipe);
  const shown = new Set(outputSteps(recipe));
  const records: Record<string, StepRecord> = { ...(ctx.state.steps ?? {}) };
  const assets: string[] = [];
  let usd = recordedUsd(ctx.state);

  for (const step of recipe.steps) {
    if (records[step.id]) continue;
    try {
      if (!isMakerEngine(step.engine) && !isStudioRecipeEngine(step.engine)) throw new RenderFailure('engine_error', `engine ${step.engine} is not a recipe engine`, false);
      const inputs = await gather(ctx, step, records);
      const viaAsset = identityPath(step.engine) === 'asset';
      const prompt = engineStepPrompt(recipe, step);

      if (step.kind === 'image') {
        if (!isImageEngine(step.engine)) throw new RenderFailure('engine_error', `unknown image engine ${step.engine}`, false);
        const references: StepReference[] = [];
        for (const input of inputs) {
          if (person.has(input.name) && viaAsset) {
            const ref = await ctx.person({ bytes: input.bytes, key: input.key });
            if (ref.kind === 'wait') return { kind: 'wait', assetId: ref.assetId };
            assets.push(ref.assetId);
            references.push({ kind: 'url', url: assetReference(ref.assetId) });
          } else references.push({ kind: 'bytes', bytes: input.bytes, mime: photoMime(input.mime) });
        }
        const aspect: ImageAspect = shown.has(step.id) && isImageAspect(ctx.outputAspect) ? ctx.outputAspect : step.params.aspect;
        const lead = (isOpenAiEngine(step.engine) || isGoogleEngine(step.engine)) && references.length > 1 ? 'The reference images are numbered in the order given: Image 1 is the first.\n\n' : '';
        const output: EngineOutput = await runImageRender({ engine: step.engine, prompt: `${lead}${prompt}`, aspect, photo: null, assetId: null, references }, ctx.engines);
        const key = `${ctx.jobId}/step-${step.id.replace(/_/g, '-')}.${extensionFor(output.mime)}`;
        await ctx.store.put(key, output.bytes, output.mime);
        const record: StepRecord = { key, mime: output.mime, bytes: output.bytes.byteLength, usd: output.costUsd };
        await ctx.saveStep(step.id, record);
        records[step.id] = record;
        usd = addUsd(usd, output.costUsd);
        continue;
      }

      if (!isVideoEngine(step.engine)) throw new RenderFailure('engine_error', `unknown video engine ${step.engine}`, false);
      const references: Array<{ type: 'image' | 'video'; url: string }> = [];
      for (const input of inputs) {
        if (person.has(input.name) && viaAsset) {
          const ref = await ctx.person({ bytes: input.bytes, key: input.key });
          if (ref.kind === 'wait') return { kind: 'wait', assetId: ref.assetId };
          assets.push(ref.assetId);
          references.push({ type: 'image', url: assetReference(ref.assetId) });
          continue;
        }
        if (person.has(input.name)) {
          // A bytes provider (Kling): the face goes as the bytes themselves, never a storage URL.
          references.push({ type: 'image', url: dataUrl(input.bytes, input.mime) });
          continue;
        }
        const url = await ctx.store.url(input.key, FILE_URL_TTL_SECONDS);
        if (input.kind === 'video') {
          if (url === null) throw new RenderFailure('engine_error', 'a reference film needs a storage URL the provider can fetch', false);
          references.push({ type: 'video', url });
        } else references.push({ type: 'image', url: url ?? dataUrl(input.bytes, input.mime) });
      }
      const aspect: VideoAspect = shown.has(step.id) && isVideoAspect(ctx.outputAspect) ? ctx.outputAspect : step.params.aspect;
      const started = await startVideoRender({
        engine: step.engine, prompt, aspect, seconds: step.params.duration, photo: null, assetId: null,
        references, resolution: step.params.resolution, ...(ctx.callbackUrl ? { callbackUrl: ctx.callbackUrl } : {}),
      }, ctx.engines);
      return { kind: 'handed', step: step.id, taskId: started.taskId, provider: started.provider, seconds: started.seconds, usd, assets };
    } catch (error) {
      throw tagged(error, step.id);
    }
  }

  const results = outputSteps(recipe).map((id) => {
    const record = records[id];
    if (!record) throw new RenderFailure('bad_output', `[${id}] the step left no result`, false, id);
    return { step: id, key: record.key, mime: record.mime, bytes: record.bytes };
  });
  return { kind: 'done', results, usd, assets };
}

interface GatheredInput { name: string; key: string; mime: string; kind: 'image' | 'video'; bytes: Uint8Array }

async function gather(ctx: RecipeRunContext, step: RecipeStep, records: Record<string, StepRecord>): Promise<GatheredInput[]> {
  const inputs: GatheredInput[] = [];
  for (const name of step.inputs) {
    if (name === SELFIE_SLOT) {
      if (!ctx.selfie) throw new RenderFailure('identity_required', 'the job has no photo', false);
      inputs.push({ name, key: ctx.selfie.key, mime: ctx.selfie.mime, kind: 'image', bytes: ctx.selfie.bytes });
      continue;
    }
    const slot = ctx.recipe.slots[name];
    if (slot?.source === 'creator') {
      const file = await ctx.makerFile(slot.asset);
      if (!file || file.kind !== slot.kind) throw new RenderFailure('engine_error', `maker file ${slot.asset} is missing`, false);
      inputs.push({ name, key: file.key, mime: file.mime, kind: file.kind, bytes: file.bytes });
      continue;
    }
    const record = records[name];
    if (!record) throw new RenderFailure('engine_error', `step ${name} has not run`, false);
    inputs.push({ name, key: record.key, mime: record.mime, kind: 'image', bytes: await ctx.store.read(record.key) });
  }
  return inputs;
}
