'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { fill } from '@/components/brand-studio/copy';
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { burnsCaptions, formatBytes, notIncluded, writesCaptionFile } from '@/lib/brand-studio/editor-v2/export-plan';
import { formatTimecode, totalFrames } from '@/lib/brand-studio/editor-v2/frames';
import { captionsToSrt, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { browserCanExport } from './export-film';
import { cancelExport, exportJobSnapshot, idleExportJob, startExport, subscribeExportJob, watchExportJob, type ExportJob } from './export-job';
import { EditorIcon } from './icons';
import type { EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

/**
 * The export sheet (docs/BRAND-EDITING-STUDIO-V2.md §6.4): what is still open, what the file will be,
 * what it will not carry, then one button. The export runs in the browser and frame by frame; the sheet
 * can be closed while it runs and editing goes on, because the file is made from the film as it was
 * when the button was pressed.
 */
export function ExportSheet({ api, extras = null }: { api: EditorApi; extras?: ComposerProject | null }) {
  const { copy, doc, sequence } = api;
  const e = copy.export;
  const job = useSyncExternalStore(subscribeExportJob, exportJobSnapshot, idleExportJob);
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(browserCanExport()), []);
  useEffect(() => watchExportJob(), []);

  const open = (Object.keys(api.openCount) as EditorWorkspace[]).filter((workspace) => api.openCount[workspace] > 0);
  const openTotal = open.reduce((sum, workspace) => sum + api.openCount[workspace], 0);
  const frames = totalFrames(sequence);
  const empty = frames === 0;
  const missing = notIncluded({ sequence, doc, extras });
  const running = job.status === 'running';

  const start = () => {
    if (empty || !supported || running) return;
    startExport({
      sequence,
      reframe: doc.reframe,
      extras,
      burnCaptions: burnsCaptions(doc),
      captionText: writesCaptionFile(doc, sequence) ? captionsToSrt(sequence.captions, sequence.fps) : null,
      notify: (outcome) => api.say(outcome === 'done' ? e.toastDone : e.toastFailed),
    });
  };

  return (
    <div className={styles.exportSheet} role="dialog" aria-label={e.heading} data-editor-export-sheet data-editor-export-status={job.status}>
      <header className={styles.panelHead}>
        <h2>{e.heading}</h2>
        <button type="button" className={styles.iconBtn} onClick={() => api.setExportOpen(false)} aria-label={copy.assist.dismiss} title={copy.assist.dismiss}>
          <EditorIcon name="close" />
        </button>
      </header>
      <section className={styles.section}>
        <h3>{e.checks}</h3>
        <p className={styles.note}>{openTotal > 0 ? fill(e.open, { count: openTotal }) : e.clear}</p>
        {open.length > 0 && (
          <ul className={styles.findings}>
            {open.map((workspace) => (
              <li key={workspace} className={styles.finding}>
                <p>{copy.workspaces[workspace]} · {api.openCount[workspace]}</p>
                <button
                  type="button"
                  className={styles.fixBtn}
                  onClick={() => {
                    api.setWorkspace(workspace);
                    api.setExportOpen(false);
                  }}
                >
                  {e.show}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <dl className={styles.exportFacts}>
        <div>
          <dt>{copy.cut.film.shape}</dt>
          <dd>{sequence.aspect} · {sequence.fps} fps · {e.file}</dd>
        </div>
        <div>
          <dt>{e.length}</dt>
          <dd data-editor-export-length>{formatTimecode(frames, sequence.fps)}</dd>
        </div>
        <div>
          <dt>{e.captions}</dt>
          <dd>{sequence.captions.length > 0 ? copy.captions.output[doc.captionSettings.output] : e.captionsNone}</dd>
        </div>
      </dl>
      {missing.length > 0 && (
        <section className={styles.section} data-editor-export-missing={missing.join(' ')}>
          <h3>{e.missingHeading}</h3>
          <ul className={styles.exportMissing}>
            {missing.map((key) => (
              <li key={key}>{e.missing[key]}</li>
            ))}
          </ul>
        </section>
      )}
      <ExportStatus job={job} copy={e} />
      {running ? (
        <button type="button" className={styles.fixBtn} onClick={cancelExport} data-editor-export-cancel>
          {e.cancel}
        </button>
      ) : (
        <>
          {(empty || !supported) && <p className={styles.note}>{empty ? e.empty : e.unsupported}</p>}
          <button type="button" className={styles.exportBtn} onClick={start} disabled={empty || !supported} data-editor-export-start>
            <EditorIcon name="download" />
            {job.status === 'failed' && job.reason !== 'cancelled' ? e.retry : e.start}
          </button>
        </>
      )}
    </div>
  );
}

type ExportCopy = EditorApi['copy']['export'];

function ExportStatus({ job, copy: e }: { job: ExportJob; copy: ExportCopy }) {
  if (job.status === 'running') {
    const { phase, done, total } = job.progress;
    const share = total > 0 ? done / total : 0;
    const percent = Math.round(phase === 'video' ? share * 90 : phase === 'audio' ? 90 + share * 8 : 98 + share * 2);
    const label = phase === 'video' ? fill(e.progressVideo, { done, total }) : phase === 'audio' ? e.progressAudio : e.progressWriting;
    return (
      <div className={styles.exportRun} data-editor-export-progress={phase === 'video' ? `${done}/${total}` : phase}>
        <div className={styles.exportBar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <i style={{ width: `${percent}%` }} />
        </div>
        <p className={styles.exportCount} aria-live="polite">{label}</p>
        <p className={styles.note}>{e.keepEditing}</p>
      </div>
    );
  }
  if (job.status === 'done') {
    return (
      <div className={styles.exportRun} data-editor-export-done={job.filename} data-editor-export-ms={job.elapsedMs}>
        <p className={styles.exportCount} role="status">{e.done}</p>
        <p className={styles.note}>{fill(e.doneFacts, { size: formatBytes(job.bytes), length: formatTimecode(job.frames, job.fps) })}</p>
        <p className={styles.exportLinks}>
          <a href={job.url} download={job.filename} data-editor-export-again>
            {e.downloadAgain}
          </a>
          {job.captionFile && (
            <a href={job.captionFile.url} download={job.captionFile.filename} data-editor-export-captions>
              {e.captionFile}
            </a>
          )}
        </p>
      </div>
    );
  }
  if (job.status === 'failed') {
    const sentence =
      job.reason === 'frame'
        ? fill(e.failed.frame, { time: formatTimecode(job.frame ?? 0, job.fps), clip: job.clip ?? '' })
        : job.reason === 'load'
          ? fill(e.failed.load, { clip: job.clip ?? '' })
          : e.failed[job.reason];
    return (
      <p className={job.reason === 'cancelled' ? styles.note : styles.exportError} role={job.reason === 'cancelled' ? 'status' : 'alert'} data-editor-export-failed={job.reason}>
        {sentence}
      </p>
    );
  }
  return null;
}
