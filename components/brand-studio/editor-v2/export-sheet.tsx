'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { unevenWarning, type ExportPath, type ExportPathOverride } from '@/lib/brand-studio/editor-v2/decode-plan';
import { LAST_FRAME_QUIET_MAX, SOUND_BYTES_LIMIT, burnsCaptions, formatBytes, notIncluded, writesCaptionFile } from '@/lib/brand-studio/editor-v2/export-plan';
import { formatTimecode, totalFrames, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { captionsToSrt, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { filmContents } from '@/lib/brand-studio/editor-v2/film-contents';
import type { StoredFilmView } from '@/lib/brand-studio/editor-v2/stored';
import { browserCanExport, plannedPath, type SourcePath } from './export-film';
import { cancelExport, exportJobSnapshot, idleExportJob, startExport, subscribeExportJob, watchExportJob, type ExportJob } from './export-job';
import { FilmContentsList } from './film-contents-list';
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
 *
 * `exportPath` is the developer's override for the proof (`?exportPath=seek|decoder`, read by the page);
 * the sheet shows nothing of it.
 */
export function ExportSheet({ api, exportPath = null }: { api: EditorApi; exportPath?: ExportPathOverride }) {
  const { copy, doc, sequence } = api;
  const e = copy.export;
  const job = useSyncExternalStore(subscribeExportJob, exportJobSnapshot, idleExportJob);
  const [supported, setSupported] = useState(true);
  const [view, setView] = useState<StoredFilmView | null>(null);
  /** The path each uneven footage will take: through the decoder it follows its own timestamps (spec F, F5). */
  const [paths, setPaths] = useState<Record<string, ExportPath>>({});
  useEffect(() => setSupported(browserCanExport()), []);
  useEffect(() => watchExportJob(), []);
  const { real, filmForExport, variableRates } = api;
  useEffect(() => {
    if (real) setView(filmForExport());
  }, [real, filmForExport, sequence]);
  useEffect(() => {
    if (!real) return;
    let alive = true;
    const uneven = [...new Set(sequence.clips.map((clip) => clip.srcUrl))].filter((src) => variableRates[src]);
    const ratesOf = (src: string) => sequence.clips.filter((clip) => clip.srcUrl === src).map((clip) => clip.sourceFps);
    void Promise.all(uneven.map(async (src) => [src, await plannedPath(src, exportPath, ratesOf(src)).catch((): ExportPath => 'seek')] as const)).then((entries) => {
      if (alive && entries.length > 0) setPaths((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      alive = false;
    };
  }, [real, sequence, variableRates, exportPath]);

  // The sample film's document (looks, titles, music, sound fixes, caption output) says nothing about a real film.
  const sampleDoc = real ? null : doc;
  const open = real ? [] : (Object.keys(api.openCount) as EditorWorkspace[]).filter((workspace) => api.openCount[workspace] > 0);
  const openTotal = open.reduce((sum, workspace) => sum + api.openCount[workspace], 0);
  const frames = totalFrames(sequence);
  const empty = frames === 0;
  const missing = notIncluded({ sequence, doc: sampleDoc, extras: real ? (view?.film ?? null) : null });
  const running = job.status === 'running';
  // A cut whose footage rate is not measured cannot be exported frame-exactly: refused before it starts.
  const unmeasured = real ? sequence.clips.find((clip) => api.unknownRates[clip.srcUrl]) : undefined;
  const uneven = real ? unevenClipOnSeek(sequence, variableRates, paths) : undefined;
  const blocked = empty || !supported || api.readOnly || !!unmeasured;
  const blockedAs = api.readOnly ? 'read-only' : empty ? 'empty' : !supported ? 'unsupported' : 'rate';
  const blockedSentence =
    blockedAs === 'read-only'
      ? copy.real.readOnly
      : blockedAs === 'empty'
        ? e.empty
        : blockedAs === 'unsupported'
          ? e.unsupported
          : fill(e.rateUnknown, { clip: unmeasured?.label ?? '' });

  const start = () => {
    if (blocked || running) return;
    // The stored film as it is the moment export starts, with whatever waited to be saved written first.
    // Its captions are the ones burned in: exactly what is stored, each at its offset into its cut.
    const film = real ? filmForExport() : null;
    startExport({
      sequence: film ? film.sequence : sequence,
      reframe: doc.reframe,
      // A real film is framed like the current editor's file (and v2's preview of it): no control of its own yet.
      framing: real ? 'current' : 'reframe',
      extras: film ? film.film : null,
      burnCaptions: burnsCaptions(sampleDoc),
      captionText: writesCaptionFile(sampleDoc, sequence) ? captionsToSrt(sequence.captions, sequence.fps) : null,
      notify: (outcome) => api.say(outcome === 'done' ? e.toastDone : e.toastFailed),
      path: exportPath,
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
      {real && view && (
        <section className={styles.section} data-editor-export-contents>
          <h3>{e.contents.heading}</h3>
          <FilmContentsList contents={filmContents(view.sequence, view.film, view.anchor)} copy={copy} gradeNames={api.gradeNames} withCuts />
        </section>
      )}
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
            <p className={styles.note} data-editor-export-blocked={blockedAs}>
              {blockedSentence}
            </p>
          )}
          {!blocked && uneven && (
            <p className={styles.note} data-editor-export-variable>
              {fill(e.variable, { clip: uneven.label })}
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

/**
 * The cut the "frames are not evenly spaced, a few may differ" line names: footage that is uneven AND will
 * be seeked (or whose path is not known yet). Through the decoder the file follows the footage's own
 * timestamps, so the line would not be true there (spec F, F5).
 */
export function unevenClipOnSeek(sequence: FrameSequence, variable: Readonly<Record<string, true>>, paths: Readonly<Record<string, ExportPath>>): FrameClip | undefined {
  return sequence.clips.find((clip) => unevenWarning(!!variable[clip.srcUrl], paths[clip.srcUrl] ?? null));
}

/** `decoder` / `seek` when every source took that path whole, `mixed` otherwise (for the proof). */
function pathSummary(paths: readonly SourcePath[]): 'decoder' | 'seek' | 'mixed' | 'none' {
  if (paths.length === 0) return 'none';
  if (paths.every((entry) => entry.seeked === 0 && entry.path === 'decoder')) return 'decoder';
  if (paths.every((entry) => entry.decoded === 0 && entry.path === 'seek')) return 'seek';
  return 'mixed';
}

export function ExportStatus({ job, copy: e }: { job: ExportJob; copy: ExportCopy }) {
  if (job.status === 'running') {
    const { phase, done, total } = job.progress;
    const share = total > 0 ? done / total : 0;
    const percent = Math.round(phase === 'video' ? share * 90 : phase === 'audio' ? 90 + share * 8 : 98 + share * 2);
    const label = phase === 'video' ? fill(e.progressVideo, { done, total }) : phase === 'audio' ? e.progressAudio : e.progressWriting;
    return (
      <div
        className={styles.exportRun}
        data-editor-export-progress={phase === 'video' ? `${done}/${total}` : phase}
        data-editor-export-path-now={job.progress.path ?? ''}
        data-editor-export-restarts={job.restarts}
      >
        <div className={styles.exportBar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <i style={{ width: `${percent}%` }} />
        </div>
        <p className={styles.exportCount} aria-live="polite">{label}</p>
        {job.restarts > 0 && (
          <p className={styles.note} role="status" data-editor-export-restarted={job.restartedPhase ?? 'video'}>
            {job.restartedPhase === 'audio' ? e.restartedSound : e.restarted}
          </p>
        )}
        {job.slow && (
          <p className={styles.note} role="status" data-editor-export-slow>
            {e.slowWindow}
          </p>
        )}
        <p className={styles.note}>{e.keepEditing}</p>
      </div>
    );
  }
  if (job.status === 'done') {
    return (
      <div
        className={styles.exportRun}
        data-editor-export-done={job.filename}
        data-editor-export-ms={job.elapsedMs}
        data-editor-export-path={pathSummary(job.paths)}
        data-editor-export-restarts={job.restarts}
        data-editor-export-paths={JSON.stringify(job.paths.map(({ clip, path, reason, decoded, seeked, bytesRead, fileBytes, requests, reopened, reclaimed }) => ({ clip, path, reason, decoded, seeked, bytesRead, fileBytes, requests, reopened, reclaimed })))}
      >
        <p className={styles.exportCount} role="status">{e.done}</p>
        <p className={styles.note}>{fill(e.doneFacts, { size: formatBytes(job.bytes), length: formatTimecode(job.frames, job.fps) })}</p>
        {job.warnings.map((warning, index) =>
          warning.kind === 'soundPosition' ? (
            <p key={`${warning.kind}-${index}`} className={styles.note} data-editor-export-warning={warning.kind}>
              {fill(e.warnSoundPosition, { clip: warning.clip })}
            </p>
          ) : warning.kind === 'lastFrame' && warning.pictures <= LAST_FRAME_QUIET_MAX ? (
            <p key={`${warning.kind}-${index}`} className={styles.note} data-editor-export-warning={warning.kind} data-editor-export-filled={warning.frames}>
              {fill(e.warnLastFrame, { clip: warning.clip, count: warning.frames })}
            </p>
          ) : warning.kind === 'lastFrame' ? (
            // More than a couple of missing pictures is not a quiet note: the person should look at that part.
            <p key={`${warning.kind}-${index}`} className={styles.exportError} role="alert" data-editor-export-warning={warning.kind} data-editor-export-filled={warning.frames}>
              {fill(e.warnLastFrameMany, { clip: warning.clip, count: warning.frames })}
            </p>
          ) : (
            <p key={`${warning.kind}-${index}`} className={styles.exportError} role="alert" data-editor-export-warning={warning.kind}>
              {fill(e.warnSound, { clip: warning.clip })}
            </p>
          ),
        )}
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
          : job.reason === 'memory'
            ? fill(e.failed.memory, { total: formatBytes(job.bytes ?? 0), limit: formatBytes(SOUND_BYTES_LIMIT) })
            : e.failed[job.reason];
    return (
      <p className={job.reason === 'cancelled' ? styles.note : styles.exportError} role={job.reason === 'cancelled' ? 'status' : 'alert'} data-editor-export-failed={job.reason}>
        {sentence}
      </p>
    );
  }
  return null;
}
