"use client";
/**
 * The storyboard tab of a project room, and the bare storyboard a share link shows
 * (docs/BRAND-ROOMS.md §5). Keep the export names: other slices mount them.
 *
 * The tab: a storyboard picker with its versions (and "바뀐 컷" against the version before), three
 * views (카드 · 표 · 재생), a cut opened large with its thread beside it (slice M's `RoomThread`),
 * 승인 / 수정 요청 on a board the YAGI team shared, the share button (slice R), and the editor for a
 * board the brand makes itself.
 *
 * Techniques (docs/design/TOOLBOX.md): Gallery Passepartout Framing for the pictures, a frosted sheet
 * for the opened cut, dark glass only on chips over the pictures, Tabular Numerals for lengths and
 * counts. One blue button at a time (승인하기, or 공유하기 in the editor).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { interpolate } from "@/lib/i18n/format";
import {
  formatRunTime,
  groupLineages,
  nextDecisions,
  totalSeconds,
  type StoryboardDecision,
  type StoryboardDetail,
  type StoryboardErrorCode,
  type StoryboardList,
} from "@/lib/brand-rooms/storyboard-contracts";
import type { StoryboardReadOnlyProps, StoryboardTabProps } from "../seams";
import { RoomThread } from "../chat";
import { ShareButton } from "../share";
import { createStoryboardApi, isFailure } from "./api";
import { StoryboardEditor } from "./editor";
import { Animatic, ConfirmDialog, CutCards, CutSheet, ShotTable, ViewSwitch, cutLabel, type StoryboardCopy, type StoryboardViewMode } from "./views";
import { brandWriter } from "./writers";
import "./storyboard.css";

type Confirm = { kind: StoryboardDecision } | { kind: "delete" };

export function StoryboardTab({ organizationId, projectId, locale, copy, chatCopy, shareCopy, canEdit, canTalk, initial }: StoryboardTabProps) {
  const api = useMemo(() => createStoryboardApi({ organizationId, projectId }), [organizationId, projectId]);
  const [list, setList] = useState<StoryboardList | null>(null);
  const [listError, setListError] = useState<StoryboardErrorCode | null>(null);
  const [boardId, setBoardId] = useState<string | null>(initial?.boardId ?? null);
  const [detail, setDetail] = useState<StoryboardDetail | null>(null);
  const [detailError, setDetailError] = useState<StoryboardErrorCode | null>(null);
  const [view, setView] = useState<StoryboardViewMode>("cards");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const pendingFrame = useRef<string | null>(initial?.frameId ?? null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<StoryboardErrorCode | null>(null);
  const [changedOnly, setChangedOnly] = useState(false);
  const detailRequest = useRef(0);

  const loadList = useCallback(
    async (select?: string | null) => {
      const result = await api.list();
      if (isFailure(result)) {
        setListError(result.code);
        return;
      }
      setListError(null);
      setList(result);
      setBoardId((current) => {
        const want = select ?? current;
        if (want && result.boards.some((b) => b.id === want)) return want;
        return result.boards[0]?.id ?? null;
      });
    },
    [api],
  );

  const loadDetail = useCallback(
    async (id: string) => {
      const ticket = ++detailRequest.current;
      const result = await api.detail(id);
      if (ticket !== detailRequest.current) return;
      if (isFailure(result)) {
        setDetailError(result.code);
        setDetail(null);
        return;
      }
      setDetailError(null);
      setDetail(result);
      if (pendingFrame.current) {
        const at = result.board.frames.findIndex((f) => f.id === pendingFrame.current);
        pendingFrame.current = null;
        if (at >= 0) setOpenIndex(at);
      }
    },
    [api],
  );

  useEffect(() => {
    void loadList(initial?.boardId ?? null);
    // Only on mount and when the room changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList]);

  useEffect(() => {
    if (!boardId) {
      setDetail(null);
      return;
    }
    setOpenIndex(null);
    setChangedOnly(false);
    void loadDetail(boardId);
  }, [boardId, loadDetail]);

  // The address follows the board and the open cut, so a link (and a reference card in the chat) lands here.
  useEffect(() => {
    if (typeof window === "undefined" || !list) return;
    const url = new URL(window.location.href);
    if (boardId) url.searchParams.set("board", boardId);
    else url.searchParams.delete("board");
    const frameId = openIndex != null ? detail?.board.frames[openIndex]?.id : null;
    if (frameId && boardId) url.searchParams.set("frame", frameId);
    else url.searchParams.delete("frame");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  }, [boardId, detail, list, openIndex]);

  const refresh = useCallback(async () => {
    await loadList(boardId);
    if (boardId) await loadDetail(boardId);
  }, [boardId, loadDetail, loadList]);

  const run = async (fn: () => Promise<{ ok: boolean; code?: StoryboardErrorCode; board?: { id: string } }>): Promise<{ id?: string } | null> => {
    setBusy(true);
    setActionError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setActionError(result.code ?? "failed");
      return null;
    }
    return { id: result.board?.id };
  };

  const createBoard = async () => {
    const made = await run(() => api.call("board.create", { title: copy.actions.defaultTitle }));
    if (!made?.id) return;
    await loadList(made.id);
    setEditing(true);
  };

  const newVersion = async () => {
    if (!detail) return;
    const made = await run(() => api.call("board.version", { storyboardId: detail.board.id }));
    if (!made?.id) return;
    await loadList(made.id);
    setEditing(true);
  };

  const onConfirm = async () => {
    if (!detail || !confirm) return;
    const storyboardId = detail.board.id;
    if (confirm.kind === "delete") {
      const done = await run(() => api.call("board.delete", { storyboardId }));
      setConfirm(null);
      if (done) {
        setBoardId(null);
        await loadList(null);
      }
      return;
    }
    const kind = confirm.kind;
    const done = await run(() => api.call("board.status", { storyboardId, status: kind }));
    setConfirm(null);
    if (done) await refresh();
  };

  const lineages = useMemo(() => groupLineages(list?.boards ?? []), [list]);
  const current = list?.boards.find((b) => b.id === boardId) ?? null;
  const board = detail && detail.board.id === boardId ? detail.board : null;
  const changed = useMemo(() => new Set(detail?.changedFrameIds ?? []), [detail]);
  const shown = useMemo(() => (board ? (changedOnly ? board.frames.filter((f) => changed.has(f.id)) : board.frames) : []), [board, changed, changedOnly]);
  const openAt = (filteredIndex: number) => {
    if (!board) return;
    const frame = shown[filteredIndex];
    setOpenIndex(frame ? board.frames.findIndex((f) => f.id === frame.id) : null);
  };

  if (listError) {
    return (
      <section className="brs" data-room-storyboard data-storyboard-state="error">
        <p role="alert" className="brs-error">
          {copy.errors[listError]}
        </p>
        <button type="button" className="brs-btn" onClick={() => void loadList(boardId)}>
          {copy.retry}
        </button>
      </section>
    );
  }
  if (!list) {
    return (
      <section className="brs" data-room-storyboard data-storyboard-state="loading" aria-busy="true">
        <p className="brs-muted">{copy.loading}</p>
      </section>
    );
  }
  if (list.boards.length === 0) {
    return (
      <section className="brs" data-room-storyboard data-storyboard-state="empty">
        <div className="brs-empty">
          <h2 className="brs-empty-title">{copy.empty.title}</h2>
          <p className="brs-muted">{copy.empty.body}</p>
          {canEdit ? (
            <button type="button" className="brs-btn" onClick={() => void createBoard()} disabled={busy} data-storyboard-create>
              {copy.empty.make}
            </button>
          ) : null}
          {actionError ? <p className="brs-error" role="alert">{copy.errors[actionError]}</p> : null}
        </div>
      </section>
    );
  }

  const isBrandBoard = board?.createdRole === "brand";
  const decisions = board && board.createdRole === "studio" && canEdit ? nextDecisions(board.status) : [];
  const editable = Boolean(detail?.editable && board);
  const lineage = lineages.find((l) => l.versions.some((v) => v.id === boardId));

  return (
    <section className="brs" data-room-storyboard data-storyboard-board={boardId ?? undefined} data-storyboard-status={board?.status}>
      <header className="brs-head">
        <div className="brs-head-main">
          {lineages.length > 1 ? (
            <label className="brs-picker">
              <span className="brs-sr">{copy.boardLabel}</span>
              <select
                value={lineage?.lineageId ?? ""}
                onChange={(event) => {
                  const next = lineages.find((l) => l.lineageId === event.target.value);
                  if (next) {
                    setEditing(false);
                    setBoardId(next.versions[0]!.id);
                  }
                }}
                data-storyboard-picker
              >
                {lineages.map((l) => (
                  <option key={l.lineageId} value={l.lineageId}>
                    {l.versions[0]!.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <h2 className="brs-title">{current?.title ?? board?.title}</h2>
          )}
          {detail && detail.versions.length > 0 ? (
            <div className="brs-seg brs-versions" role="group" aria-label={copy.versionLabel} data-storyboard-versions>
              {detail.versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="brs-seg-btn brs-num"
                  aria-pressed={v.id === boardId}
                  onClick={() => {
                    setEditing(false);
                    setBoardId(v.id);
                  }}
                  data-storyboard-version={v.version}
                >
                  {interpolate(copy.version, { n: v.version })}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="brs-head-actions">
          {canEdit && board && !editing ? (
            <>
              {isBrandBoard && editable ? (
                <button type="button" className="brs-btn" onClick={() => setEditing(true)} disabled={busy} data-storyboard-edit>
                  {copy.actions.edit}
                </button>
              ) : null}
              {isBrandBoard && board.status !== "draft" ? (
                <button type="button" className="brs-btn" onClick={() => void newVersion()} disabled={busy} data-storyboard-new-version>
                  {copy.actions.newVersion}
                </button>
              ) : null}
              {board.status !== "draft" ? (
                <ShareButton organizationId={organizationId} target={{ kind: "storyboard", id: board.id }} locale={locale} copy={shareCopy} canEdit={canEdit} />
              ) : null}
              <button type="button" className="brs-btn" onClick={() => void createBoard()} disabled={busy} data-storyboard-create>
                {copy.actions.newBoard}
              </button>
              {isBrandBoard ? (
                <button type="button" className="brs-btn brs-btn-quiet" onClick={() => setConfirm({ kind: "delete" })} disabled={busy} data-storyboard-delete>
                  {copy.actions.delete}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      {board ? (
        <p className="brs-meta" data-storyboard-meta>
          <span className={`brs-status-pill brs-status-${board.status}`}>{copy.status[board.status]}</span>
          <span>{copy.madeBy[board.createdRole]}</span>
          <span className="brs-num">{interpolate(copy.cutsCount, { n: board.frames.length })}</span>
          <span className="brs-num">{interpolate(copy.runTime, { time: formatRunTime(totalSeconds(board.frames)) })}</span>
          {detail?.previous ? (
            <span className="brs-num" data-storyboard-changed-summary>
              {detail.changedFrameIds.length === 0 && detail.removedCount === 0
                ? interpolate(copy.sameAsBefore, { prev: detail.previous.version })
                : [
                    detail.changedFrameIds.length ? interpolate(copy.changedSummary, { n: detail.changedFrameIds.length, prev: detail.previous.version }) : null,
                    detail.removedCount ? interpolate(copy.removedSummary, { n: detail.removedCount }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          ) : null}
        </p>
      ) : null}

      {board && board.createdRole === "studio" && board.status !== "draft" ? (
        <div className="brs-decision" data-storyboard-decision={board.status}>
          <p className="brs-decision-line">
            {board.status === "approved" ? copy.decision.approved : board.status === "changes_requested" ? copy.decision.changesRequested : copy.decision.waiting}
          </p>
          {decisions.length ? (
            <div className="brs-decision-actions">
              {decisions.includes("shared") ? (
                <button type="button" className="brs-btn" onClick={() => setConfirm({ kind: "shared" })} disabled={busy} data-storyboard-reopen>
                  {copy.decision.reopen}
                </button>
              ) : null}
              {decisions.includes("changes_requested") ? (
                <button type="button" className="brs-btn" onClick={() => setConfirm({ kind: "changes_requested" })} disabled={busy} data-storyboard-request-changes>
                  {copy.decision.requestChanges}
                </button>
              ) : null}
              {decisions.includes("approved") ? (
                <button type="button" className="brs-btn brs-btn-primary" onClick={() => setConfirm({ kind: "approved" })} disabled={busy} data-storyboard-approve>
                  {copy.decision.approve}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {actionError ? (
        <p className="brs-error" role="alert">
          {copy.errors[actionError]}
        </p>
      ) : null}

      {detailError ? (
        <div className="brs-empty">
          <p role="alert" className="brs-error">
            {copy.errors[detailError]}
          </p>
          <button type="button" className="brs-btn" onClick={() => boardId && void loadDetail(boardId)}>
            {copy.retry}
          </button>
        </div>
      ) : !board ? (
        <p className="brs-muted" aria-busy="true">
          {copy.loading}
        </p>
      ) : editing && editable ? (
        <StoryboardEditor
          key={`${board.id}:${board.updatedAt}`}
          board={board}
          copy={copy}
          writer={brandWriter(api, board)}
          onSaved={() => void refresh()}
          onShared={() => {
            setEditing(false);
            void refresh();
          }}
          onDone={() => setEditing(false)}
        />
      ) : board.frames.length === 0 ? (
        <div className="brs-empty">
          <p className="brs-muted">{copy.editor.empty}</p>
          {editable ? (
            <button type="button" className="brs-btn" onClick={() => setEditing(true)}>
              {copy.actions.edit}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="brs-toolbar">
            <ViewSwitch value={view} onChange={setView} copy={copy} />
            {changed.size > 0 && view !== "player" ? (
              <label className="brs-toggle">
                <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} data-storyboard-changed-only />
                <span>{copy.changedOnly}</span>
              </label>
            ) : null}
          </div>
          {view === "cards" ? (
            <CutCards frames={shown} copy={copy} changed={changed} onOpen={openAt} />
          ) : view === "table" ? (
            <ShotTable frames={shown} copy={copy} changed={changed} onOpen={openAt} />
          ) : (
            <Animatic key={board.id} frames={board.frames} copy={copy} startIndex={openIndex ?? 0} />
          )}
        </>
      )}

      {board && openIndex != null && !editing ? (
        <CutSheet
          frames={board.frames}
          index={openIndex}
          copy={copy}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          side={
            board.status !== "draft" && board.frames[openIndex] ? (
              <RoomThread
                key={board.frames[openIndex]!.id}
                organizationId={organizationId}
                projectId={projectId}
                roomRef={{ kind: "storyboard", storyboardId: board.id, frameId: board.frames[openIndex]!.id }}
                locale={locale}
                copy={chatCopy}
                canTalk={canTalk}
                label={interpolate(copy.sheet.threadLabel, { n: cutLabel(copy, board.frames[openIndex]!, openIndex) })}
              />
            ) : undefined
          }
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={
            confirm.kind === "delete"
              ? copy.actions.deleteTitle
              : confirm.kind === "approved"
                ? copy.decision.approveTitle
                : confirm.kind === "changes_requested"
                  ? copy.decision.changesTitle
                  : copy.decision.reopenTitle
          }
          body={
            confirm.kind === "delete"
              ? copy.actions.deleteBody
              : confirm.kind === "approved"
                ? copy.decision.approveBody
                : confirm.kind === "changes_requested"
                  ? copy.decision.changesBody
                  : copy.decision.reopenBody
          }
          confirmLabel={
            confirm.kind === "delete"
              ? copy.actions.delete
              : confirm.kind === "approved"
                ? copy.decision.approve
                : confirm.kind === "changes_requested"
                  ? copy.decision.requestChanges
                  : copy.decision.reopen
          }
          cancelLabel={copy.decision.cancel}
          busy={busy}
          onConfirm={() => void onConfirm()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </section>
  );
}

/** A storyboard with nothing around it and no way to change it (the shared-link page uses it). */
export function StoryboardReadOnly({ board, copy }: StoryboardReadOnlyProps) {
  const [view, setView] = useState<StoryboardViewMode>("cards");
  const [open, setOpen] = useState<number | null>(null);
  const c = copy as StoryboardCopy;
  return (
    <section className="brs brs-readonly" data-storyboard-readonly={board.id}>
      <header className="brs-head">
        <div className="brs-head-main">
          <h2 className="brs-title">{board.title}</h2>
          <span className="brs-seg-static brs-num">{interpolate(c.version, { n: board.version })}</span>
        </div>
      </header>
      <p className="brs-meta">
        <span className="brs-num">{interpolate(c.cutsCount, { n: board.frames.length })}</span>
        <span className="brs-num">{interpolate(c.runTime, { time: formatRunTime(totalSeconds(board.frames)) })}</span>
      </p>
      {board.frames.length > 0 ? (
        <>
          <div className="brs-toolbar">
            <ViewSwitch value={view} onChange={setView} copy={c} />
          </div>
          {view === "cards" ? (
            <CutCards frames={board.frames} copy={c} onOpen={setOpen} />
          ) : view === "table" ? (
            <ShotTable frames={board.frames} copy={c} onOpen={setOpen} />
          ) : (
            <Animatic frames={board.frames} copy={c} />
          )}
        </>
      ) : (
        <p className="brs-muted">{c.editor.empty}</p>
      )}
      {open != null ? <CutSheet frames={board.frames} index={open} copy={c} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
