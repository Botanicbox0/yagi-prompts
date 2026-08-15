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
  /** Admin-only note: what a normal reader meets here (2026-08-15). */
  adminBypass: string;
  relatedHeading: string;
  backToGallery: string;
  submitCta: string;
  resultLabel: string;
  posterAlt: string;
  playHint: string;
  audioLabel: string;
  audioDownload: string;
  processHeading: string;
  sourceLink: string;
  badgeNew: string;
  lockedHeading: string;
  lockedBody: string;
  // §15.3 — the three lock-panel variants' copy.
  signinCta: string;
  signinHint: string;
  spendCta: string;
  spendNote: string;
  emptyTitle: string;
  weeklyLine: string;
  packTitle: string;
  packNote: string;
  packCta: string;
  packUnavailableBody: string;
  walletUnavailable: string;
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
    adminBypass: dict.prompts.adminBypass,
    relatedHeading: dict.prompts.relatedHeading,
    backToGallery: dict.prompts.backToGallery,
    submitCta: dict.prompts.submitCta,
    resultLabel: dict.prompts.resultLabel,
    posterAlt: dict.prompts.posterAlt,
    playHint: dict.prompts.playHint,
    audioLabel: dict.prompts.audioLabel,
    audioDownload: dict.prompts.audioDownload,
    processHeading: dict.prompts.processHeading,
    sourceLink: dict.prompts.sourceLink,
    badgeNew: dict.badge.new,
    // §15.3 — the lock panel speaks cookies now. The playbook library keeps the §5.5 Pro copy;
    // this surface's gate is per-prompt, so its sentences are the wallet's.
    lockedHeading: dict.cookies.lockedHeading,
    lockedBody: dict.cookies.lockedBody,
    signinCta: dict.cookies.signinCta,
    signinHint: dict.cookies.signinHint,
    spendCta: dict.cookies.spendCta,
    spendNote: dict.cookies.spendNote,
    emptyTitle: dict.cookies.emptyTitle,
    weeklyLine: dict.cookies.weeklyLine,
    packTitle: dict.cookies.packTitle,
    packNote: dict.cookies.packNote,
    packCta: dict.cookies.packCta,
    // §15.1-5 — the pack renders the same honest not-connected state billing does (§11).
    packUnavailableBody: dict.billing.unavailableBody,
    // F5 — the wallet-unreadable panel: one factual sentence, no pitch.
    walletUnavailable: dict.cookies.unavailableBody,
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
