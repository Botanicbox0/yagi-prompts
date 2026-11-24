'use client';

import { KeyframePicker, type KeyframeMarksCopy } from '@/components/recipes/keyframe-picker';
import { ADMIN_ACTION_PATH, BACK_FIELD, OP_FIELD } from '@/lib/admin/form';
import type { VideoKeyframe } from '@/lib/prompts/keyframes';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — the admin template page's marks editor: the maker's keyframe picker in marks
 * mode, saving through `prompt.marks` on the one admin door (`/admin/do`, JSON answer). The operation checks every
 * part against the stored prompt again; the select only offers the declared parts.
 */
export function TemplateMarksEditor({
  op,
  promptId,
  back,
  durationSeconds,
  videoSrc,
  parts,
  initialMarks,
  maxMarks,
  copy,
  locale,
}: {
  /** The operation it posts, named on the page like an `OpForm`'s (tests/prompts/moderation.test.ts reads the screens). */
  op: 'prompt.marks';
  promptId: string;
  back: string;
  durationSeconds: number;
  videoSrc: string | null;
  parts: ReadonlyArray<{ key: string; label: string }>;
  initialMarks: readonly VideoKeyframe[];
  maxMarks: number;
  copy: KeyframeMarksCopy;
  locale: string;
}) {
  const save = async (marks: VideoKeyframe[]) => {
    const form = new FormData();
    form.set(OP_FIELD, op);
    form.set(BACK_FIELD, back);
    form.set('id', promptId);
    form.set('marks', JSON.stringify(marks.map(({ thumbUrl: _thumb, ...mark }) => mark)));
    const response = await fetch(ADMIN_ACTION_PATH, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean };
    return { ok: response.ok && json.ok === true };
  };

  return (
    <div data-template-marks>
      <KeyframePicker
        formatId={promptId}
        durationSeconds={durationSeconds}
        initialKeyframes={initialMarks}
        exampleVideoSrc={videoSrc}
        locale={locale}
        parts={parts}
        marksCopy={copy}
        maxEntries={maxMarks}
        saveAction={save}
      />
    </div>
  );
}
