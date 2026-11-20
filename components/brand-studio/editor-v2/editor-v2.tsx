'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { EDITOR_WORKSPACES, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { actionFor, bindingFromEvent, formatBinding, typingTarget } from '@/lib/brand-studio/editor-v2/shortcuts';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import { Assistant } from './assistant';
import { ExportSheet } from './export-sheet';
import { EditorIcon } from './icons';
import { ActionPanel, Materials } from './panels';
import { Preview } from './preview';
import { ShortcutsPanel } from './shortcuts-panel';
import { Timeline } from './timeline';
import { useEditor, type EditorApi, type RealFilmOptions } from './use-editor';
import styles from './editor-v2.module.css';

export interface EditorV2Props {
  copy: StudioEditorCopy;
  currentEditorHref: string;
  initialWorkspace?: EditorWorkspace;
  /** The organization's own film (V1). `null` runs the sample film (`?sample=1`), as the prototype did. */
  real: (RealFilmOptions & { organizationName: string }) | null;
}

/**
 * Editing studio v2 (docs/BRAND-EDITING-STUDIO-V2.md).
 *
 * One preview and one timeline, four workspaces around them. The left column holds what you bring in
 * (clips, looks and references, music, the script), the right column what you can get done for the
 * current scope, and "말로 편집" sits between the preview and the timeline in every workspace.
 *
 * With `real` it opens the organization's film, the one the current editor opens, on frames, and saves
 * the cuts back (V1). Only cutting is real there; colour, sound and captions are locked and say so.
 * Without it, it runs the sample film and keeps everything in memory.
 */
export function EditorV2({ copy, currentEditorHref, initialWorkspace, real }: EditorV2Props) {
  const api = useEditor(copy, { real, initialWorkspace });
  const latest = useRef<EditorApi>(api);
  latest.current = api;

  // Keys: the physical key and its modifiers name a binding, the person's shortcut map names the
  // action. Nothing fires while someone is typing or composing Korean, and a focused button or slider
  // keeps the keys that operate it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (typingTarget(target as { tagName?: string; isContentEditable?: boolean; type?: string } | null, event.isComposing, event.keyCode)) return;
      const editor = latest.current;
      if (editor.shortcutsOpen) {
        if (event.code === 'Escape') editor.setShortcutsOpen(false);
        return;
      }
      const action = actionFor(bindingFromEvent(event, editor.mac), editor.shortcutMap);
      if (!action) return;
      const tag = target?.tagName;
      if ((tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') && (event.code === 'Space' || event.code === 'Enter')) return;
      if ((tag === 'INPUT' || target?.getAttribute('role') === 'slider') && /^(Arrow|Home|End)/.test(event.code)) return;
      event.preventDefault();
      editor.runAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={styles.root}
      data-studio-editor-v2
      data-ws={api.workspace}
      data-dock={api.assistDock}
      data-editor-mode={api.real ? 'real' : 'sample'}
      data-editor-status={api.status}
      data-editor-read-only={api.readOnly ? '' : undefined}
    >
      <header className={styles.top}>
        <div className={styles.topLeft}>
          <a className={styles.iconBtn} href={currentEditorHref} aria-label={copy.notice.current} title={copy.notice.current} data-editor-current>
            <EditorIcon name="back" />
          </a>
          {real ? (
            <>
              <h1>{fill(copy.real.filmName, { name: real.organizationName })}</h1>
              {api.readOnly ? (
                <HeaderNotice state="read-only" full={copy.real.readOnly} short={copy.real.readOnlyShort} />
              ) : api.storageOk ? (
                <HeaderNotice state="saved" full={copy.real.notice} short={copy.real.noticeShort} />
              ) : (
                <HeaderNotice state="no-storage" full={copy.real.noStorage} short={copy.real.noStorageShort} />
              )}
            </>
          ) : (
            <>
              <h1>{copy.filmName}</h1>
              <span className={styles.noticeBadge} title={copy.notice.body} data-editor-notice>{copy.notice.badge}</span>
              <HeaderNotice state="sample" full={copy.notice.body} short="" />
            </>
          )}
        </div>
        <nav className={styles.workspaces} aria-label={copy.top.workspaceLabel}>
          {EDITOR_WORKSPACES.map((workspace) => (
            <button
              key={workspace}
              type="button"
              aria-pressed={api.workspace === workspace}
              onClick={() => api.setWorkspace(workspace)}
              data-editor-workspace={workspace}
              data-locked={api.real && workspace !== 'cut' ? '' : undefined}
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
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => api.setShortcutsOpen(true)}
            aria-label={copy.top.shortcuts}
            title={`${copy.top.shortcuts} (${api.shortcutMap.shortcuts[0] ? formatBinding(api.shortcutMap.shortcuts[0], api.mac).join(' ') : ''})`}
            data-editor-shortcuts-button
          >
            <EditorIcon name="keyboard" />
          </button>
          {!api.real && (
            <button type="button" className={styles.topBtn} onClick={() => api.say(copy.review.inert)}>
              <EditorIcon name="review" />
              {copy.top.review}
            </button>
          )}
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
      {api.shortcutsOpen && <ShortcutsPanel api={api} />}
      {api.toast && <p className={styles.toast} role="status" data-editor-toast>{api.toast}</p>}
    </div>
  );
}

/**
 * The line beside the film's name. The whole sentence shows where the header has room for it; where it
 * does not (1280-wide screens, a long organization name) a short form shows instead, never a sentence
 * cut off in the middle, and the whole sentence stays in the tooltip and for screen readers.
 */
function HeaderNotice({ full, short, state }: { full: string; short: string; state: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const room = box.current;
    const sentence = measure.current;
    if (!room || !sentence) return;
    const check = () => setFits(sentence.offsetWidth <= room.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(room);
    return () => observer.disconnect();
  }, [full]);
  return (
    <span ref={box} className={styles.noticeBody} title={full} data-editor-real-notice={state === 'sample' ? undefined : state} data-editor-line-shown={fits ? 'full' : 'short'}>
      <span ref={measure} className={styles.noticeMeasure} aria-hidden="true">
        {full}
      </span>
      {fits ? (
        full
      ) : (
        <>
          <span aria-hidden="true">{short}</span>
          <span className={styles.srOnly}>{full}</span>
        </>
      )}
    </span>
  );
}
