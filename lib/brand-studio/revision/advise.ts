/**
 * `revise.plan`: what a new version of a clip would be, without spending anything. Which ways are open
 * (`edit`, `reshoot`) and what each would use from the allowance; with a request, which way fits it.
 *
 * Free like `prompt.enhance`: same seat, role and allowance>0 checks, its own per-organization rate cap.
 * The fit is one small Gemini JSON call that only classifies the request into `STUDIO_REVISE_REASONS`;
 * nothing the model writes reaches the customer. Any failure means "no reason": edit when it is open.
 */
import type { Viewer } from '@/lib/auth/identity';
import {
  RevisePlanSchema,
  STUDIO_REVISE_REASONS,
  type StudioFailure,
  type StudioReviseMode,
  type StudioReviseReason,
  type StudioRevisePlan,
} from '../contracts';
import { requireCreate, studioSeat, StudioDenied } from '../access';
import { callGeminiJson, studioGeminiConfig } from '../enhancer/gemini';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { failure, guarded } from '../outcome';
import type { IntelDeps, StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import { loadRevisionRecipe } from './recipe';
import { editWay, resolveAdded, reshootWay, type WayOutcome } from './plan';

const CLASSIFY_TIMEOUT_MS = 12_000;
const MADE_WITH_MAX = 1500;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: { reason: { type: 'string', enum: [...STUDIO_REVISE_REASONS] } },
  required: ['reason'],
} as const;

const CLASSIFY_SYSTEM = `You sort one change request for an AI-generated video clip into exactly one category.
"request" is what the customer wants changed in the clip. "madeWith" is the prompt the clip was generated from. "history" lists earlier changes, oldest first.
Categories:
- surface: how something looks while the motion stays the same: the subject's or product's appearance, colour, material, label, clothing, background, on-screen text, adding or removing an object, the tone or colour of the light.
- motion: how things move: the camera path or camera move, the action, choreography, gestures, speed or pacing.
- structure: how the clip is built: the order of shots, framing or composition, the number of shots or cuts, what each shot shows.
- length: making the clip longer or shorter.
When a request mixes categories, pick the one that most changes how the clip has to be made: length, then structure, then motion, then surface.
Answer with JSON {"reason": "<category>"} only.`;

/** The category of a request, or null when it could not be read (no key, timeout, an unexpected answer). */
export async function classifyRevision(
  deps: IntelDeps,
  input: { request: string; madeWith: string; history: string[] },
): Promise<StudioReviseReason | null> {
  const config = studioGeminiConfig(deps.env);
  if (!config) return null;
  try {
    const raw = await callGeminiJson(config, deps.fetch, {
      system: CLASSIFY_SYSTEM,
      parts: [{ text: JSON.stringify({ request: input.request, madeWith: input.madeWith.slice(0, MADE_WITH_MAX), history: input.history }) }],
      schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
      thinking: 'LOW',
      timeoutMs: CLASSIFY_TIMEOUT_MS,
    });
    const reason = (raw as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' && (STUDIO_REVISE_REASONS as readonly string[]).includes(reason) ? (reason as StudioReviseReason) : null;
  } catch {
    return null;
  }
}

const wayFor = (reason: StudioReviseReason): StudioReviseMode => (reason === 'surface' ? 'edit' : 'reshoot');

function method(way: WayOutcome): StudioRevisePlan['methods'][StudioReviseMode] {
  return way.ok ? { available: true, estimateKrw: way.plan.estimateKrw } : { available: false, estimateKrw: 0, problem: way.problem };
}

export async function planStudioRevise(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioRevisePlan | StudioFailure> {
  const parsed = RevisePlanSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const now = deps.now?.() ?? new Date();
  const ready = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      if (!takeFreeIntelSlot(`revise:${v.organizationId}`, FREE_INTEL_LIMITS.revisePerMinute, now.getTime())) {
        throw new StudioDenied('too_many_running');
      }
      const recipe = await loadRevisionRecipe(sql, v.organizationId, v.outputId);
      await resolveAdded(sql, v.organizationId, v.references, deps.media, locale);
      const request = { prompt: v.prompt, references: [...v.references] };
      const edit = await editWay(sql, v.organizationId, recipe, { ...request, mode: 'edit' }, deps.media, locale);
      const reshoot = await reshootWay(sql, v.organizationId, recipe, { ...request, mode: 'reshoot' }, deps.media, locale);
      if (!edit.ok && !reshoot.ok) throw new StudioDenied('invalid');
      return { recipe, edit, reshoot };
    }),
  );
  if ('ok' in ready) return ready;
  const { recipe, edit, reshoot } = ready;
  const fallback: StudioReviseMode = edit.ok ? 'edit' : 'reshoot';
  let recommended: StudioReviseMode | null = null;
  let reason: StudioReviseReason | null = null;
  if (v.prompt) {
    reason = await classifyRevision(deps.intelDeps, {
      request: v.prompt,
      madeWith: recipe.madeWith,
      history: recipe.history.map((h) => h.request),
    });
    const fits = reason ? wayFor(reason) : fallback;
    recommended = (fits === 'edit' ? edit.ok : reshoot.ok) ? fits : fallback;
  } else {
    recommended = fallback;
  }
  return {
    ok: true,
    version: recipe.nextVersion,
    methods: { edit: method(edit), reshoot: method(reshoot) },
    recommended,
    reason,
  };
}
