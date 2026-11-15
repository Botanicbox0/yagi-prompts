'use client';
import { useEffect, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import { fetchPhotoCheck, PHOTO_CHECK_MAX_LINES, type PhotoCheck } from '@/lib/identity/photo-check-view';

/**
 * The advisory photo check under a saved photo (lib/identity/photo-check.ts). Advice only: it never
 * disables anything, and while loading, on failure or with the check off it shows nothing at all.
 * Neutral ink — no red, no badge (docs/design/IDENTITY.md, TASTE.md).
 */
type Copy = Dictionary['selfie']['photoCheck'];

export interface PhotoCheckViewProps {
  check: PhotoCheck | null | undefined;
  copy: Copy;
  /** The existing "change photo" action, offered with a `retake` verdict. */
  onRetake?: () => void;
  retakeLabel?: string;
}

export function PhotoCheckView({ check, copy, onRetake, retakeLabel }: PhotoCheckViewProps) {
  if (!check) return null;
  if (check.status === 'good') {
    return <div data-photo-check="good" className="text-sm leading-relaxed opacity-75"><p>{copy.good}</p></div>;
  }
  const lines = check.issues.slice(0, PHOTO_CHECK_MAX_LINES);
  if (!lines.length) return null;
  return (
    <div data-photo-check={check.status} className="flex flex-col gap-1 text-sm leading-relaxed">
      {lines.map(code => <p key={code} data-photo-check-issue={code}>{copy.issues[code]}</p>)}
      {check.status === 'retake' ? (
        <>
          <p className="opacity-75">{copy.retake}</p>
          {onRetake && retakeLabel ? (
            <button type="button" data-photo-check-retake onClick={onRetake} className="inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4">{retakeLabel}</button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export interface PhotoCheckNoteProps extends Omit<PhotoCheckViewProps, 'check'> {
  selfieId: string;
  /** Test seam: a known answer (or null) instead of asking the server. */
  initial?: PhotoCheck | null;
}

/** Asks once per photo per page session (no polling, no retry) and renders the answer. */
export function PhotoCheckNote({ selfieId, initial, ...view }: PhotoCheckNoteProps) {
  const [answer, setAnswer] = useState<{ id: string; check: PhotoCheck | null } | null>(initial === undefined ? null : { id: selfieId, check: initial });
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    void fetchPhotoCheck(selfieId).then(check => { if (live) setAnswer({ id: selfieId, check }); });
    return () => { live = false; };
  }, [selfieId, initial]);
  return <PhotoCheckView {...view} check={answer?.id === selfieId ? answer.check : undefined} />;
}
