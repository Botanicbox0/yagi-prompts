"use client";
/**
 * The gallery wall (docs/BRAND-STUDIO-V3.md §4): every result of the screen's medium as one tight wall
 * of tiles, 4 px apart, no card chrome. Rows are justified by aspect ratio in CSS alone (each tile grows
 * by its ratio from a shared row height), so the layout needs no measuring and renders on the server.
 * Runs still open hold their place inside the wall with the stage they are at; failed runs say why in
 * one line with "다시". Thin dividers mark the days.
 *
 * Hover or focus on a tile shows small icon buttons in its corners: like, add to a folder, use as a
 * reference, and the more-menu. Tiles are drag sources for the prompt bar, the partial-edit form, the
 * layer editor and the library's folders.
 */
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { studioModel, type StudioMedium } from "@/lib/brand-studio/models";
import { canCancel, outputRatio, ratioNumber, slotRatio } from "../board";
import { credits, errorLine, fill, type StudioCopy, type StudioLocale } from "../copy";
import { StudioIcon } from "../icons";
import { startRefDrag } from "../refs";
import { libraryKey, type StudioLibrary } from "../seams";
import { isOpen } from "../store";
import { dayLabel, groupByDay } from "./days";
import { FolderPicker } from "./folder-picker";
import { Menu, useAnchored, useDismiss, type MenuEntry } from "./menu";

/** Everything a tile's buttons and menu can ask the screen to do. */
export type TileAction =
  | "open"
  | "rerun"
  | "reuse"
  | "region"
  | "decorate"
  | "toVideo"
  | "review"
  | "campaign"
  | "save"
  | "delete"
  | "reference"
  | "download";

export interface WallTileItem {
  output: StudioOutputView;
  job: StudioJobView;
}

/** A partial edit on its way to the server: it holds a place in the wall until the run comes back. */
export interface SendingTile {
  key: string;
  ratio: string;
}

export interface WallProps {
  mode: StudioMedium;
  /** The screen's runs, newest first. */
  jobs: readonly StudioJobView[];
  sending?: readonly SendingTile[];
  copy: StudioCopy;
  locale: StudioLocale;
  /** Owner or editor with an open allowance: may start runs from a tile. */
  canGenerate: boolean;
  /** Owner or editor: may like, file, save, delete and send. */
  canEdit: boolean;
  /** Owner or editor: may stop their team's waiting runs. */
  canStop?: boolean;
  stopping?: string | null;
  /** A line under a run (why it could not be stopped). */
  notes?: Readonly<Record<string, string>>;
  library: StudioLibrary;
  /** For day labels; tests pass a fixed time. */
  now?: Date;
  parentOf(outputId: string | null): StudioOutputView | null;
  onAction(action: TileAction, item: WallTileItem): void;
  onRetry(job: StudioJobView): void;
  onCancel?(job: StudioJobView): void;
  onNotice(line: string | null): void;
  /** Shown instead of the wall when there is nothing yet (the explainer and the example sentences). */
  empty?: ReactNode;
}

type Entry =
  | { type: "result"; key: string; item: WallTileItem; ratio: string }
  | { type: "pending"; key: string; job: StudioJobView; ratio: string; n: number }
  | { type: "failed"; key: string; job: StudioJobView; ratio: string }
  | { type: "sending"; key: string; ratio: string };

/** The wall's tiles in order: per run, its results, then the places still being made. */
export function wallEntries(jobs: readonly StudioJobView[], parentOf: (id: string | null) => StudioOutputView | null): Array<{ job: StudioJobView; entries: Entry[] }> {
  return jobs
    .filter((job) => !(job.status === "succeeded" && job.outputs.length === 0) && !(job.status === "canceled" && job.outputs.length === 0))
    .map((job) => {
      const parent = parentOf(job.parentOutputId);
      const entries: Entry[] = job.outputs.map((output) => ({
        type: "result" as const,
        key: `o:${output.id}`,
        item: { output, job },
        ratio: outputRatio(output, job, parent),
      }));
      if (isOpen(job)) {
        const pending = Math.max(0, job.expected - job.outputs.length);
        for (let i = 0; i < pending; i++)
          entries.push({ type: "pending", key: `p:${job.id}:${i}`, job, ratio: slotRatio(job, parent), n: job.outputs.length + i + 1 });
      } else if (job.status === "failed" && job.outputs.length === 0) {
        entries.push({ type: "failed", key: `f:${job.id}`, job, ratio: slotRatio(job, parent) });
      }
      return { job, entries };
    });
}

export type TileMenuKey = "open" | "rerun" | "reuse" | "region" | "decorate" | "to-video" | "folder" | "review" | "campaign" | "save" | "download" | "delete";

/**
 * The more-menu of a result, in order (docs/BRAND-STUDIO-V3.md §4): 열기 · 다시 만들기 · 설정 다시 쓰기 ·
 * 부분 수정 · 꾸미기 · 영상으로 만들기 · 폴더에 담기 · 리뷰에 올리기 · 캠페인으로 보내기 · 저장 · 내려받기 · 삭제.
 * Starting anything needs an open allowance (`canGenerate`); filing, sending and deleting need an owner
 * or editor (`canEdit`); a viewer can open and download.
 */
export function tileMenuKeys(input: {
  canGenerate: boolean;
  canEdit: boolean;
  kind: StudioJobView["kind"];
  image: boolean;
  /** Width and height known (the layer editor needs them). */
  sized: boolean;
  saved: boolean;
}): TileMenuKey[] {
  const { canGenerate, canEdit, kind, image, sized, saved } = input;
  const keys: TileMenuKey[] = ["open"];
  if (canGenerate && kind !== "video_final") keys.push("rerun", "reuse");
  if (canGenerate && image) keys.push("region");
  if (canEdit && image && sized) keys.push("decorate");
  if (canGenerate && image) keys.push("to-video");
  if (canEdit) keys.push("folder", "review", "campaign");
  if (canEdit && !saved) keys.push("save");
  keys.push("download");
  if (canEdit) keys.push("delete");
  return keys;
}

/** Flex values that justify a row: a tile grows by its ratio from the shared row height. */
export function tileStyle(ratio: string): Record<string, string | number> {
  const r = ratioNumber(ratio);
  return { "--r": Number(r.toFixed(4)), aspectRatio: ratio };
}

export function Wall(props: WallProps) {
  const { jobs, copy, locale, mode, sending = [], now = new Date(), parentOf } = props;
  const g = copy.gallery;
  const groups = groupByDay(wallEntries(jobs, parentOf), (entry) => entry.job.createdAt, now);
  const label = mode === "video" ? g.labelVideo : g.label;
  if (!groups.length && !sending.length)
    return (
      <section className="bs-wall" data-studio-board data-state="empty" aria-label={label}>
        {props.empty}
      </section>
    );
  const today = dayLabel(groups[0]?.key ?? "", now, locale, g);
  let n = 0;
  return (
    <section className="bs-wall" data-studio-board aria-label={label}>
      {sending.length > 0 && !groups.length && (
        <WallDay label={g.today}>
          {sending.map((tile) => (
            <SendingSlot key={tile.key} tile={tile} copy={copy} />
          ))}
        </WallDay>
      )}
      {groups.map((group, gi) => (
        <WallDay key={group.key} label={gi === 0 ? today : dayLabel(group.key, now, locale, g)}>
          {gi === 0 && sending.map((tile) => <SendingSlot key={tile.key} tile={tile} copy={copy} />)}
          {group.items.map(({ job, entries }) => (
            <Fragment key={job.id}>
              {entries.map((entry) => {
                if (entry.type === "result") return <ResultTile key={entry.key} entry={entry} n={++n} {...props} />;
                if (entry.type === "pending") return <PendingTile key={entry.key} entry={entry} {...props} />;
                if (entry.type === "failed") return <FailedTile key={entry.key} entry={entry} {...props} />;
                return null;
              })}
              {props.notes?.[job.id] && (
                <p className="bs-wall-note" role="status" data-studio-job-note>
                  {props.notes[job.id]}
                </p>
              )}
            </Fragment>
          ))}
        </WallDay>
      ))}
    </section>
  );
}

function WallDay({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bs-wall-day" data-studio-day>
      <h3 className="bs-wall-divider">{label}</h3>
      <div className="bs-wall-row">{children}</div>
    </div>
  );
}

function SendingSlot({ tile, copy }: { tile: SendingTile; copy: StudioCopy }) {
  return (
    <div className="bs-tile" data-state="pending" data-studio-sending style={tileStyle(tile.ratio)} role="img" aria-label={copy.gallery.sending}>
      <span className="bs-stage">{copy.gallery.sending}</span>
    </div>
  );
}

function PendingTile({ entry, copy, canStop = false, stopping = null, onCancel }: WallProps & { entry: Extract<Entry, { type: "pending" }> }) {
  const { job } = entry;
  const stage = copy.board.stage[job.status as keyof typeof copy.board.stage] ?? copy.board.stage.queued;
  return (
    <div className="bs-tile" data-state="pending" data-job-status={job.status} data-studio-job={job.id} style={tileStyle(entry.ratio)} role="group" aria-label={fill(copy.board.pending, { n: entry.n })}>
      <span className="bs-stage">{stage}</span>
      {job.kind === "region_edit" && <span className="bs-tile-badge">{copy.board.editBadge}</span>}
      {canStop && onCancel && canCancel(job) && entry.n === job.outputs.length + 1 && (
        <button
          type="button"
          className="bs-tile-cancel"
          data-studio-cancel
          aria-label={copy.board.cancelLabel}
          disabled={stopping === job.id}
          aria-busy={stopping === job.id}
          onClick={() => onCancel(job)}
        >
          {copy.board.cancel}
        </button>
      )}
    </div>
  );
}

function FailedTile({ entry, copy, canGenerate, onRetry }: WallProps & { entry: Extract<Entry, { type: "failed" }> }) {
  const { job } = entry;
  // A block with attachments usually comes from the attachment, so say where to look.
  const reason = job.errorCode === "provider_rejected" && job.references.length > 0 ? copy.board.rejectedWithReferences : errorLine(copy, job.errorCode);
  return (
    <div className="bs-tile" data-state="failed" data-studio-job={job.id} style={tileStyle(entry.ratio)} role="group" aria-label={copy.gallery.failed}>
      <p className="bs-tile-reason">{reason}</p>
      {canGenerate && (
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => onRetry(job)}>
          <StudioIcon name="rerun" />
          {copy.board.retry}
        </button>
      )}
    </div>
  );
}

function ResultTile(props: WallProps & { entry: Extract<Entry, { type: "result" }>; n: number }) {
  const { entry, n, copy, locale, canGenerate, canEdit, library, onAction, onNotice } = props;
  const { output, job } = entry.item;
  const g = copy.gallery;
  const m = g.menu;
  const id = useId();
  const [panel, setPanel] = useState<"menu" | "folders" | "confirm" | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const folderButton = useRef<HTMLButtonElement>(null);
  const ref = { outputId: output.id };
  const liked = library.liked.has(libraryKey(ref));
  const image = output.kind === "image";
  const sized = Boolean(output.width && output.height);
  const model = studioModel(job.model);
  const usage = job.estimateKrw > 0 && job.outputs.length > 0 ? Math.ceil(creditsOf(job.estimateKrw) / Math.max(1, job.outputs.length)) : 0;
  const open = () => onAction("open", entry.item);

  const close = (trigger: HTMLButtonElement | null) => () => {
    setPanel(null);
    // Focus goes back to the button that opened the panel when it was inside it (Escape, a pick).
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) trigger?.focus();
    });
  };

  const like = async () => {
    const ok = await library.toggleLike(ref);
    onNotice(ok ? null : g.likeFailed);
  };

  const item: Record<TileMenuKey, Omit<MenuEntry, "key">> = {
    open: { label: m.open, icon: "open", run: open },
    rerun: { label: m.rerun, icon: "rerun", run: () => onAction("rerun", entry.item) },
    reuse: { label: m.reuse, icon: "reuse", run: () => onAction("reuse", entry.item) },
    region: { label: m.region, icon: "region", run: () => onAction("region", entry.item) },
    decorate: { label: m.decorate, icon: "layers", run: () => onAction("decorate", entry.item) },
    "to-video": { label: m.toVideo, icon: "video", run: () => onAction("toVideo", entry.item) },
    folder: { label: m.folder, icon: "folder-plus", keepOpen: true, disabled: !library.ready, run: () => setPanel("folders") },
    review: { label: m.review, icon: "review", run: () => onAction("review", entry.item) },
    campaign: { label: m.campaign, icon: "send", run: () => onAction("campaign", entry.item) },
    save: { label: m.save, icon: "save", run: () => onAction("save", entry.item) },
    download: { label: m.download, icon: "download", run: () => onAction("download", entry.item) },
    delete: { label: m.delete, icon: "trash", tone: "danger", keepOpen: true, run: () => setPanel("confirm") },
  };
  const entries: MenuEntry[] = tileMenuKeys({ canGenerate, canEdit, kind: job.kind, image, sized, saved: Boolean(output.savedAssetId) }).map((key) => ({ key, ...item[key] }));

  return (
    <figure
      className="bs-tile"
      data-studio-tile
      data-kind={output.kind}
      data-state="ready"
      data-job-kind={job.kind}
      data-open={panel ? "" : undefined}
      data-liked={liked ? "" : undefined}
      style={tileStyle(entry.ratio)}
    >
      <button
        type="button"
        className="bs-tile-open"
        draggable={canEdit}
        onDragStart={(event) => startRefDrag(event, ref)}
        onClick={open}
        aria-label={fill(copy.board.open, { n })}
      >
        {output.kind === "video" ? (
          output.thumbUrl ? (
            <img src={output.thumbUrl} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : (
            <video src={`${output.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} />
          )
        ) : (
          <img src={output.thumbUrl ?? output.url} alt="" loading="lazy" decoding="async" draggable={false} />
        )}
      </button>
      {(output.draft || job.kind === "region_edit") && (
        <span className="bs-tile-badge">{output.draft ? copy.board.draftBadge : copy.board.editBadge}</span>
      )}
      {canEdit && (
        <button
          type="button"
          className="bs-tile-btn"
          data-corner="tl"
          data-studio-like
          aria-pressed={liked}
          aria-label={liked ? g.unlike : g.like}
          title={liked ? g.unlike : g.like}
          disabled={!library.ready}
          onClick={() => void like()}
        >
          <StudioIcon name="heart" filled={liked} />
        </button>
      )}
      <div className="bs-tile-tools" data-corner="tr">
        {canGenerate && (
          <button type="button" className="bs-tile-btn" data-studio-use aria-label={g.reference} title={g.reference} onClick={() => onAction("reference", entry.item)}>
            <StudioIcon name="plus" />
          </button>
        )}
        {canEdit && (
          <button
            ref={folderButton}
            type="button"
            className="bs-tile-btn"
            data-studio-file
            aria-label={g.folder}
            title={g.folder}
            aria-haspopup="dialog"
            aria-expanded={panel === "folders"}
            aria-controls={panel === "folders" ? `${id}-panel` : undefined}
            disabled={!library.ready}
            onClick={() => setPanel(panel === "folders" ? null : "folders")}
          >
            <StudioIcon name="folder-plus" />
          </button>
        )}
        <button
          ref={more}
          type="button"
          className="bs-tile-btn"
          data-studio-more
          aria-label={g.more}
          title={g.more}
          aria-haspopup="menu"
          aria-expanded={panel === "menu" || panel === "confirm"}
          aria-controls={panel === "menu" ? `${id}-panel` : undefined}
          onClick={() => setPanel(panel === "menu" || panel === "confirm" ? null : "menu")}
        >
          <StudioIcon name="more" />
        </button>
      </div>
      {(model || usage > 0) && (
        <figcaption className="bs-tile-info">
          {model && <span>{model.label}</span>}
          {usage > 0 && <span className="bs-num">{credits(copy.credits.amount, usage, locale)}</span>}
        </figcaption>
      )}
      {panel === "menu" && <Menu id={`${id}-panel`} label={g.more} entries={entries} anchor={more.current} onClose={close(more.current)} />}
      {panel === "folders" && (
        <FolderPicker
          id={`${id}-panel`}
          anchor={folderButton.current ?? more.current}
          folders={library.folders}
          words={{ title: g.folderTitle, empty: g.folderEmpty, newFolder: g.newFolder, newFolderName: g.newFolderName, create: g.createFolder }}
          onClose={close(folderButton.current ?? more.current)}
          onPick={(folderId) => {
            setPanel(null);
            const name = library.folders.find((f) => f.id === folderId)?.name ?? "";
            void library.addToFolder(folderId, ref).then((ok) => onNotice(ok ? fill(g.addedTo, { name }) : g.folderFailed));
          }}
          onCreate={(name) => {
            setPanel(null);
            void library.createFolder(name).then(async (folder) => {
              const ok = folder ? await library.addToFolder(folder.id, ref) : false;
              onNotice(ok && folder ? fill(g.addedTo, { name: folder.name }) : g.folderFailed);
            });
          }}
        />
      )}
      {panel === "confirm" && (
        <ConfirmDelete
          copy={copy}
          anchor={more.current}
          onConfirm={() => {
            setPanel(null);
            onAction("delete", entry.item);
          }}
          onClose={close(more.current)}
        />
      )}
    </figure>
  );
}

function ConfirmDelete({ copy, anchor, onConfirm, onClose }: { copy: StudioCopy; anchor: HTMLElement | null; onConfirm(): void; onClose(): void }) {
  const first = useRef<HTMLButtonElement>(null);
  const box = useDismiss(onClose);
  useAnchored(box, anchor, onClose);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  return (
    <div
      ref={box}
      className="bs-menu bs-menu-confirm"
      role="alertdialog"
      aria-label={copy.viewer.delete}
      data-studio-delete-confirm
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="bs-menu-note">{copy.viewer.deleteConfirm}</p>
      <div className="bs-row">
        <button ref={first} type="button" className="bs-btn" data-variant="soft" data-size="sm" data-tone="danger" onClick={onConfirm}>
          {copy.viewer.delete}
        </button>
        <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={onClose}>
          {copy.viewer.cancel}
        </button>
      </div>
    </div>
  );
}
