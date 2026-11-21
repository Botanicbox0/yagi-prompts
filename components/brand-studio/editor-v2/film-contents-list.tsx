'use client';

import { fill } from '@/components/brand-studio/copy';
import { gradeName, type FilmContents, type GradeNames } from '@/lib/brand-studio/editor-v2/film-contents';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import styles from './editor-v2.module.css';

/**
 * What a real film's file carries (review round 1, item 6), as one plain list: the export sheet shows it
 * with the cuts, the film panel without them. Music and sound effects say they are not heard in this
 * preview (the sound workspace arrives later); everything else here is shown in the preview.
 */
export function FilmContentsList({
  contents,
  copy,
  gradeNames,
  withCuts,
}: {
  contents: FilmContents;
  copy: StudioEditorCopy;
  gradeNames: GradeNames | null | undefined;
  withCuts: boolean;
}) {
  const c = copy.export.contents;
  const rows: Array<{ key: string; text: string; quiet?: boolean }> = [];
  if (withCuts) rows.push({ key: 'cuts', text: fill(c.cuts, { count: contents.cuts }) });
  if (contents.captions > 0) rows.push({ key: 'captions', text: fill(c.captions, { count: contents.captions }) });
  if (contents.grade) rows.push({ key: 'grade', text: fill(c.grade, { name: gradeName(contents.grade, gradeNames, c.gradeCustom) }) });
  if (contents.music) rows.push({ key: 'music', text: `${fill(c.music, { name: contents.music })} · ${c.notHeard}`, quiet: true });
  if (contents.effects > 0) rows.push({ key: 'effects', text: `${fill(c.effects, { count: contents.effects })} · ${c.notHeard}`, quiet: true });
  if (contents.stills > 0) rows.push({ key: 'stills', text: fill(c.stills, { count: contents.stills }) });
  if (rows.length === 0) return null;
  return (
    <ul className={styles.filmContents} data-editor-contents={rows.map((row) => row.key).join(' ')}>
      {rows.map((row) => (
        <li key={row.key} data-editor-contents-row={row.key} data-quiet={row.quiet ? '' : undefined}>
          {row.text}
        </li>
      ))}
    </ul>
  );
}
