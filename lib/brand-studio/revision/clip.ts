/**
 * What a clip shows, for the revise conversation (`revise.talk`): the same reading the make-time edit uses
 * (`readFilm`, basic depth: length, shots with framing / camera / action, look, sound, a short summary),
 * read once per output and language and kept on the row of the job that made the output, in its existing
 * `params` jsonb (`params.clipSheets["<outputId>:<locale>"]`). No new column, no migration: outputs have
 * no jsonb field, and a job's params already travel with the result they describe.
 *
 * Measured 2026-11-20 on a 5 s 480p clip: one call, about 2,600 input tokens (1,500 of them video at
 * 4 frames per second) and 230–570 output tokens, 13–22 s. That is why the opening call reads it and a
 * message never waits for it.
 */
import type { FilmSheet } from '../contracts';
import { compactFilmSheet, extractStoredFilmSheet } from '../film-sheet';
import { readSheet } from '../prepare';
import { resolveReferences } from '../plan';
import type { JobRow, StudioDeps } from '../types';

export const clipSheetKey = (outputId: string, locale: 'ko' | 'en') => `${outputId}:${locale}`;

/** The kept reading of an output, when its job has one. */
export function storedClipSheet(job: Pick<JobRow, 'params'> | null | undefined, outputId: string, locale: 'ko' | 'en'): FilmSheet | null {
  const kept = job?.params?.clipSheets?.[clipSheetKey(outputId, locale)];
  if (!kept) return null;
  // The same tolerant read as a library video's kept sheet.
  return extractStoredFilmSheet({ ko: kept }, 'ko');
}

/** Keeps a reading on the job row (one key of `params`; nothing else on the row changes). */
export async function keepClipSheet(
  sql: StudioDeps['sql'],
  input: { organizationId: string; jobId: string; outputId: string; locale: 'ko' | 'en'; sheet: FilmSheet },
): Promise<void> {
  await sql.query(
    `update brand_studio_jobs
        set params = jsonb_set(coalesce(params, '{}'::jsonb), '{clipSheets}',
              coalesce(params->'clipSheets', '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb), true)
      where id = $1 and organization_id = $2`,
    [input.jobId, input.organizationId, clipSheetKey(input.outputId, input.locale), JSON.stringify(compactFilmSheet(input.sheet))],
  );
}

/**
 * The reading of `outputId`: the kept one, else (only when `read` is true) a fresh reading, kept for the
 * next turn. Any failure is null: the conversation goes on without it and says nothing about the picture.
 */
export async function clipSheetFor(
  deps: Pick<StudioDeps, 'sql' | 'intel' | 'intelDeps' | 'media' | 'env'>,
  input: { organizationId: string; job: JobRow; outputId: string; locale: 'ko' | 'en'; read: boolean },
): Promise<FilmSheet | null> {
  const kept = storedClipSheet(input.job, input.outputId, input.locale);
  if (kept || !input.read) return kept;
  try {
    const [ref] = await resolveReferences(deps.sql, input.organizationId, [{ outputId: input.outputId }], deps.media, input.locale);
    if (!ref || ref.kind !== 'video') return null;
    const sheet = await readSheet(deps, ref, input.locale);
    if (!sheet) return null;
    await keepClipSheet(deps.sql, { organizationId: input.organizationId, jobId: input.job.id, outputId: input.outputId, locale: input.locale, sheet });
    return sheet;
  } catch {
    return null;
  }
}
