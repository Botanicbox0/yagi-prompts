/**
 * `revise.plan`: what a new version of a clip would be, without spending anything. Which ways are open
 * (`edit`, `reshoot`) and what each would use from the allowance; with a request, which way fits it.
 *
 * Free like `prompt.enhance`: same seat, role and allowance>0 checks, its own per-organization rate cap.
 * The fit is one small Gemini JSON call that classifies the request into `STUDIO_REVISE_REASONS` and, in
 * the same call, says whether the request reads two ways (docs/BRAND-STUDIO-V6-PLAN.md §4.6). Only then
 * does model text reach the customer: one cleaned question with 2–3 choices. Any failure means no reason
 * and no question: edit when it is open, and the run goes ahead as written.
 */
import type { Viewer } from '@/lib/auth/identity';
import {
  RevisePlanSchema,
  STUDIO_REVISE_CLARIFY,
  STUDIO_REVISE_REASONS,
  type ReviseMark,
  type StudioFailure,
  type StudioReviseMode,
  type StudioReviseReason,
  type StudioRevisePlan,
} from '../contracts';
import { requireCreate, studioSeat, StudioDenied } from '../access';
import { callGeminiJson, studioGeminiConfig } from '../enhancer/gemini';
import { replaceMarks } from '../enhancer/marks';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { failure, guarded } from '../outcome';
import type { IntelDeps, StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import { withClarified } from './clarify';
import { loadRevisionRecipe } from './recipe';
import { editWay, requireMarksBehind, resolveAdded, reshootWay, type WayOutcome } from './plan';

const CLASSIFY_TIMEOUT_MS = 12_000;
const MADE_WITH_MAX = 1500;

/** Kinds of doubt worth one question; `none` is the answer almost always. */
const AMBIGUITIES = ['none', 'which_thing', 'direction_or_amount', 'which_reference', 'contradiction'] as const;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: { reason: { type: 'string', enum: [...STUDIO_REVISE_REASONS] } },
  required: ['reason'],
} as const;

const CLARIFY_SCHEMA = {
  type: 'object',
  properties: {
    reason: { type: 'string', enum: [...STUDIO_REVISE_REASONS] },
    ambiguity: { type: 'string', enum: [...AMBIGUITIES] },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
  },
  required: ['reason', 'ambiguity'],
} as const;

const CATEGORIES = `"request" is what the customer wants changed in the clip. "madeWith" is the prompt the clip was generated from. "history" lists earlier changes, oldest first.
Categories:
- surface: how something looks while the motion stays the same: the subject's or product's appearance, colour, material, label, clothing, background, on-screen text, adding or removing an object, the tone or colour of the light.
- motion: how things move: the camera path or camera move, the action, choreography, gestures, speed or pacing.
- structure: how the clip is built: the order of shots, framing or composition, the number of shots or cuts, what each shot shows.
- length: making the clip longer or shorter.
When a request mixes categories, pick the one that most changes how the clip has to be made: length, then structure, then motion, then surface.`;

const CLASSIFY_SYSTEM = `You sort one change request for an AI-generated video clip into exactly one category.
${CATEGORIES}
Answer with JSON {"reason": "<category>"} only.`;

/**
 * The same reading, plus whether the request needs one question back. The bar is high on purpose: a
 * question costs the customer a stop, so it is asked only when two readings would give visibly different
 * videos and nothing sent with the request decides between them.
 */
const CLARIFY_SYSTEM = `You read one change request for an AI-generated video clip. Do two things.
1. Sort it into exactly one category ("reason").
${CATEGORIES}
2. Decide whether the request is ambiguous ("ambiguity"). Almost every request is not: answer "none" unless one of these is plainly true.
- which_thing: the request changes "it", "that", "the one", "this" or a noun that matches two or more different things that "madeWith" shows (two bottles, two people, two signs), and nothing says which.
- direction_or_amount: the request asks for a change whose direction is missing and the possible directions give opposite pictures ("move it", "change the angle", "fix the light" with no hint of how).
- which_reference: "references" is 2 or more and the request says "the picture", "the reference", "this image" without a number, and the pictures would be used differently.
- contradiction: two parts of the request cannot both be done ("keep everything exactly the same but make it night").
It is NOT ambiguous, so answer "none", when:
- the request is short but has one natural reading ("bluer", "slower", "remove the text", "make it night");
- it is about taste or degree that any reasonable result satisfies ("prettier", "a bit warmer", "more premium");
- the thing is named by a mark: text in square brackets starting "marked on the clip:" is a spot the customer pointed at, and it identifies exactly one thing;
- a picture is named by its number ("image 1", "이미지 2", "1번 사진"), or only one picture is attached;
- "madeWith" shows only one thing that fits, or "history" already settles it;
- the question would be about how the clip is made (editing or shooting again), its cost, or its length limits: the studio decides those itself.
When in doubt, answer "none".
When the ambiguity is not "none", also write "question": one short question to the customer, at most 120 characters, and "options": 2 or 3 short answers (each at most 40 characters) that are the real different readings, written so each one alone says what to do. Write both in the same language as the request (Korean if the request is Korean). Name things the way the customer would see them in the clip. Never mention prompts, models, file names, credits, versions, marks or how the clip is made. Do not add an option like "as written" or "other".
When the ambiguity is "none", leave "question" and "options" out.
Answer with JSON only.`;

export interface RevisionReading {
  reason: StudioReviseReason | null;
  clarify: { question: string; options: string[] } | null;
}

const NO_READING: RevisionReading = { reason: null, clarify: null };

const oneLine = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** The model's question, kept only when it is the shape the screen can show: one line and 2–3 distinct choices. */
export function cleanClarify(raw: { ambiguity?: unknown; question?: unknown; options?: unknown } | null): RevisionReading['clarify'] {
  if (!raw || typeof raw.ambiguity !== 'string' || raw.ambiguity === 'none' || !(AMBIGUITIES as readonly string[]).includes(raw.ambiguity)) return null;
  const question = oneLine(raw.question);
  if (!question || question.length > STUDIO_REVISE_CLARIFY.questionMax) return null;
  if (!Array.isArray(raw.options)) return null;
  const options: string[] = [];
  for (const item of raw.options) {
    const option = oneLine(item);
    if (!option || option.length > STUDIO_REVISE_CLARIFY.optionMax) return null;
    if (options.some((o) => o.toLowerCase() === option.toLowerCase())) continue;
    options.push(option);
  }
  if (options.length < STUDIO_REVISE_CLARIFY.optionsMin) return null;
  return { question, options: options.slice(0, STUDIO_REVISE_CLARIFY.optionsMax) };
}

export interface ReadRevisionInput {
  request: string;
  madeWith: string;
  history: string[];
  /** Pictures attached to this request, numbered from 1. */
  references?: number;
  /** Videos attached to this request as material. */
  materials?: number;
  /**
   * Whether a question may come back. False once the customer answered (or had it made as written): the
   * answer then travels in `clarified` and the reading only sorts.
   */
  mayAsk?: boolean;
  clarified?: { question: string; answer: string } | null;
}

/** The category of a request and, when it may and must, one question about it. Any failure reads as nothing. */
export async function readRevision(deps: IntelDeps, input: ReadRevisionInput): Promise<RevisionReading> {
  const config = studioGeminiConfig(deps.env);
  if (!config) return NO_READING;
  const mayAsk = input.mayAsk === true;
  const body: Record<string, unknown> = { request: input.request, madeWith: input.madeWith.slice(0, MADE_WITH_MAX), history: input.history };
  if (mayAsk) {
    body.references = input.references ?? 0;
    body.materials = input.materials ?? 0;
  }
  if (input.clarified) body.customerMeant = input.clarified.answer;
  try {
    const raw = await callGeminiJson(config, deps.fetch, {
      system: mayAsk ? CLARIFY_SYSTEM : CLASSIFY_SYSTEM,
      parts: [{ text: JSON.stringify(body) }],
      schema: (mayAsk ? CLARIFY_SCHEMA : CLASSIFY_SCHEMA) as unknown as Record<string, unknown>,
      thinking: 'LOW',
      timeoutMs: CLASSIFY_TIMEOUT_MS,
    });
    const answer = (raw ?? null) as { reason?: unknown; ambiguity?: unknown; question?: unknown; options?: unknown } | null;
    const reason =
      typeof answer?.reason === 'string' && (STUDIO_REVISE_REASONS as readonly string[]).includes(answer.reason) ? (answer.reason as StudioReviseReason) : null;
    return { reason, clarify: mayAsk ? cleanClarify(answer) : null };
  } catch {
    return NO_READING;
  }
}

/** The category of a request, or null when it could not be read (no key, timeout, an unexpected answer). */
export async function classifyRevision(deps: IntelDeps, input: { request: string; madeWith: string; history: string[] }): Promise<StudioReviseReason | null> {
  return (await readRevision(deps, input)).reason;
}

/** A request as the reading sees it: each ①②③ written out and tagged as a spot the customer pointed at. */
export function markedForReading(request: string, marks: readonly ReviseMark[]): string {
  return replaceMarks(
    request,
    marks.map((m) => ({ what: `[marked on the clip: ${m.what?.trim() || m.label?.trim() || 'the marked spot'}]` })),
  );
}

const wayFor = (reason: StudioReviseReason): StudioReviseMode => (reason === 'surface' ? 'edit' : 'reshoot');

function method(way: WayOutcome): StudioRevisePlan['methods'][StudioReviseMode] {
  return way.ok ? { available: true, estimateKrw: way.plan.estimateKrw } : { available: false, estimateKrw: 0, problem: way.problem };
}

export async function planStudioRevise(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioRevisePlan | StudioFailure> {
  const parsed = RevisePlanSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  try {
    requireMarksBehind(v.prompt, v.marks);
  } catch {
    return failure('invalid');
  }
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
      const request = { prompt: v.prompt, references: [...v.references], marks: v.marks };
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
  let clarify: RevisionReading['clarify'] = null;
  if (v.prompt) {
    // The reading sees what each mark is on, never the ①②③ signs. It may ask one question only while
    // none was asked for this request; an answer (or "as written") from the screen ends that for good.
    const answered = v.clarified?.answer ? { question: v.clarified.question, answer: v.clarified.answer } : null;
    const reading = await readRevision(deps.intelDeps, {
      request: markedForReading(v.prompt, v.marks),
      madeWith: recipe.madeWith,
      history: recipe.history.map((h) => withClarified(replaceMarks(h.request, h.marks ?? []), h.clarified)),
      references: v.references.length,
      materials: v.materials,
      mayAsk: !v.clarified,
      clarified: answered,
    });
    reason = reading.reason;
    clarify = reading.clarify;
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
    ...(clarify ? { clarify } : {}),
  };
}
