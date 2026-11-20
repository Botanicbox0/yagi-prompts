'use client';

import { useEffect, useRef } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { EDITOR_WORKSPACES, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import { Assistant } from './assistant';
import { EditorIcon } from './icons';
import { ActionPanel, Materials } from './panels';
import { Preview } from './preview';
import { Timeline } from './timeline';
import { useEditor, type EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

/**
 * Editing studio v2 — structure prototype (docs/BRAND-EDITING-STUDIO-V2.md).
 *
 * One preview and one timeline, four workspaces around them. The left column holds what you bring in
 * (clips, looks and references, music, the script), the right column what you can get done for the
 * current scope, and "말로 편집" sits between the preview and the timeline in every workspace. It runs
 * on sample footage and keeps everything in memory: no request, no storage, no file.
 */
export function EditorV2({ copy, currentEditorHref }: { copy: StudioEditorCopy; currentEditorHref: string }) {
  const api = useEditor(copy);
  const latest = useRef<EditorApi>(api);
  latest.current = api;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const editor = latest.current;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (mod && key === 'z') {
        event.preventDefault();
        return event.shiftKey ? editor.redo() : editor.undo();
      }
      if (mod && key === 'y') {
        event.preventDefault();
        return editor.redo();
      }
      if (mod || event.altKey) return;
      if (key === ' ') {
        if (target && target.tagName === 'BUTTON') return;
        event.preventDefault();
        return editor.setPlaying(!editor.playing);
      }
      if (key === 's') return editor.splitAtPlayhead();
      if (key === 'q') return editor.trimToPlayhead('start');
      if (key === 'w') return editor.trimToPlayhead('end');
      if (key === 'Delete' || key === 'Backspace') {
        if (editor.selectedTitleId) return editor.removeTitle(editor.selectedTitleId);
        if (editor.selection.length > 0) return editor.removeClips(editor.selection);
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (target && target.getAttribute('role') === 'slider') return;
        event.preventDefault();
        editor.setPlaying(false);
        return editor.seek(editor.playheadSec + (key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
      }
      if (key === 'Escape') {
        if (editor.exportOpen) return editor.setExportOpen(false);
        return editor.clearSelection();
      }
      const index = ['1', '2', '3', '4'].indexOf(key);
      if (index >= 0) editor.setWorkspace(EDITOR_WORKSPACES[index]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={styles.root} data-studio-editor-v2 data-ws={api.workspace} data-dock={api.assistDock}>
      <header className={styles.top}>
        <div className={styles.topLeft}>
          <a className={styles.iconBtn} href={currentEditorHref} aria-label={copy.notice.current} title={copy.notice.current}>
            <EditorIcon name="back" />
          </a>
          <h1>{copy.filmName}</h1>
          <span className={styles.noticeBadge} data-editor-notice>{copy.notice.badge}</span>
          <span className={styles.noticeBody}>{copy.notice.body}</span>
        </div>
        <nav className={styles.workspaces} aria-label={copy.top.workspaceLabel}>
          {EDITOR_WORKSPACES.map((workspace) => (
            <button
              key={workspace}
              type="button"
              aria-pressed={api.workspace === workspace}
              onClick={() => api.setWorkspace(workspace)}
              data-editor-workspace={workspace}
              title={api.openCount[workspace] > 0 ? `${copy.panel.found} ${api.openCount[workspace]}` : undefined}
            >
              {copy.workspaces[workspace]}
              {api.openCount[workspace] > 0 && <i data-editor-open={api.openCount[workspace]}>{api.openCount[workspace]}</i>}
            </button>
          ))}
        </nav>
        <div className={styles.topRight}>
          <button type="button" className={styles.iconBtn} onClick={api.undo} disabled={!api.canUndo} aria-label={copy.top.undo} title={copy.top.undo} data-editor-undo>
            <EditorIcon name="undo" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={api.redo} disabled={!api.canRedo} aria-label={copy.top.redo} title={copy.top.redo}>
            <EditorIcon name="redo" />
          </button>
          <button type="button" className={styles.topBtn} onClick={() => api.say(copy.review.inert)}>
            <EditorIcon name="review" />
            {copy.top.review}
          </button>
          <button type="button" className={styles.exportBtn} onClick={() => api.setExportOpen(!api.exportOpen)} aria-expanded={api.exportOpen} data-editor-export>
            <EditorIcon name="download" />
            {copy.top.export}
          </button>
        </div>
      </header>

      <Materials api={api} />
      <Preview api={api} />
      <ActionPanel api={api} />
      {api.assistDock === 'side' && <Assistant api={api} placement="side" />}

      <div className={styles.bottom}>
        {api.assistDock === 'bar' && <Assistant api={api} placement="bar" />}
        <Timeline api={api} />
      </div>

      {api.exportOpen && <ExportSheet api={api} />}
      {api.toast && <p className={styles.toast} role="status" data-editor-toast>{api.toast}</p>}
    </div>
  );
}

function ExportSheet({ api }: { api: EditorApi }) {
  const { copy, doc, project } = api;
  const e = copy.export;
  const open = (Object.keys(api.openCount) as EditorWorkspace[]).filter((workspace) => api.openCount[workspace] > 0);
  const total = open.reduce((sum, workspace) => sum + api.openCount[workspace], 0);
  return (
    <div className={styles.exportSheet} role="dialog" aria-label={e.heading} data-editor-export-sheet>
      <header className={styles.panelHead}>
        <h2>{e.heading}</h2>
        <button type="button" className={styles.iconBtn} onClick={() => api.setExportOpen(false)} aria-label={copy.assist.dismiss} title={copy.assist.dismiss}>
          <EditorIcon name="close" />
        </button>
      </header>
      <section className={styles.section}>
        <h3>{e.checks}</h3>
        <p className={styles.note}>{total > 0 ? fill(e.open, { count: total }) : e.clear}</p>
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
          <dd>{project.aspect} · {e.file}</dd>
        </div>
        <div>
          <dt>{e.captions}</dt>
          <dd>{project.captions.length > 0 ? copy.captions.output[doc.captionSettings.output] : e.captionsNone}</dd>
        </div>
        <div>
          <dt>{e.loudness}</dt>
          <dd>{doc.sound.loudness ? e.loudnessOn : e.loudnessOff}</dd>
        </div>
      </dl>
      <button type="button" className={styles.exportBtn} onClick={() => api.say(e.inert)}>
        <EditorIcon name="download" />
        {e.start}
      </button>
    </div>
  );
}
