import type { Dictionary } from '@/lib/i18n/dictionaries';
import { USE_CASES } from '@/lib/prompts/schemas';

/**
 * The dictionary → props seam for the prompts surface (§13, §3.9).
 *
 * Same reason `components/playbook/labels.ts` exists: the card media and the copy button are CLIENT
 * components, and handing them a whole `Dictionary` would ship both locales to every browser.
 */

export interface PromptLabels {
  byYagi: string;
  byAuthor: string;
  byAnonymous: string;
  lockChip: string;
  openLabel: string;
  copy: string;
  copied: string;
  copyFailed: string;
  copyLocked: string;
  promptHeading: string;
  promptNote: string;
  relatedHeading: string;
  backToGallery: string;
  submitCta: string;
  resultLabel: string;
  posterAlt: string;
  playHint: string;
  badgeNew: string;
  lockedHeading: string;
  lockedBody: string;
  lockedCta: string;
}

export function promptLabels(dict: Dictionary): PromptLabels {
  return {
    byYagi: dict.prompts.byYagi,
    byAuthor: dict.prompts.byAuthor,
    byAnonymous: dict.prompts.byAnonymous,
    lockChip: dict.prompts.lockChip,
    openLabel: dict.prompts.openLabel,
    copy: dict.prompts.copy,
    copied: dict.prompts.copied,
    copyFailed: dict.prompts.copyFailed,
    copyLocked: dict.prompts.copyLocked,
    promptHeading: dict.prompts.promptHeading,
    promptNote: dict.prompts.promptNote,
    relatedHeading: dict.prompts.relatedHeading,
    backToGallery: dict.prompts.backToGallery,
    submitCta: dict.prompts.submitCta,
    resultLabel: dict.prompts.resultLabel,
    posterAlt: dict.prompts.posterAlt,
    playHint: dict.prompts.playHint,
    badgeNew: dict.badge.new,
    // §5.5's lock panel is one design-system component; the prompts detail reuses its copy so a
    // reader meets the same sentence here and on a playbook page.
    lockedHeading: dict.plan.lockedPrompt,
    lockedBody: dict.playbook.lockedBody,
    lockedCta: dict.playbook.lockedCta,
  };
}

export function useCaseLabel(dict: Dictionary, key: string): string {
  return (dict.useCase as Record<string, string>)[key] ?? key;
}

/** The chips the filter rail renders, in vocabulary order, restricted to what is actually present. */
export function presentUseCases(available: readonly string[]): string[] {
  const set = new Set(available);
  return USE_CASES.filter((value) => set.has(value));
}
