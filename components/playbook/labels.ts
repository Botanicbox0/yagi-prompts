import type { BlockKind } from '@/lib/content/schemas';
import type { Dictionary } from '@/lib/i18n/dictionaries';

/**
 * The dictionary → props seam for the detail page, same idiom as `CardLabels` / `FooterLabels`
 * (M1, components/marketing/chrome.tsx).
 *
 * Two reasons it is worth the boilerplate: the copy button is a client component and must not drag
 * both dictionaries into the browser bundle, and every renderer becomes a pure function of
 * (block, labels) — which is what makes the §6.1 contract tests possible without a page.
 */
export interface PlaybookLabels {
  kinds: Record<BlockKind, string>;

  eyebrow: string;
  showcase: string;
  previewBadge: string;

  metaTime: string;
  metaCost: string;
  metaModels: string;
  metaTools: string;
  metaSteps: string;
  minutes: string;
  updated: string;
  neverUpdated: string;
  changeNote: string;
  revision: string;

  stepsHeading: string;
  stepLabel: string;
  lockedInStep: string;
  jumpToStep: string;

  promptModel: string;
  promptNegative: string;
  copy: string;
  copied: string;
  copyFailed: string;
  paramKey: string;
  paramValue: string;
  download: string;
  openExternal: string;
  assetMissing: string;

  lockedHeading: string;
  lockedBody: string;
  lockedCta: string;

  proCtaHeading: string;
  proCtaBody: string;
  prevLabel: string;
  nextLabel: string;
  allPlaybooks: string;
}

export function playbookLabels(dict: Dictionary): PlaybookLabels {
  const p = dict.playbook;
  return {
    kinds: {
      prompt: p.blockPrompt,
      params: p.blockParams,
      asset: p.blockAsset,
      note: p.blockNote,
      link: p.blockLink,
      workflow_file: p.blockWorkflowFile,
    },
    eyebrow: p.eyebrow,
    showcase: p.showcase,
    previewBadge: p.previewBadge,
    metaTime: p.metaTime,
    metaCost: p.metaCost,
    metaModels: p.metaModels,
    metaTools: p.metaTools,
    metaSteps: p.metaSteps,
    minutes: p.minutes,
    updated: p.updated,
    neverUpdated: p.neverUpdated,
    changeNote: p.changeNote,
    revision: p.revision,
    stepsHeading: p.stepsHeading,
    stepLabel: p.stepLabel,
    lockedInStep: p.lockedInStep,
    jumpToStep: p.jumpToStep,
    promptModel: p.promptModel,
    promptNegative: p.promptNegative,
    copy: p.copy,
    copied: p.copied,
    copyFailed: p.copyFailed,
    paramKey: p.paramKey,
    paramValue: p.paramValue,
    download: p.download,
    openExternal: p.openExternal,
    assetMissing: p.assetMissing,
    lockedHeading: p.lockedHeading,
    lockedBody: p.lockedBody,
    lockedCta: p.lockedCta,
    proCtaHeading: p.proCtaHeading,
    proCtaBody: p.proCtaBody,
    prevLabel: p.prevLabel,
    nextLabel: p.nextLabel,
    allPlaybooks: p.allPlaybooks,
  };
}

export const stepAnchor = (order: number) => `step-${order}`;
