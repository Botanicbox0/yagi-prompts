'use client';

import { useState, useSyncExternalStore } from 'react';
import { createStudioApi } from '@/components/brand-studio/api';
import { exportSaveFailureLine, openExportReview, saveExportedFilm } from '@/components/brand-studio/compose/export-asset';
import { ShareReviewDialog, useShareReviewEvent, type ShareReviewTarget } from '@/components/brand-studio/share-review-dialog';
import type { StudioAssetView } from '@/lib/brand-studio/contracts';
import type { StudioComposeCopy } from '@/messages/studio-compose';
import { exportJobSnapshot, exportedFile, type ExportJob } from './export-job';
import styles from './editor-v2.module.css';

/**
 * Editing studio v2 — "에셋에 저장" and "검수 · 공유" on the finished export (review point B-1, founder: "넣어").
 *
 * The current editor's two actions, with its code (components/brand-studio/compose/export-asset.ts) and its words
 * (`studioCompose`, handed over by the page; nothing of them is copied into this editor's dictionary):
 * - "에셋에 저장" uploads the finished MP4 through the library's own upload (the studio client's `upload`): the same type
 *   and size checks in the browser, the same storage, pre-approval and role checks on the server. One finished export
 *   becomes at most one asset: saving or saved, a press does nothing, also after the sheet was closed and opened again
 *   (the state lives here, beside the export job, not in the sheet). A new export starts over. A file the next export
 *   released (export-job.ts `exportedFile`) is never uploaded.
 * - "검수 · 공유" shares the exported film: saved first when it is not yet, then the review share window for that
 *   asset (`ExportShareHost` below must be mounted: the editor mounts it for the organization's own film). Unlike the
 *   current editor it never shares the selected clip's own asset instead: this is the sheet of the exported film.
 *   A refused save opens nothing and says why.
 * - A refusal says the current editor's line (`saveQuotaExceeded` for `asset_limit` and `storage_quota_exceeded`,
 *   `saveFailed` otherwise), except a file over the library's size limit, which gets the library's own sentence for
 *   that refusal (it names the 50 MB video limit; the current editor says `saveFailed` there).
 * - The sheet shows the actions only on the organization's own film and for people who may change it. Nothing here
 *   asks for credits: no compose request, only the library upload (tests/brand-studio/editor-v2/flag-gate.test.ts
 *   holds the requests to this one file).
 */
export interface ExportKeepCopy {
  actions: Pick<StudioComposeCopy['actions'], 'saveToAssets' | 'savingToAssets' | 'savedToAssets' | 'shareReview'>;
  status: Pick<StudioComposeCopy['status'], 'saveQuotaExceeded' | 'saveFailed' | 'reviewOpened' | 'reviewNeedsSave'>;
  /** The library's sentence for a file over its size limit (copy.ts `studioUploadErrorLine`, `file_too_large`). */
  fileTooLarge: string;
}

export interface KeepOptions {
  organizationId: string;
  /** Owner or editor, not the studio team looking in: anyone else sends nothing. */
  canSave: boolean;
  /** The review share window's title: the film's name. */
  title: string;
  copy: ExportKeepCopy;
  /** Told about the new asset once it is saved (the editor lists it among its clips). */
  onSaved?: (asset: StudioAssetView) => void;
}

type KeepState = { phase: 'saving' } | { phase: 'saved'; assetId: string; line: string | null } | { phase: 'failed'; code: string; line: string };

/** Per finished export; an export that is gone is forgotten with it. */
const states = new WeakMap<ExportJob, KeepState>();
let version = 0;
const listeners = new Set<() => void>();

function put(of: ExportJob, state: KeepState) {
  states.set(of, state);
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const versionNow = () => version;
const versionAtFirst = () => 0;

/**
 * "에셋에 저장" (`save`) or "검수 · 공유" (`share`) for the finished export `of`. Does nothing for a viewer, for a job
 * that is not the last finished export (its file released), while that export is saving, and, for `save`, once it
 * is saved. `share` on a saved export opens the window for its asset again without uploading.
 */
export async function keepExport(of: ExportJob, options: KeepOptions, action: 'save' | 'share'): Promise<void> {
  if (!options.canSave) return;
  const now = states.get(of);
  if (now?.phase === 'saving') return;
  if (now?.phase === 'saved') {
    if (action === 'share') share(of, options, now.assetId);
    return;
  }
  const file = exportedFile(of);
  if (!file) return;
  put(of, { phase: 'saving' });
  const saved = await saveExportedFilm(createStudioApi({ organizationId: options.organizationId }), file);
  if (!saved.ok) {
    const { copy } = options;
    put(of, { phase: 'failed', code: saved.code ?? 'failed', line: saved.code === 'file_too_large' ? copy.fileTooLarge : exportSaveFailureLine(copy.status, saved.code) });
    return;
  }
  put(of, { phase: 'saved', assetId: saved.asset.id, line: null });
  options.onSaved?.(saved.asset);
  // The window opens only for the export the sheet still shows (another may have started while this one saved).
  if (action === 'share' && exportJobSnapshot() === of) share(of, options, saved.asset.id);
}

function share(of: ExportJob, options: KeepOptions, assetId: string) {
  const line = openExportReview({ organizationId: options.organizationId, assetId, outputId: null, title: options.title }, options.copy.status);
  put(of, { phase: 'saved', assetId, line });
}

/** The two actions in the done state of the export sheet. Renders nothing without a file to save or for a viewer. */
export function ExportKeep({ job, options }: { job: ExportJob; options: KeepOptions }) {
  useSyncExternalStore(subscribe, versionNow, versionAtFirst);
  if (!options.canSave || !exportedFile(job)) return null;
  const { copy } = options;
  const state = states.get(job);
  const saving = state?.phase === 'saving';
  const saved = state?.phase === 'saved';
  const line = state && state.phase !== 'saving' ? state.line : null;
  return (
    <>
      <button
        type="button"
        className={styles.fixBtn}
        onClick={() => void keepExport(job, options, 'save')}
        disabled={saving || saved}
        data-editor-export-save={saved ? 'saved' : saving ? 'saving' : 'ready'}
      >
        {saved ? copy.actions.savedToAssets : saving ? copy.actions.savingToAssets : copy.actions.saveToAssets}
      </button>
      <button type="button" className={styles.fixBtn} onClick={() => void keepExport(job, options, 'share')} disabled={saving} data-editor-export-share>
        {copy.actions.shareReview}
      </button>
      {line && (
        <p className={styles.note} role="status" data-editor-export-keep-line={state?.phase === 'failed' ? state.code : 'review'}>
          {line}
        </p>
      )}
    </>
  );
}

/**
 * The review share window's host on the editor page (the current editor, the library and the studios each mount
 * their own): it opens the window when "검수 · 공유" asks for it.
 */
export function ExportShareHost({ organizationId, locale }: { organizationId: string; locale: 'ko' | 'en' }) {
  const [target, setTarget] = useState<ShareReviewTarget | null>(null);
  useShareReviewEvent(organizationId, setTarget);
  return target ? <ShareReviewDialog target={target} locale={locale} onClose={() => setTarget(null)} /> : null;
}
