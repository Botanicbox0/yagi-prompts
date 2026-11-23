"use client";
/**
 * The storyboard editor (docs/BRAND-ROOMS.md §5), shared by the brand (its own boards, through
 * `/api/brand-rooms/storyboards`) and the YAGI team (`/admin/brand-rooms/storyboards/[id]`, through the
 * registered admin operations). Which door it writes through is the `writer`; the screen is the same.
 *
 * Every change stays local until "임시 저장": drop or pick many pictures (they become cuts in file-name
 * order), paste a block of text and split it into the cuts' descriptions at blank lines, edit the
 * words in place, drag (or press 앞으로/뒤로) to reorder, remove. "공유하기" saves first, then shares.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { interpolate } from "@/lib/i18n/format";
import { STORYBOARD_LIMITS, type StoryboardBoardView, type StoryboardErrorCode, type StoryboardFrameDetail } from "@/lib/brand-rooms/storyboard-contracts";
import type { UploadLimitReason } from "@/lib/brands/upload-limits-format";
import { pictureProblem } from "./api";
import { applyParagraphs, cutsFromFiles, cutsFromFrames, isDirty, moveCut, type DraftCut } from "./editor-model";
import { ConfirmDialog, cutLabel, type StoryboardCopy } from "./views";

export type WriteResult = { ok: true } | { ok: false; code: StoryboardErrorCode; reason?: UploadLimitReason };

export interface StoryboardWriter {
  /** Save the whole working copy. `progress` reports uploaded pictures. */
  save(input: { title: string; cuts: DraftCut[]; original: readonly StoryboardFrameDetail[] }, progress: (done: number, total: number) => void): Promise<WriteResult>;
  share(): Promise<WriteResult>;
}

type Busy = null | "saving" | "sharing";

export function StoryboardEditor({
  board,
  copy,
  writer,
  onSaved,
  onShared,
  onDone,
  shareLabel,
}: {
  board: StoryboardBoardView;
  copy: StoryboardCopy;
  writer: StoryboardWriter;
  /** After a save: reload the board (the editor is keyed on it and starts again from the server's copy). */
  onSaved: () => void;
  onShared: () => void;
  onDone?: () => void;
  shareLabel?: string;
}) {
  const e = copy.editor;
  const [title, setTitle] = useState(board.title);
  const [cuts, setCuts] = useState<DraftCut[]>(() => cutsFromFrames(board.frames));
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ code: StoryboardErrorCode; reason?: UploadLimitReason } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [confirmShare, setConfirmShare] = useState(false);
  const [saved, setSaved] = useState(false);
  const dragKey = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  const dirty = useMemo(() => isDirty(board.frames, cuts, title, board.title), [board.frames, board.title, cuts, title]);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = e.leave;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, e.leave]);

  const addFiles = useCallback(
    (list: FileList | readonly File[] | null) => {
      if (!list) return;
      const files = Array.from(list);
      const bad = files.filter((f) => pictureProblem(f));
      const good = files.filter((f) => !pictureProblem(f));
      const room = STORYBOARD_LIMITS.framesPerBoard - cuts.length;
      const taken = good.slice(0, Math.max(0, room));
      const messages: string[] = bad.map((f) => interpolate(e.badFile, { name: f.name }));
      if (good.length > taken.length) messages.push(interpolate(e.tooMany, { max: STORYBOARD_LIMITS.framesPerBoard }));
      setNotice(messages.length ? messages.join(" ") : null);
      if (taken.length === 0) return;
      const added = cutsFromFiles(taken, (file) => {
        const url = URL.createObjectURL(file);
        previews.current.push(url);
        return url;
      });
      setCuts((current) => [...current, ...added]);
      setSaved(false);
    },
    [cuts.length, e.badFile, e.tooMany],
  );

  const patch = (key: string, field: keyof Pick<DraftCut, "scene" | "shot" | "description" | "camera" | "audio" | "seconds">, value: string) => {
    setCuts((current) => current.map((c) => (c.key === key ? { ...c, [field]: value } : c)));
    setSaved(false);
  };

  const move = (from: number, to: number) => {
    setCuts((current) => moveCut(current, from, to));
    setSaved(false);
  };

  const remove = (key: string) => {
    setCuts((current) => current.filter((c) => c.key !== key));
    setSaved(false);
  };

  const save = useCallback(async (): Promise<boolean> => {
    setBusy("saving");
    setError(null);
    setNotice(null);
    const total = cuts.filter((c) => c.file).length;
    setProgress(total ? { done: 0, total } : null);
    const result = await writer.save({ title: title.trim() || board.title, cuts, original: board.frames }, (done, all) => setProgress({ done, total: all }));
    setProgress(null);
    setBusy(null);
    if (!result.ok) {
      setError({ code: result.code, reason: result.reason });
      return false;
    }
    setSaved(true);
    onSaved();
    return true;
  }, [board.frames, board.title, cuts, onSaved, title, writer]);

  const share = async () => {
    if (dirty && !(await save())) {
      setConfirmShare(false);
      return;
    }
    setBusy("sharing");
    const result = await writer.share();
    setBusy(null);
    setConfirmShare(false);
    if (!result.ok) {
      setError({ code: result.code, reason: result.reason });
      return;
    }
    onShared();
  };

  const onZoneDragOver = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };
  const onZoneDrop = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDropActive(false);
    addFiles(event.dataTransfer.files);
  };

  const status = busy === "saving" ? (progress ? interpolate(e.uploading, { done: progress.done, total: progress.total }) : e.saving) : dirty ? e.unsaved : saved ? e.saved : null;

  return (
    <section className="brs-editor" aria-label={e.label} data-storyboard-editor={board.id}>
      <div className="brs-editor-bar">
        <label className="brs-field brs-field-title">
          <span className="brs-field-label">{e.title}</span>
          <input value={title} maxLength={STORYBOARD_LIMITS.titleMax} onChange={(event) => setTitle(event.target.value)} data-storyboard-title-input />
        </label>
        <div className="brs-editor-tools">
          <button type="button" className="brs-btn" onClick={() => fileInput.current?.click()} disabled={busy !== null} data-storyboard-add>
            {e.addPictures}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
            data-storyboard-file
          />
          <button type="button" className="brs-btn" aria-expanded={pasteOpen} onClick={() => setPasteOpen((v) => !v)} disabled={busy !== null || cuts.length === 0} data-storyboard-paste-toggle>
            {e.pasteText}
          </button>
        </div>
      </div>

      {pasteOpen ? (
        <div className="brs-paste" data-storyboard-paste>
          <label className="brs-field">
            <span className="brs-field-label">{e.pasteHint}</span>
            <textarea rows={6} value={pasteText} placeholder={e.pastePlaceholder} onChange={(event) => setPasteText(event.target.value)} />
          </label>
          <button
            type="button"
            className="brs-btn"
            disabled={!pasteText.trim()}
            onClick={() => {
              const { cuts: next, leftover } = applyParagraphs(cuts, pasteText);
              setCuts(next);
              setSaved(false);
              setNotice(leftover ? interpolate(e.pasteLeftover, { n: leftover }) : null);
              setPasteOpen(false);
              setPasteText("");
            }}
            data-storyboard-paste-apply
          >
            {e.pasteApply}
          </button>
        </div>
      ) : null}

      <div
        className="brs-drop"
        data-active={dropActive || undefined}
        onDragOver={onZoneDragOver}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropActive(false);
        }}
        onDrop={onZoneDrop}
        data-storyboard-drop
      >
        {cuts.length === 0 ? (
          <button type="button" className="brs-drop-empty" onClick={() => fileInput.current?.click()}>
            <span>{dropActive ? e.dropActive : e.empty}</span>
            <span className="brs-muted">{e.drop}</span>
          </button>
        ) : (
          <>
            <p className="brs-hint">{dropActive ? e.dropActive : e.drop}</p>
            <ol className="brs-edit-grid">
              {cuts.map((cut, i) => {
                const label = cutLabel(copy, { scene: cut.scene.trim() || null, shot: cut.shot.trim() || null }, i);
                const id = `${board.id}-${cut.key}`;
                return (
                  <li
                    key={cut.key}
                    className="brs-edit-card"
                    data-storyboard-edit-cut={cut.id ?? "new"}
                    onDragOver={(event) => {
                      if (!dragKey.current) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      if (!dragKey.current) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const from = cuts.findIndex((c) => c.key === dragKey.current);
                      dragKey.current = null;
                      if (from >= 0) move(from, i);
                    }}
                  >
                    <div className="brs-edit-media" style={{ aspectRatio: cut.width && cut.height ? `${cut.width} / ${cut.height}` : undefined }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview or media-store still */}
                      <img src={cut.previewUrl} alt="" />
                      <span
                        className="brs-drag"
                        draggable
                        role="img"
                        aria-label={e.drag}
                        title={e.drag}
                        onDragStart={(event) => {
                          dragKey.current = cut.key;
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", cut.key);
                        }}
                        onDragEnd={() => {
                          dragKey.current = null;
                        }}
                      >
                        <GripIcon />
                      </span>
                      <span className="brs-chip brs-num">{i + 1}</span>
                    </div>
                    <div className="brs-edit-fields">
                      <div className="brs-edit-head">
                        <span className="brs-card-label">{label}</span>
                        <span className="brs-edit-actions">
                          <button type="button" className="brs-icon-btn" onClick={() => move(i, i - 1)} disabled={i === 0 || busy !== null} aria-label={`${label} ${e.moveEarlier}`} title={e.moveEarlier}>
                            <ArrowIcon dir="up" />
                          </button>
                          <button type="button" className="brs-icon-btn" onClick={() => move(i, i + 1)} disabled={i === cuts.length - 1 || busy !== null} aria-label={`${label} ${e.moveLater}`} title={e.moveLater}>
                            <ArrowIcon dir="down" />
                          </button>
                          <button type="button" className="brs-icon-btn" onClick={() => remove(cut.key)} disabled={busy !== null} aria-label={`${label} ${e.remove}`} title={e.remove} data-storyboard-remove>
                            <TrashIcon />
                          </button>
                        </span>
                      </div>
                      <div className="brs-edit-row brs-edit-row-3">
                        <label className="brs-field">
                          <span className="brs-field-label">{e.scene}</span>
                          <input id={`${id}-scene`} value={cut.scene} maxLength={STORYBOARD_LIMITS.labelMax} onChange={(event) => patch(cut.key, "scene", event.target.value)} />
                        </label>
                        <label className="brs-field">
                          <span className="brs-field-label">{e.shot}</span>
                          <input value={cut.shot} maxLength={STORYBOARD_LIMITS.labelMax} onChange={(event) => patch(cut.key, "shot", event.target.value)} />
                        </label>
                        <label className="brs-field">
                          <span className="brs-field-label">{e.seconds}</span>
                          <input inputMode="decimal" value={cut.seconds} placeholder={String(STORYBOARD_LIMITS.defaultSeconds)} onChange={(event) => patch(cut.key, "seconds", event.target.value)} className="brs-num" />
                        </label>
                      </div>
                      <label className="brs-field">
                        <span className="brs-field-label">{e.description}</span>
                        <textarea rows={3} value={cut.description} maxLength={STORYBOARD_LIMITS.descriptionMax} onChange={(event) => patch(cut.key, "description", event.target.value)} data-storyboard-description />
                      </label>
                      <div className="brs-edit-row">
                        <label className="brs-field">
                          <span className="brs-field-label">{e.camera}</span>
                          <input value={cut.camera} maxLength={STORYBOARD_LIMITS.noteMax} onChange={(event) => patch(cut.key, "camera", event.target.value)} />
                        </label>
                        <label className="brs-field">
                          <span className="brs-field-label">{e.audio}</span>
                          <input value={cut.audio} maxLength={STORYBOARD_LIMITS.noteMax} onChange={(event) => patch(cut.key, "audio", event.target.value)} />
                        </label>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <div className="brs-editor-foot" data-storyboard-editor-foot>
        <p className="brs-status" role="status" aria-live="polite">
          {error ? (
            <span className="brs-error">
              {error.code === "storage_quota_exceeded" && error.reason === "unapproved_file_limit"
                ? copy.errors.unapprovedUploadFiles
                : error.code === "storage_quota_exceeded" && error.reason === "unapproved_quota"
                  ? copy.errors.unapprovedUploadQuota
                  : copy.errors[error.code]}
            </span>
          ) : notice ? (
            <span>{notice}</span>
          ) : (
            status
          )}
        </p>
        <div className="brs-editor-actions">
          {onDone ? (
            <button type="button" className="brs-btn brs-btn-quiet" onClick={onDone} disabled={busy !== null}>
              {e.done}
            </button>
          ) : null}
          <button type="button" className="brs-btn" onClick={() => void save()} disabled={busy !== null || !dirty} data-storyboard-save>
            {busy === "saving" ? e.saving : e.save}
          </button>
          <button type="button" className="brs-btn brs-btn-primary" onClick={() => setConfirmShare(true)} disabled={busy !== null || cuts.length === 0} data-storyboard-share>
            {shareLabel ?? e.share}
          </button>
        </div>
      </div>

      {confirmShare ? (
        <ConfirmDialog
          title={e.shareTitle}
          body={e.shareBody}
          confirmLabel={shareLabel ?? e.share}
          cancelLabel={copy.decision.cancel}
          busy={busy !== null}
          onConfirm={() => void share()}
          onCancel={() => setConfirmShare(false)}
        />
      ) : null}
    </section>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      {[3, 7, 11].flatMap((y) => [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}
    </svg>
  );
}

function ArrowIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d={dir === "up" ? "M7 11V3M3.5 6.5 7 3l3.5 3.5" : "M7 3v8M3.5 7.5 7 11l3.5-3.5"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M2.5 4h9M5.5 4V2.8h3V4M3.8 4l.6 7.4c0 .5.4.8.9.8h3.4c.5 0 .9-.3.9-.8l.6-7.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
