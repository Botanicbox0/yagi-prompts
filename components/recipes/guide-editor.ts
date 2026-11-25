import {
  MAX_STEP_PROMPT_CHARS,
  MIN_STEP_PROMPT_CHARS,
  NOTE_MAX,
  PARTNER_SLOT,
  PET_SLOT,
  SELFIE_SLOT,
  type RecipeGuideStep,
} from '@/lib/recipes/schema';

/**
 * Pure editor state helpers for display-only `recipe.guide` clip cards (Batch 1).
 * Kept free of `'use client'` so server tests and client components can share it cleanly.
 */

export const MAX_GUIDE_CLIPS = 16;
export const GUIDE_TITLE_MAX = 120;
export const GUIDE_META_MAX = 80;
export const GUIDE_PROMPT_MIN = MIN_STEP_PROMPT_CHARS;
export const GUIDE_PROMPT_MAX = MAX_STEP_PROMPT_CHARS;
export const GUIDE_NOTE_MAX = NOTE_MAX;

export interface GuideCardDraft {
  key: string;
  title: string;
  kind: 'image' | 'video';
  meta: string;
  prompt: string;
  note: string;
}

export interface EditorTokenLabels {
  selfie: string;
  pet?: string;
  partner?: string;
  reference: (n: number) => string;
  step: (n: number) => string;
}

export interface EditorFileRef {
  id: string;
  role: 'reference' | 'example';
}

let keySeq = 0;
export function nextGuideKey(): string {
  keySeq += 1;
  return `clip-${keySeq}`;
}

export function createGuideClip(kind: 'image' | 'video' = 'video', key = nextGuideKey()): GuideCardDraft {
  return { key, title: '', kind, meta: '', prompt: '', note: '' };
}

export function addGuideClip(list: readonly GuideCardDraft[], kind: 'image' | 'video' = 'video'): GuideCardDraft[] {
  if (list.length >= MAX_GUIDE_CLIPS) return [...list];
  return [...list, createGuideClip(kind)];
}

export function duplicateGuideClip(list: readonly GuideCardDraft[], index: number): GuideCardDraft[] {
  if (list.length >= MAX_GUIDE_CLIPS || index < 0 || index >= list.length) return [...list];
  const source = list[index]!;
  const copy: GuideCardDraft = { ...source, key: nextGuideKey() };
  return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
}

export function moveGuideClip(list: readonly GuideCardDraft[], index: number, delta: -1 | 1): GuideCardDraft[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

export function removeGuideClip(list: readonly GuideCardDraft[], index: number): GuideCardDraft[] {
  if (index < 0 || index >= list.length) return [...list];
  return list.filter((_, i) => i !== index);
}

export function updateGuideClip(
  list: readonly GuideCardDraft[],
  index: number,
  patch: Partial<Omit<GuideCardDraft, 'key'>>,
): GuideCardDraft[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

export function guideDraftsToGuideInput(drafts: readonly GuideCardDraft[]): RecipeGuideStep[] | undefined {
  if (drafts.length === 0) return undefined;
  return drafts.map((item) => {
    const meta = item.meta.trim();
    const note = item.note.trim();
    return {
      title: item.title,
      kind: item.kind,
      ...(meta ? { meta } : {}),
      prompt: item.prompt,
      ...(note ? { note } : {}),
    };
  });
}

interface RawRecipeLike {
  slots?: Record<string, { source?: string; asset?: string; role?: string }>;
  steps?: Array<{ id?: string; kind?: string }>;
  guide?: unknown[];
}

export function guideFromRecipe(
  raw: unknown,
  files: readonly EditorFileRef[],
  label: EditorTokenLabels,
): GuideCardDraft[] {
  let obj: RawRecipeLike | null = null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      obj = parsed as RawRecipeLike;
    }
  } catch {
    return [];
  }
  if (!obj || !Array.isArray(obj.guide)) return [];

  const references = files.filter((f) => f.role === 'reference');
  const slots = obj.slots ?? {};
  const imageIndex = new Map<string, number>();
  let images = 0;
  if (Array.isArray(obj.steps)) {
    for (const step of obj.steps) {
      if (step?.kind === 'image' && typeof step.id === 'string') {
        imageIndex.set(step.id, ++images);
      }
    }
  }

  const toReadablePrompt = (prompt: string) =>
    prompt.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (match, name: string) => {
      if (name === SELFIE_SLOT) return label.selfie;
      const slot = slots[name];
      if (slot?.role === 'pet' || name === PET_SLOT) return label.pet ?? label.selfie;
      if (slot?.role === 'partner' || name === PARTNER_SLOT) return label.partner ?? label.selfie;
      if (slot?.source === 'creator' && slot.asset) {
        const at = references.findIndex((f) => f.id === slot.asset);
        return at >= 0 ? label.reference(at + 1) : match;
      }
      const stepNum = imageIndex.get(name);
      if (stepNum) return label.step(stepNum);
      return match;
    });

  return obj.guide
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      key: nextGuideKey(),
      title: typeof item.title === 'string' ? item.title : '',
      kind: item.kind === 'image' ? 'image' : 'video',
      meta: typeof item.meta === 'string' ? item.meta : '',
      prompt: typeof item.prompt === 'string' ? toReadablePrompt(item.prompt) : '',
      note: typeof item.note === 'string' ? item.note : '',
    }));
}

export function guideClipValidation(
  clip: GuideCardDraft,
  convertedPromptLength: number = clip.prompt.trim().length,
) {
  const titleLen = clip.title.trim().length;
  const metaLen = clip.meta.trim().length;
  const noteLen = clip.note.trim().length;
  const titleTooShort = titleLen < 1;
  const titleOver = titleLen > GUIDE_TITLE_MAX;
  const metaOver = metaLen > GUIDE_META_MAX;
  const promptTooShort = convertedPromptLength < GUIDE_PROMPT_MIN;
  const promptOver = convertedPromptLength > GUIDE_PROMPT_MAX;
  const noteOver = noteLen > GUIDE_NOTE_MAX;
  return {
    titleLen,
    metaLen,
    promptLen: convertedPromptLength,
    noteLen,
    titleTooShort,
    titleOver,
    metaOver,
    promptTooShort,
    promptOver,
    noteOver,
    overLimit: titleOver || metaOver || promptOver || noteOver,
  };
}
