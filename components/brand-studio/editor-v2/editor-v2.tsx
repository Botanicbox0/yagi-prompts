'use client';

import { useEffect, useRef } from 'react';
import { EDITOR_WORKSPACES } from '@/lib/brand-studio/editor-v2/model';
import { actionFor, bindingFromEvent, formatBinding, typingTarget } from '@/lib/brand-studio/editor-v2/shortcuts';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import { Assistant } from './assistant';
import { ExportSheet } from './export-sheet';
import { EditorIcon } from './icons';
import { ActionPanel, Materials } from './panels';
import { Preview } from './preview';
import { ShortcutsPanel } from './shortcuts-panel';
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
      {api.shortcutsOpen && <ShortcutsPanel api={api} />}
      {api.toast && <p className={styles.toast} role="status" data-editor-toast>{api.toast}</p>}
    </div>
  );
}
