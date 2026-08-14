import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { ContestPhase } from '@/lib/contests/phase';
import type { EntryPlatform, HostKind, Placement, PrizeKind } from '@/lib/contests/schemas';

/**
 * The dictionary → props seam for the contests surface (§14, §3.9).
 *
 * Same reason `components/prompts/labels.ts` exists: the hero is a CLIENT component, and handing it
 * a whole `Dictionary` would ship both locales to every browser.
 */

export interface ContestLabels {
  phaseOpen: string;
  phaseUpcoming: string;
  phaseClosed: string;
  opensLabel: string;
  deadlineLabel: string;
  closedLabel: string;
  resultsLabel: string;
  winnersAnnounced: string;
  hostedBy: string;
  prizeLabel: string;
  hostKindBrand: string;
  hostKindPlatform: string;
  hostKindStudio: string;
  hostKindCreator: string;
  hostKindCommunity: string;
  prizeKindCash: string;
  prizeKindCredits: string;
  prizeKindSubscription: string;
  prizeKindGear: string;
  prizeKindFeature: string;
  prizeKindMixed: string;
  prizeBreakdown: string;
  announceLabel: string;
  metaAnnounce: string;
  timelineHeading: string;
  timelineNow: string;
  featuredEyebrow: string;
  featuredCta: string;
  /** §14.2 meta grid (M9 design review, finding 4) — four column headers, not four sentences. */
  metaStatus: string;
  metaOpens: string;
  metaDeadline: string;
  metaCountdown: string;
  entryCount: string;
  entryCountEmpty: string;
  rulesHeading: string;
  entriesHeading: string;
  entriesEmpty: string;
  entriesModerated: string;
  winnersHeading: string;
  place1: string;
  place2: string;
  place3: string;
  watchLabel: string;
  platformLink: string;
  enterCta: string;
  /** What an early reader can actually DO, in place of the old "Opens {date}" pseudo-button. */
  readBriefCta: string;
  backToList: string;
  previewBadge: string;
  posterAlt: string;
}

export function contestLabels(dict: Dictionary): ContestLabels {
  const c = dict.contests;
  return {
    phaseOpen: c.phaseOpen,
    phaseUpcoming: c.phaseUpcoming,
    phaseClosed: c.phaseClosed,
    opensLabel: c.opensLabel,
    deadlineLabel: c.deadlineLabel,
    closedLabel: c.closedLabel,
    resultsLabel: c.resultsLabel,
    winnersAnnounced: c.winnersAnnounced,
    hostedBy: c.hostedBy,
    prizeLabel: c.prizeLabel,
    hostKindBrand: c.hostKindBrand,
    hostKindPlatform: c.hostKindPlatform,
    hostKindStudio: c.hostKindStudio,
    hostKindCreator: c.hostKindCreator,
    hostKindCommunity: c.hostKindCommunity,
    prizeKindCash: c.prizeKindCash,
    prizeKindCredits: c.prizeKindCredits,
    prizeKindSubscription: c.prizeKindSubscription,
    prizeKindGear: c.prizeKindGear,
    prizeKindFeature: c.prizeKindFeature,
    prizeKindMixed: c.prizeKindMixed,
    prizeBreakdown: c.prizeBreakdown,
    announceLabel: c.announceLabel,
    metaAnnounce: c.metaAnnounce,
    timelineHeading: c.timelineHeading,
    timelineNow: c.timelineNow,
    featuredEyebrow: c.featuredEyebrow,
    featuredCta: c.featuredCta,
    metaStatus: c.metaStatus,
    metaOpens: c.metaOpens,
    metaDeadline: c.metaDeadline,
    metaCountdown: c.metaCountdown,
    entryCount: c.entryCount,
    entryCountEmpty: c.entryCountEmpty,
    rulesHeading: c.rulesHeading,
    entriesHeading: c.entriesHeading,
    entriesEmpty: c.entriesEmpty,
    entriesModerated: c.entriesModerated,
    winnersHeading: c.winnersHeading,
    place1: c.place1,
    place2: c.place2,
    place3: c.place3,
    watchLabel: c.watchLabel,
    platformLink: c.platformLink,
    enterCta: c.enterCta,
    readBriefCta: c.readBriefCta,
    backToList: c.backToList,
    previewBadge: c.previewBadge,
    posterAlt: c.posterAlt,
  };
}

/**
 * Host kind → word, and prize kind → word (2026-08-15).
 *
 * A `Record` rather than a chain of ternaries, because the compiler is then the thing that notices
 * when a sixth kind lands in `HOST_KINDS` and nobody wrote its label.
 */
export function hostKindLabel(labels: ContestLabels, kind: HostKind): string {
  const map: Record<HostKind, string> = {
    brand: labels.hostKindBrand,
    platform: labels.hostKindPlatform,
    studio: labels.hostKindStudio,
    creator: labels.hostKindCreator,
    community: labels.hostKindCommunity,
  };
  return map[kind];
}

export function prizeKindLabel(labels: ContestLabels, kind: PrizeKind): string {
  const map: Record<PrizeKind, string> = {
    cash: labels.prizeKindCash,
    credits: labels.prizeKindCredits,
    subscription: labels.prizeKindSubscription,
    gear: labels.prizeKindGear,
    feature: labels.prizeKindFeature,
    mixed: labels.prizeKindMixed,
  };
  return map[kind];
}

export function phaseLabel(labels: ContestLabels, phase: ContestPhase): string {
  return phase === 'open'
    ? labels.phaseOpen
    : phase === 'upcoming'
      ? labels.phaseUpcoming
      : labels.phaseClosed;
}

export function placementLabel(labels: ContestLabels, placement: Placement): string {
  return placement === 1 ? labels.place1 : placement === 2 ? labels.place2 : labels.place3;
}

/**
 * Platform chip text.
 *
 * Deliberately NOT in the dictionaries: these are proper nouns with fixed capitalisation, identical
 * in both locales, and putting them there would either duplicate six brand names twice or trip the
 * "actually translates the prose" assertion in `tests/i18n/dictionary.test.ts`. Only `link` is a
 * WORD, so only `link` comes from the dictionary.
 */
const PLATFORM_LABELS: Record<Exclude<EntryPlatform, 'link'>, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  threads: 'Threads',
  vimeo: 'Vimeo',
};

export function platformLabel(labels: ContestLabels, platform: EntryPlatform): string {
  return platform === 'link' ? labels.platformLink : PLATFORM_LABELS[platform];
}
