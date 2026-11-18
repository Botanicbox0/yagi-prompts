/**
 * The workspace home's hand-off to a studio (docs/BRAND-STUDIO-V3.md §12): the home writes the sentence
 * the member typed (or a starter's) and the screen it is for; the studio's dock takes it once, on its
 * first load, and puts it in the prompt field. Nothing is generated and nothing is spent on the way.
 *
 * `sessionStorage`, one entry, read once: it is removed on the first read whatever happens next, so a
 * reload, a second tab or a later visit never sees it again. It is ignored (and still removed) when it
 * is for another brand or another screen, older than a minute, for a member who cannot create, for a
 * sandboxed organization, or when the field already holds words.
 *
 * Client-safe: no env, no db. The storage is passed in so tests run without a DOM.
 */
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import type { StudioMedium } from '@/lib/brand-studio/models';
import { isSandboxedClientOrganization } from '@/lib/brands/features';

export const STUDIO_PREFILL_KEY = 'twings_studio_prefill_v1';
/** A hand-off is a page change away; anything older is from another visit. */
export const STUDIO_PREFILL_MAX_AGE_MS = 60_000;

export interface StudioPrefill {
  organizationId: string;
  medium: StudioMedium;
  prompt: string;
  /** `Date.now()` when the home wrote it. */
  at: number;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Writes the hand-off. False when storage is blocked (the studio then simply opens empty). */
export function writeStudioPrefill(storage: Storage | null | undefined, value: Omit<StudioPrefill, 'at'>, now = Date.now()): boolean {
  if (!storage) return false;
  const prompt = value.prompt.trim().slice(0, STUDIO_LIMITS.promptMax);
  try {
    if (!prompt) {
      storage.removeItem(STUDIO_PREFILL_KEY);
      return false;
    }
    storage.setItem(STUDIO_PREFILL_KEY, JSON.stringify({ organizationId: value.organizationId, medium: value.medium, prompt, at: now }));
    return true;
  } catch {
    return false;
  }
}

export interface TakePrefillInput {
  organizationId: string;
  medium: StudioMedium;
  /** The member may create here (owner or editor, allowance open): a viewer gets nothing. */
  canCreate: boolean;
  /** What the field holds now; words already there are never replaced. */
  currentPrompt: string;
  now?: number;
}

/** Reads and removes the hand-off; the sentence to put in the field, or null. */
export function takeStudioPrefill(storage: Storage | null | undefined, input: TakePrefillInput): string | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(STUDIO_PREFILL_KEY);
    if (raw !== null) storage.removeItem(STUDIO_PREFILL_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: Partial<StudioPrefill>;
  try {
    value = JSON.parse(raw) as Partial<StudioPrefill>;
  } catch {
    return null;
  }
  const now = input.now ?? Date.now();
  if (typeof value.prompt !== 'string' || typeof value.organizationId !== 'string' || typeof value.at !== 'number') return null;
  if (value.organizationId.toLowerCase() !== input.organizationId.toLowerCase()) return null;
  if (value.medium !== input.medium) return null;
  if (now - value.at < 0 || now - value.at > STUDIO_PREFILL_MAX_AGE_MS) return null;
  if (!input.canCreate) return null;
  if (isSandboxedClientOrganization({ id: input.organizationId })) return null;
  if (input.currentPrompt.trim()) return null;
  const prompt = value.prompt.trim().slice(0, STUDIO_LIMITS.promptMax);
  return prompt || null;
}

/** The studio's own prompt field, focused with the caret after the words. */
export function focusDockPromptEnd(): void {
  const field = document.querySelector<HTMLTextAreaElement>('[data-studio-dock] textarea.bs-prompt');
  if (!field) return;
  field.focus();
  const end = field.value.length;
  try {
    field.setSelectionRange(end, end);
  } catch {
    // Some fields refuse a selection while hidden; focus is enough.
  }
}
