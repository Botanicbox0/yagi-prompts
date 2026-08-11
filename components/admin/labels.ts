import type { BlockKind } from '@/lib/content/schemas';
import { VISIBILITY_ORDER, type Visibility } from '@/lib/content/visibility';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { AdminDict } from './chrome';

/** The two enum → prose maps the whole editor shares. Block kinds reuse the reader's own labels. */

const VISIBILITY_KEYS = {
  public: 'visPublic',
  free: 'visFree',
  pro: 'visPro',
  hidden: 'visHidden',
} as const;

export function visibilityLabel(dict: AdminDict, visibility: Visibility): string {
  return dict[VISIBILITY_KEYS[visibility]];
}

export function visibilityOptions(dict: AdminDict): Array<{ value: Visibility; label: string }> {
  return VISIBILITY_ORDER.map((visibility) => ({
    value: visibility,
    label: visibilityLabel(dict, visibility),
  }));
}

const KIND_KEYS = {
  prompt: 'blockPrompt',
  params: 'blockParams',
  asset: 'blockAsset',
  note: 'blockNote',
  link: 'blockLink',
  workflow_file: 'blockWorkflowFile',
} as const;

export function kindLabel(dict: Dictionary, kind: BlockKind): string {
  return dict.playbook[KIND_KEYS[kind]];
}

export const CATEGORIES = ['image', 'video', 'character', 'voice', 'music', 'pipeline'] as const;
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;

export function categoryLabel(dict: Dictionary, key: string): string {
  return (dict.category as Record<string, string>)[key] ?? key;
}

export function difficultyLabel(dict: Dictionary, key: string): string {
  return (dict.difficulty as Record<string, string>)[key] ?? key;
}
