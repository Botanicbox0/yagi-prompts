/**
 * The rules of what a screen lists, in ONE place: the studio state read (./repo.ts, which re-exports them), the assets
 * page's counts and pages (./brand-project-files.ts), 보내기's file cards (lib/brand-rooms/send.ts) and the spine's own
 * rules (./brand-projects.ts) build their statements from these, so a count can never disagree with a list.
 * Without an alias each gives exactly the unqualified text the state read has always sent.
 *
 * A leaf on purpose (type imports only): ./brand-projects.ts uses these, and ./repo.ts imports ./brand-projects.ts, so
 * the rules cannot live in ./repo.ts without an import cycle.
 */
import type { OutputRow } from './types';

const column = (alias: string | undefined, name: string): string => (alias ? `${alias}.${name}` : name);

/**
 * Lists of runs leave out the internal strips of "빈 곳 채우기" (`params.purpose = 'fill'`). Reads by id
 * (`jobsByIds`, the poll) still return them, and usage counts them like any other run.
 */
export const notFillRun = (alias?: string): string => `coalesce(${column(alias, 'params')} ->> 'purpose', '') <> 'fill'`;
export const NOT_FILL = notFillRun();

/** The image wall's runs (the state read's first list): pictures and partial edits, fill strips left out. */
export const IMAGE_RUNS = (alias?: string): string => `${column(alias, 'kind')} in ('image', 'region_edit') and ${notFillRun(alias)}`;

/** The video wall's runs (the state read's second list): clips, remixes and finals, the editor's export left out. */
export const VIDEO_RUNS = (alias?: string): string =>
  `${column(alias, 'kind')} in ('video', 'video_remix', 'video_final') and ${column(alias, 'model')} <> 'compose-1080p'`;

/** The sound studio's runs (music and sound effects). The studio state never lists them; the assets page does. */
export const SOUND_RUNS = (alias?: string): string => `${column(alias, 'kind')} in ('music', 'sound_effect')`;

/** A result a screen shows (`jobView`'s `outputs`): ready, not deleted, stored. The SQL twin of `isVisibleOutput`. */
export const VISIBLE_OUTPUT = (alias: string): string =>
  `${alias}.status = 'ready' and ${alias}.deleted_at is null and coalesce(${alias}.storage_key, '') <> ''`;

export function isVisibleOutput(o: Pick<OutputRow, 'status' | 'deleted_at' | 'storage_key'>): boolean {
  return o.status === 'ready' && !o.deleted_at && Boolean(o.storage_key);
}

/** A library entry the panel lists (`assetsOf`): ready and not deleted. */
export const LIBRARY_ASSETS = (alias?: string): string => `${column(alias, 'status')} = 'ready' and ${column(alias, 'deleted_at')} is null`;
