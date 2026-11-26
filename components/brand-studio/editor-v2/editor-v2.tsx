'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { ProjectChip, ProjectGoneNotice, useProjectSpine } from '@/components/brand-studio/project-chip';
import { WorkspaceBell } from '@/components/brand-workspace/bell';
import type { ExportPathOverride } from '@/lib/brand-studio/editor-v2/decode-plan';
import { EDITOR_WORKSPACES, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { filmHasSpeedTheOldEditorChanges } from '@/lib/brand-studio/editor-v2/stored';
import { actionFor, bindingFromEvent, formatBinding, typingTarget } from '@/lib/brand-studio/editor-v2/shortcuts';
import { brandProjectIdOf, type StudioSpineProps } from '@/lib/brand-studio/open-project';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import { Assistant } from './assistant';
import { ExportShareHost, shareWindowOpen, type ExportKeepCopy } from './export-keep';
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
  /** The export's picture path forced for the checks (`?exportPath=`); `null` normally. */
  exportPath?: ExportPathOverride;
  /** `false` with `?exportDownload=off`: the finished file does not download by itself (checks only). */
  autoDownload?: boolean;
  /** The organization's own film (V1). `null` runs the sample film (`?sample=1`), as the prototype did. */
  real: (RealFilmOptions & { organizationName: string }) | null;
  /**
   * The current editor's words for "에셋에 저장" and "검수 · 공유" on the finished export, and the review share
   * window's language (export-keep.tsx). The page passes them for the organization's own film only.
   */
  keep?: { copy: ExportKeepCopy; locale: 'ko' | 'en' } | null;
  /** Brand project spine prop (real film only, present when `BRAND_PROJECT_SPINE` is open for a member). */
  spine?: StudioSpineProps | null;
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
export function EditorV2({ copy, currentEditorHref, initialWorkspace, exportPath = null, autoDownload = true, real, keep = null, spine = null }: EditorV2Props) {
  const spineCtx = useProjectSpine();
  const spineOpen = real ? (spineCtx?.open ?? spine?.open ?? undefined) : undefined;
  const spineActive = Boolean(spineOpen);
  const openBrandProjectId = spineOpen ? brandProjectIdOf(spineOpen) : undefined;
  const api = useEditor(copy, { real, initialWorkspace });
  // "에셋에 저장" and "검수 · 공유" are for people who may change the organization's own film; the review share
  // window is titled by the film's name, as the header shows it. Anyone else gets neither, nor the window's host.
  const exportKeep = real && keep && real.canEdit ? { copy: keep.copy, title: fill(copy.real.filmName, { name: real.organizationName }) } : null;
  const latest = useRef<EditorApi>(api);
  latest.current = api;

  // Keys: the physical key and its modifiers name a binding, the person's shortcut map names the
  // action. Nothing fires while someone is typing or composing Korean, and a focused button or slider
  // keeps the keys that operate it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (typingTarget(target as { tagName?: string; isContentEditable?: boolean; type?: string } | null, event.isComposing, event.keyCode)) return;
      // The review share window ("검수 · 공유", export-keep.tsx) is modal: while it is open, keys are its own and
      // never edit the film behind it (it closes itself on Escape).
      if (shareWindowOpen()) return;
      const editor = latest.current;
      if (editor.shortcutsOpen) {
        if (event.code === 'Escape') editor.setShortcutsOpen(false);
        return;
      }
      const action = actionFor(bindingFromEvent(event, editor.mac), editor.shortcutMap);
      if (!action) return;
      const tag = target?.tagName;
      if ((tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') && (event.code === 'Space' || event.code === 'Enter')) return;
      if (target?.hasAttribute('data-curve-point') && /^(Arrow|Home|End|Backspace|Delete)/.test(event.code)) return;
      if ((tag === 'INPUT' || target?.getAttribute('role') === 'slider') && /^(Arrow|Home|End|PageUp|PageDown)/.test(event.code)) return;
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
          <OldEditorLink copy={copy} href={currentEditorHref} speedDiffers={api.real && filmHasSpeedTheOldEditorChanges(api.sequence)} />
          {real ? (
            <>
              <h1>{fill(copy.real.filmName, { name: real.organizationName })}</h1>
              {spineActive ? <ProjectChip /> : null}
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
          <WorkspaceBell size="compact" />
        </div>
      </header>
      {spineActive ? <ProjectGoneNotice /> : null}

      <Materials api={api} />
      <Preview api={api} />
      <ActionPanel api={api} classicHref={currentEditorHref} />
      {api.assistDock === 'side' && <Assistant api={api} placement="side" />}

      <div className={styles.bottom}>
        {api.assistDock === 'bar' && <Assistant api={api} placement="bar" />}
        <Timeline api={api} />
      </div>

      {api.conflict && (
        <div className={styles.conflictBar} role="alert" data-editor-conflict>
          <p>{copy.real.conflict.body}</p>
          <button type="button" className={styles.fixBtn} onClick={api.keepThisFilm} data-editor-conflict-keep>
            {copy.real.conflict.keep}
          </button>
          <button type="button" className={styles.fixBtn} onClick={api.openOtherFilm} data-editor-conflict-open>
            {copy.real.conflict.open}
          </button>
        </div>
      )}
      {api.exportOpen && (
        <ExportSheet
          api={api}
          exportPath={exportPath}
          autoDownload={autoDownload}
          keep={exportKeep}
          {...(openBrandProjectId ? { brandProjectId: openBrandProjectId } : {})}
        />
      )}
      {real && keep && exportKeep && <ExportShareHost organizationId={real.organizationId} locale={keep.locale} />}
      {api.shortcutsOpen && <ShortcutsPanel api={api} />}
      {api.toast && <p className={styles.toast} role="status" data-editor-toast>{api.toast}</p>}
    </div>
  );
}

/**
 * The header's way back to the earlier editor, as its tooltip: on the organization's film with a cut the
 * earlier editor plays at another speed, the same warning the locked workspaces' link carries (audit B5).
 */
export function oldEditorLinkTitle(copy: StudioEditorCopy, speedDiffers: boolean): string {
  return speedDiffers ? `${copy.notice.current} · ${copy.real.locked.classicSpeed}` : copy.notice.current;
}

/**
 * The header's icon back to the earlier editor. With a cut the earlier editor plays at another speed it carries
 * the warning twice: as its tooltip for the mouse, and as hidden text the link points to (`aria-describedby`) for
 * keyboard and screen-reader users, who never see a tooltip (review item 4). Nothing visible is added.
 */
export function OldEditorLink({ copy, href, speedDiffers }: { copy: StudioEditorCopy; href: string; speedDiffers: boolean }) {
  const noteId = useId();
  return (
    <>
      <a
        className={styles.iconBtn}
        href={href}
        aria-label={copy.notice.current}
        aria-describedby={speedDiffers ? noteId : undefined}
        title={oldEditorLinkTitle(copy, speedDiffers)}
        data-editor-current
      >
        <EditorIcon name="back" />
      </a>
      {speedDiffers && (
        <span id={noteId} className={styles.srOnly}>
          {copy.real.locked.classicSpeed}
        </span>
      )}
    </>
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
