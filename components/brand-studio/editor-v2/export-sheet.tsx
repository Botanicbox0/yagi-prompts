'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { fill } from '@/components/brand-studio/copy';
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { burnsCaptions, formatBytes, notIncluded, writesCaptionFile } from '@/lib/brand-studio/editor-v2/export-plan';
import { formatTimecode, totalFrames } from '@/lib/brand-studio/editor-v2/frames';
import { captionsToSrt, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { captionsOnFrames } from '@/lib/brand-studio/editor-v2/stored';
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
 *
 * On the organization's own film the file also carries what the stored film holds besides the cuts
 * (`api.filmForExport()`: captions, colour grade, music, sound effects, still overlays made in the
 * current editor), read when the sheet opens to name what cannot go in, and read again the moment the
 * export starts. The sample film's workspaces (findings, looks, titles, sample music, caption styles)
 * have no part in it there. People who may only look at the film cannot export it.
 */
export function ExportSheet({ api }: { api: EditorApi }) {
  const { copy, doc, sequence } = api;
  const e = copy.export;
  const job = useSyncExternalStore(subscribeExportJob, exportJobSnapshot, idleExportJob);
  const [supported, setSupported] = useState(true);
  const [extras, setExtras] = useState<ComposerProject | null>(null);
  useEffect(() => setSupported(browserCanExport()), []);
  useEffect(() => watchExportJob(), []);
  const { real, filmForExport } = api;
  useEffect(() => {
    if (real) setExtras(filmForExport());
  }, [real, filmForExport, sequence]);

  // The sample film's document (looks, titles, music, sound fixes, caption output) says nothing about a real film.
  const sampleDoc = real ? null : doc;
  const open = real ? [] : (Object.keys(api.openCount) as EditorWorkspace[]).filter((workspace) => api.openCount[workspace] > 0);
  const openTotal = open.reduce((sum, workspace) => sum + api.openCount[workspace], 0);
  const frames = totalFrames(sequence);
  const empty = frames === 0;
  const missing = notIncluded({ sequence, doc: sampleDoc, extras: real ? extras : null });
  const running = job.status === 'running';
  const blocked = empty || !supported || api.readOnly;

  const start = () => {
    if (blocked || running) return;
    // The stored film as it is the moment export starts, with whatever waited to be saved written first.
    // Its captions are the ones burned in: exactly what is stored, on this film's frames.
    const film = real ? filmForExport() : null;
    startExport({
      sequence: film ? { ...sequence, captions: captionsOnFrames(film.captions, sequence.fps) } : sequence,
      reframe: doc.reframe,
      extras: film,
      burnCaptions: burnsCaptions(sampleDoc),
      captionText: writesCaptionFile(sampleDoc, sequence) ? captionsToSrt(sequence.captions, sequence.fps) : null,
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
      {!real && (
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
      )}
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
          <dd>{sequence.captions.length > 0 ? copy.captions.output[sampleDoc ? sampleDoc.captionSettings.output : 'burn'] : e.captionsNone}</dd>
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
          {blocked && (
            <p className={styles.note} data-editor-export-blocked={api.readOnly ? 'read-only' : empty ? 'empty' : 'unsupported'}>
              {api.readOnly ? copy.real.readOnly : empty ? e.empty : e.unsupported}
            </p>
          )}
          <button type="button" className={styles.exportBtn} onClick={start} disabled={blocked} data-editor-export-start>
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
