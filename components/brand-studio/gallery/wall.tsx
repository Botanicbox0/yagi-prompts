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
 *
 * Several tiles can be picked at once: a checkbox in each result's and failed run's corner, Shift+click
 * for a range, then one floating bar acts on all of them (use as references, also on Enter; put in a
 * folder; download; delete). A tile is exactly what is on screen: a clip with versions shows one version,
 * and that version alone is selected or deleted (./selection.ts).
 */
import { Fragment, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { studioModelOrLegacy, type StudioMedium } from "@/lib/brand-studio/models";
import { canCancel, outputRatio, ratioNumber, slotRatio } from "../board";
import { credits, errorLine, fill, type StudioCopy, type StudioLocale } from "../copy";
import { copyText, promptToCopy, useCopied } from "../copy-prompt";
import { StudioIcon } from "../icons";
import { startRefDrag } from "../refs";
import { libraryKey, type StudioLibrary } from "../seams";
import { collapseRevisions, revisionBadges } from "../revision-model";
import { isOpen } from "../store";
import { dayLabel, groupByDay } from "./days";
import { downloadOutputs } from "./download";
import { FolderPicker } from "./folder-picker";
import {
  EMPTY_SELECTION,
  bulkActions,
  failedKey,
  pruneSelection,
  resultKey,
  selectRange,
  selectedTargets,
  toggleSelection,
  type BulkAction,
  type SelectableTile,
  type SelectedTargets,
  type Selection,
} from "./selection";
import { Menu, useAnchored, useDismiss, type MenuEntry } from "./menu";
import { useElementSize, useMediaQuery } from "../use-media";

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
  /** Runs that ended with no result can be taken off the wall (owner or editor, and the server has it). */
  canRemove?: boolean;
  /** Takes one such run off the wall. Without it failed tiles have no checkbox and no remove button. */
  onRemove?(job: StudioJobView): void | Promise<unknown>;
  /** Tiles selected first, by key (tests). */
  initialSelection?: readonly string[];
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

/**
 * The tiles that can be picked, in the order on screen: every result, and (where runs can be removed)
 * every run that ended with no result. Places still being made are never pickable. Clips are collapsed
 * first, so a clip contributes the version it shows and nothing behind it.
 */
export function wallSelectable(jobs: readonly StudioJobView[], parentOf: (id: string | null) => StudioOutputView | null, canRemove: boolean): SelectableTile[] {
  const tiles: SelectableTile[] = [];
  for (const { entries } of wallEntries(collapseRevisions(jobs), parentOf))
    for (const entry of entries) {
      if (entry.type === "result") tiles.push({ key: resultKey(entry.item.output.id), type: "result", item: entry.item });
      else if (entry.type === "failed" && canRemove) tiles.push({ key: failedKey(entry.job.id), type: "failed", job: entry.job });
    }
  return tiles;
}

/** The question before deleting what is selected; it adds that earlier versions stay when a picked clip has them. */
export function deleteConfirmLine(targets: SelectedTargets, jobs: readonly StudioJobView[], copy: StudioCopy): string {
  const g = copy.gallery;
  const badges = revisionBadges(jobs);
  const versioned = targets.items.some((item) => (badges.get(item.job.id) ?? 1) > 1);
  const line = fill(g.bulkDeleteConfirm, { n: targets.items.length + targets.failed.length });
  return versioned ? `${line} ${g.bulkDeleteVersions}` : line;
}

export type TileMenuKey =
  | "open"
  | "select"
  | "like"
  | "reference"
  | "rerun"
  | "reuse"
  | "copy-prompt"
  | "region"
  | "decorate"
  | "to-video"
  | "folder"
  | "review"
  | "campaign"
  | "save"
  | "download"
  | "delete";

/**
 * The more-menu of a result, in order (docs/BRAND-STUDIO-V3.md §4): 열기 · 다시 만들기 · 설정 다시 쓰기 ·
 * 프롬프트 복사 · 부분 수정 · 꾸미기 · 영상으로 만들기 · 폴더에 담기 · 리뷰에 올리기 · 캠페인으로 보내기 · 저장 ·
 * 내려받기 · 삭제. A partial edit's result reads 열기 · 같은 영역 다시 수정하기 (its original, the same area) ·
 * 프롬프트 복사 · 부분 수정 (this result) · …: "다시 만들기" would open the same form, so it is not repeated.
 * Starting anything needs an open allowance (`canGenerate`); filing, sending and deleting need an owner
 * or editor (`canEdit`); a viewer can open, copy the prompt and download.
 */
export function tileMenuKeys(input: {
  canGenerate: boolean;
  canEdit: boolean;
  kind: StudioJobView["kind"];
  image: boolean;
  /** Width and height known (the layer editor needs them). */
  sized: boolean;
  saved: boolean;
  /** The run has words to copy (`promptToCopy`). */
  copyable?: boolean;
  /** Corner buttons the tile had no room for (`tileControls`): their actions come here instead. */
  inMenu?: { select?: boolean; like?: boolean; reference?: boolean };
  /** A preset workflow run (`StudioJobView.preset`): its text is never shown, so it is not made again from here. */
  preset?: boolean;
}): TileMenuKey[] {
  const { canGenerate, canEdit, kind, image, sized, saved, copyable = false, inMenu = {}, preset = false } = input;
  const keys: TileMenuKey[] = ["open"];
  if (inMenu.select) keys.push("select");
  if (canGenerate && kind === "region_edit") keys.push("reuse");
  else if (canGenerate && kind !== "video_final" && !preset) keys.push("rerun", "reuse");
  if (copyable) keys.push("copy-prompt");
  if (canGenerate && image) keys.push("region");
  if (canEdit && image && sized) keys.push("decorate");
  if (canGenerate && image) keys.push("to-video");
  if (canGenerate && inMenu.reference) keys.push("reference");
  if (canEdit) keys.push("folder");
  if (canEdit && inMenu.like) keys.push("like");
  if (canEdit) keys.push("review", "campaign");
  if (canEdit && !saved) keys.push("save");
  keys.push("download");
  if (canEdit) keys.push("delete");
  return keys;
}

/**
 * Which corner buttons a tile of `width` px has room for, so no two overlap (studio-v2.css draws them at these
 * sizes): on a touch screen every button is a 44 px box from the corner, otherwise a 24 px select box at 8 px,
 * a 30 px like button after it, and `tools` 30 px buttons 4 px apart at the right (use · folder · more). What does
 * not fit goes, in this order: use and folder (the right corner keeps "more"), then like, then the select box;
 * their actions move into the more-menu (`tileMenuKeys` `inMenu`). Unknown width (not measured yet): everything.
 */
export function tileControls(
  width: number | null,
  input: { coarse: boolean; like: boolean; tools: number },
): { check: boolean; like: boolean; tools: number } {
  const { coarse, like, tools } = input;
  if (width === null) return { check: true, like, tools };
  const button = coarse ? 44 : 30;
  const inset = coarse ? 0 : 8;
  const gap = coarse ? 0 : 4;
  const box = coarse ? 44 : 24;
  const afterBox = coarse ? 0 : 8;
  const left = (check: boolean, withLike: boolean) => (check || withLike ? inset : 0) + (check ? box : 0) + (check && withLike ? afterBox : 0) + (withLike ? button : 0);
  const right = (n: number) => (n > 0 ? inset + n * button + (n - 1) * gap : 0);
  const room = (check: boolean, withLike: boolean, n: number) => left(check, withLike) + right(n) + 4 <= width;
  const fewer = Math.min(tools, 1);
  const steps: Array<[boolean, boolean, number]> = [
    [true, like, tools],
    [true, like, fewer],
    [true, false, fewer],
    [false, false, fewer],
  ];
  for (const [check, withLike, n] of steps) if (room(check, withLike, n)) return { check, like: withLike, tools: n };
  return { check: false, like: false, tools: fewer };
}

/** Flex values that justify a row: a tile grows by its ratio from the shared row height. */
export function tileStyle(ratio: string): Record<string, string | number> {
  const r = ratioNumber(ratio);
  return { "--r": Number(r.toFixed(4)), aspectRatio: ratio };
}

export function Wall(props: WallProps) {
  const { jobs, copy, locale, mode, sending = [], now = new Date(), parentOf } = props;
  const g = copy.gallery;
  // A clip with several versions shows its newest one (and newer failures); the viewer reaches the rest.
  const badges = revisionBadges(jobs);
  const canRemove = Boolean(props.canRemove && props.onRemove);
  const tiles = wallSelectable(jobs, parentOf, canRemove);
  const order = tiles.map((tile) => tile.key);
  const [picked, setPicked] = useState<Selection>(() =>
    props.initialSelection?.length ? { keys: new Set(props.initialSelection), anchor: props.initialSelection[props.initialSelection.length - 1] ?? null } : EMPTY_SELECTION,
  );
  // What left the wall (deleted, or replaced by a newer version) is no longer selected.
  const selection = pruneSelection(picked, order);
  const targets = selectedTargets(tiles, selection);
  const selecting = selection.keys.size > 0;
  const actions = bulkActions(targets, { canGenerate: props.canGenerate, canEdit: props.canEdit, canRemove });
  const select: Select = {
    selecting,
    has: (key) => selection.keys.has(key),
    press: (key, range) => setPicked((current) => (range ? selectRange(pruneSelection(current, order), order, key) : toggleSelection(pruneSelection(current, order), key))),
  };
  const clear = () => setPicked(EMPTY_SELECTION);
  const sendAsReferences = () => {
    for (const item of targets.items) props.onAction("reference", item);
    clear();
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (!selecting || !(event.target instanceof Element) || event.target.closest(".bs-menu, [data-studio-selection-bar]")) return;
    if (event.key === "Escape") clear();
    // Enter on a picked wall: the selection goes to the prompt bar as references.
    if (event.key === "Enter" && actions.includes("reference") && event.target.closest(".bs-tile-check, .bs-tile-open")) {
      event.preventDefault();
      sendAsReferences();
    }
  };
  // A run made with others in one request: pointing at (or focusing) one of its tiles outlines all of them.
  // The pointer and the keyboard are kept apart, so leaving one tile never clears the group focus is in.
  const [pointed, setPointed] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const group: GroupLight = {
    lit: pointed ?? focused,
    point: (id, on) => setPointed((current) => (on ? id : current === id ? null : current)),
    focus: (id, on) => setFocused((current) => (on ? id : current === id ? null : current)),
  };
  const tileProps = { ...props, badges, select, canRemove, group };
  const groups = groupByDay(wallEntries(collapseRevisions(jobs), parentOf), (entry) => entry.job.createdAt, now);
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
    <section className="bs-wall" data-studio-board aria-label={label} data-selecting={selecting ? "" : undefined} onKeyDown={keys}>
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
                if (entry.type === "result") return <ResultTile key={entry.key} entry={entry} n={++n} {...tileProps} />;
                if (entry.type === "pending") return <PendingTile key={entry.key} entry={entry} {...tileProps} />;
                if (entry.type === "failed") return <FailedTile key={entry.key} entry={entry} {...tileProps} />;
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
      {selecting && (
        <SelectionBar
          targets={targets}
          actions={actions}
          confirmLine={deleteConfirmLine(targets, jobs, copy)}
          copy={copy}
          library={props.library}
          onReference={sendAsReferences}
          onDelete={() => {
            for (const item of targets.items) props.onAction("delete", item);
            for (const job of targets.failed) void props.onRemove?.(job);
          }}
          onClear={clear}
          onNotice={props.onNotice}
        />
      )}
    </section>
  );
}

/** What a tile needs to take part in the selection. */
interface Select {
  /** True once anything is picked: a press on a picture then picks instead of opening. */
  selecting: boolean;
  has(key: string): boolean;
  press(key: string, range: boolean): void;
}

function TileCheck({ selected, label, onPress }: { selected: boolean; label: string; onPress(event: MouseEvent): void }) {
  return (
    <button type="button" role="checkbox" aria-checked={selected} className="bs-tile-check" data-studio-select aria-label={label} title={label} onClick={onPress}>
      {selected && <StudioIcon name="check" />}
    </button>
  );
}

/**
 * The bar that floats above the prompt bar while tiles are picked: how many, then what can be done with
 * all of them. Delete asks once, in the bar itself.
 */
function SelectionBar({
  targets,
  actions,
  confirmLine,
  copy,
  library,
  onReference,
  onDelete,
  onClear,
  onNotice,
}: {
  targets: SelectedTargets;
  actions: readonly BulkAction[];
  confirmLine: string;
  copy: StudioCopy;
  library: StudioLibrary;
  onReference(): void;
  onDelete(): void;
  onClear(): void;
  onNotice(line: string | null): void;
}) {
  const g = copy.gallery;
  const id = useId();
  const [panel, setPanel] = useState<"folders" | "confirm" | null>(null);
  const [saving, setSaving] = useState(false);
  const folderButton = useRef<HTMLButtonElement>(null);
  const count = targets.items.length + targets.failed.length;
  const refs = targets.items.map((item) => ({ outputId: item.output.id }));
  const file = async (folder: { id: string; name: string } | null) => {
    const done = folder ? await Promise.all(refs.map((ref) => library.addToFolder(folder.id, ref))) : [false];
    onNotice(folder && done.every(Boolean) ? fill(g.addedMany, { n: refs.length, name: folder.name }) : g.folderFailed);
    if (folder && done.every(Boolean)) onClear();
  };
  const download = async () => {
    setSaving(true);
    const { fallback } = await downloadOutputs(targets.items.map((item) => item.output));
    setSaving(false);
    onNotice(fallback > 1 ? g.downloadFailed : null);
  };
  const button: Record<BulkAction, { label: string; icon: "plus" | "folder-plus" | "download" | "trash"; run(): void; busy?: boolean; disabled?: boolean; tone?: "danger" }> = {
    reference: { label: g.reference, icon: "plus", run: onReference },
    folder: { label: g.folder, icon: "folder-plus", run: () => setPanel(panel === "folders" ? null : "folders"), disabled: !library.ready },
    download: { label: g.menu.download, icon: "download", run: () => void download(), busy: saving, disabled: saving },
    delete: { label: g.menu.delete, icon: "trash", run: () => setPanel("confirm"), tone: "danger" },
  };
  return (
    <div className="bs-selection" role="toolbar" aria-label={g.selectionBar} data-studio-selection-bar>
      {panel === "confirm" ? (
        <>
          <p className="bs-selection-line" role="alert">
            {confirmLine}
          </p>
          <button
            type="button"
            className="bs-btn"
            data-variant="soft"
            data-size="sm"
            data-tone="danger"
            data-bulk-confirm
            autoFocus
            onClick={() => {
              setPanel(null);
              onDelete();
            }}
          >
            {g.menu.delete}
          </button>
          <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={() => setPanel(null)}>
            {copy.viewer.cancel}
          </button>
        </>
      ) : (
        <>
          <p className="bs-selection-count bs-num" aria-live="polite">
            {fill(g.selected, { n: count })}
          </p>
          {actions.map((action) => {
            const b = button[action];
            return (
              <button
                key={action}
                ref={action === "folder" ? folderButton : undefined}
                type="button"
                className="bs-btn"
                data-variant="ghost"
                data-size="sm"
                data-tone={b.tone}
                data-bulk={action}
                disabled={b.disabled}
                aria-busy={b.busy}
                aria-haspopup={action === "folder" ? "dialog" : undefined}
                aria-expanded={action === "folder" ? panel === "folders" : undefined}
                aria-controls={action === "folder" && panel === "folders" ? `${id}-folders` : undefined}
                onClick={b.run}
              >
                <StudioIcon name={b.icon} />
                {b.label}
              </button>
            );
          })}
          <button type="button" className="bs-tile-btn bs-selection-clear" aria-label={g.clearSelection} title={g.clearSelection} onClick={onClear}>
            <StudioIcon name="close" />
          </button>
        </>
      )}
      {panel === "folders" && (
        <FolderPicker
          id={`${id}-folders`}
          anchor={folderButton.current}
          folders={library.folders}
          words={{ title: g.folderTitle, empty: g.folderEmpty, newFolder: g.newFolder, newFolderName: g.newFolderName, create: g.createFolder }}
          onClose={() => setPanel(null)}
          onPick={(folderId) => {
            setPanel(null);
            void file(library.folders.find((f) => f.id === folderId) ?? null);
          }}
          onCreate={(name) => {
            setPanel(null);
            void library.createFolder(name).then((folder) => file(folder));
          }}
        />
      )}
    </div>
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

/** Version numbers of clips with more than one version, by run id. */
type Badges = { badges: ReadonlyMap<string, number> };
/** The selection, and whether runs with no result can be removed here. */
type Picking = { select: Select; canRemove: boolean; group: GroupLight };
/** Which request made on several models is lit (pointer first, else keyboard focus), and how a tile reports it. */
type GroupLight = { lit: string | null; point(groupId: string, on: boolean): void; focus(groupId: string, on: boolean): void };

/**
 * The attributes and handlers that tie a tile to the other runs of its request: every tile of the group gets
 * one quiet ink outline while any of them is under a mouse or pen, or holds keyboard focus. A touch alone
 * lights nothing beyond what its focus gives. Nothing for a run made alone.
 */
function groupTile(job: StudioJobView, group: GroupLight) {
  const id = job.group?.id;
  if (!id) return {};
  return {
    "data-group": id,
    "data-group-lit": group.lit === id ? "" : undefined,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") group.point(id, true);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") group.point(id, false);
    },
    onFocus: () => group.focus(id, true),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) group.focus(id, false);
    },
  };
}

function VersionBadge({ n, copy, extra }: { n: number | undefined; copy: StudioCopy; extra?: string | null }) {
  if (!n) return extra ? <span className="bs-tile-badge">{extra}</span> : null;
  return (
    <span className="bs-tile-badge" data-revision-badge={n}>
      {[fill(copy.revise.version, { n }), extra].filter(Boolean).join(" · ")}
    </span>
  );
}

/**
 * The model of a run made with others in one request, on its place in the wall (nothing for a lone run).
 * `inline`: in the flow of a failed tile's centred column, so it never sits on its "다시" button.
 */
function GroupModelBadge({ job, inline = false }: { job: StudioJobView; inline?: boolean }) {
  const model = job.group ? studioModelOrLegacy(job.model) : null;
  if (!model) return null;
  return (
    <span className="bs-tile-model" data-studio-tile-model={job.model} data-inline={inline ? "" : undefined}>
      {model.label}
    </span>
  );
}

function PendingTile({ entry, copy, canStop = false, stopping = null, onCancel, badges, group }: WallProps & Badges & Picking & { entry: Extract<Entry, { type: "pending" }> }) {
  const { job } = entry;
  const stage = copy.board.stage[job.status as keyof typeof copy.board.stage] ?? copy.board.stage.queued;
  return (
    <div className="bs-tile" data-state="pending" data-job-status={job.status} data-studio-job={job.id} style={tileStyle(entry.ratio)} role="group" aria-label={fill(copy.board.pending, { n: entry.n })} {...groupTile(job, group)}>
      <span className="bs-stage">{stage}</span>
      <GroupModelBadge job={job} />
      <VersionBadge n={badges.get(job.id)} copy={copy} extra={job.kind === "region_edit" ? copy.board.editBadge : null} />
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

function FailedTile({ entry, copy, canGenerate, onRetry, onRemove, canRemove, select, badges, group }: WallProps & Badges & Picking & { entry: Extract<Entry, { type: "failed" }> }) {
  const { job } = entry;
  const key = failedKey(job.id);
  const selected = select.has(key);
  // A block with attachments usually comes from the attachment, so say where to look.
  const reason = job.errorCode === "provider_rejected" && job.references.length > 0 ? copy.board.rejectedWithReferences : errorLine(copy, job.errorCode);
  // The select box only where it fits beside the remove button (a narrow tile keeps remove).
  const tile = useRef<HTMLDivElement>(null);
  const size = useElementSize(tile);
  const coarse = useMediaQuery("(pointer: coarse)");
  const fit = tileControls(size?.width ?? null, { coarse, like: false, tools: canRemove ? 1 : 0 });
  return (
    <div ref={tile} className="bs-tile" data-state="failed" data-studio-job={job.id} data-selected={selected ? "" : undefined} style={tileStyle(entry.ratio)} role="group" aria-label={copy.gallery.failed} {...groupTile(job, group)}>
      {canRemove && fit.check && <TileCheck selected={selected} label={copy.gallery.selectFailed} onPress={(event) => select.press(key, event.shiftKey)} />}
      {canRemove && (
        <button type="button" className="bs-tile-btn bs-tile-remove" data-studio-remove aria-label={copy.gallery.removeFailed} title={copy.gallery.removeFailed} onClick={() => void onRemove?.(job)}>
          <StudioIcon name="trash" />
        </button>
      )}
      <span className="bs-tile-failed-icon" aria-hidden="true">
        <StudioIcon name="info" />
      </span>
      <GroupModelBadge job={job} inline />
      <p className="bs-tile-reason">{reason}</p>
      <VersionBadge n={badges.get(job.id)} copy={copy} />
      {/* A preset workflow run is made again from the workflow, not from here (its text is never shown). */}
      {canGenerate && !job.preset && (
        <button type="button" className="bs-btn bs-tile-retry" data-variant="soft" data-size="sm" onClick={() => onRetry(job)}>
          <StudioIcon name="rerun" />
          {copy.board.retry}
        </button>
      )}
    </div>
  );
}

function ResultTile(props: WallProps & Badges & Picking & { entry: Extract<Entry, { type: "result" }>; n: number }) {
  const { entry, n, copy, locale, canGenerate, canEdit, library, onAction, onNotice, badges, select, group } = props;
  const { output, job } = entry.item;
  const key = resultKey(output.id);
  const selected = select.has(key);
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
  const model = studioModelOrLegacy(job.model);
  const usage = job.estimateKrw > 0 && job.outputs.length > 0 ? Math.ceil(creditsOf(job.estimateKrw) / Math.max(1, job.countedOutputs ?? job.outputs.length)) : 0;
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

  const promptText = promptToCopy(job);
  const copied = useCopied();
  const copyPrompt = () => {
    if (!promptText) return;
    void copyText(promptText, more.current?.parentElement).then((ok) => (ok ? copied.flash() : onNotice(copy.viewer.copyFailed)));
  };
  const item: Record<TileMenuKey, Omit<MenuEntry, "key">> = {
    open: { label: m.open, icon: "open", run: open },
    rerun: { label: m.rerun, icon: "rerun", run: () => onAction("rerun", entry.item) },
    reuse:
      job.kind === "region_edit"
        ? { label: copy.viewer.reuseRegion, icon: "rerun", run: () => onAction("reuse", entry.item) }
        : { label: m.reuse, icon: "reuse", run: () => onAction("reuse", entry.item) },
    "copy-prompt": {
      label: copy.viewer.copyPrompt,
      doneLabel: copy.viewer.copied,
      done: copied.done,
      icon: copied.done ? "check" : "copy",
      keepOpen: true,
      run: copyPrompt,
    },
    region: { label: m.region, icon: "region", run: () => onAction("region", entry.item) },
    decorate: { label: m.decorate, icon: "layers", run: () => onAction("decorate", entry.item) },
    "to-video": { label: m.toVideo, icon: "video", run: () => onAction("toVideo", entry.item) },
    folder: { label: m.folder, icon: "folder-plus", keepOpen: true, disabled: !library.ready, run: () => setPanel("folders") },
    review: { label: locale === "en" ? "Review & Share" : "검수 · 공유", icon: "review", run: () => onAction("review", entry.item) },
    campaign: { label: m.campaign, icon: "send", run: () => onAction("campaign", entry.item) },
    save: { label: m.save, icon: "save", run: () => onAction("save", entry.item) },
    download: { label: m.download, icon: "download", run: () => onAction("download", entry.item) },
    delete: { label: m.delete, icon: "trash", tone: "danger", keepOpen: true, run: () => setPanel("confirm") },
    // On a tile too narrow for every corner button, the ones that do not fit come here.
    select: { label: fill(g.selectTile, { n }), icon: "check", run: () => select.press(key, false) },
    like: { label: liked ? g.unlike : g.like, icon: "heart", disabled: !library.ready, run: () => void like() },
    reference: { label: g.reference, icon: "plus", run: () => onAction("reference", entry.item) },
  };
  // The corner buttons this tile has room for, from its own width (no two overlap; 44 px each on touch).
  const tile = useRef<HTMLElement>(null);
  const size = useElementSize(tile);
  const coarse = useMediaQuery("(pointer: coarse)");
  // A phone shows only "more" in the right corner (studio-v2.css hides "use" and "folder" there).
  const phone = useMediaQuery("(max-width: 900px)");
  const wanted = phone ? 1 : (canGenerate ? 1 : 0) + (canEdit ? 1 : 0) + 1;
  const fit = tileControls(size?.width ?? null, { coarse, like: canEdit, tools: wanted });
  const entries: MenuEntry[] = tileMenuKeys({
    canGenerate,
    canEdit,
    kind: job.kind,
    image,
    sized,
    saved: Boolean(output.savedAssetId),
    copyable: Boolean(promptText),
    inMenu: { select: !fit.check, like: canEdit && !fit.like, reference: canGenerate && (phone || fit.tools < wanted) },
    preset: Boolean(job.preset),
  }).map((key) => ({ key, ...item[key] }));

  return (
    <figure
      ref={tile}
      className="bs-tile"
      data-studio-tile
      data-kind={output.kind}
      data-state="ready"
      data-job-kind={job.kind}
      data-open={panel ? "" : undefined}
      data-liked={liked ? "" : undefined}
      data-selected={selected ? "" : undefined}
      style={tileStyle(entry.ratio)}
      {...groupTile(job, group)}
    >
      <button
        type="button"
        className="bs-tile-open"
        draggable={canEdit}
        onDragStart={(event) => startRefDrag(event, ref)}
        // While tiles are picked (or with Shift held) a press on the picture picks; otherwise it opens.
        onClick={(event) => (select.selecting || event.shiftKey ? select.press(key, event.shiftKey) : open())}
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
      {fit.check && <TileCheck selected={selected} label={fill(g.selectTile, { n })} onPress={(event) => select.press(key, event.shiftKey)} />}
      {/* The bottom edge measures the tile (a container query): the caption shortens its model name, never its
          credits, and a narrow tile shows the partial-edit button as its icon alone. */}
      <div className="bs-tile-foot">
        {canGenerate && image ? (
          <button
            type="button"
            className="bs-tile-pill"
            data-studio-region-pill
            aria-label={m.region}
            onClick={() => onAction("region", entry.item)}
          >
            <StudioIcon name="region" />
            <span className="bs-tile-pill-label">{m.region}</span>
          </button>
        ) : (
          <VersionBadge
            n={badges.get(job.id)}
            copy={copy}
            extra={output.draft ? copy.board.draftBadge : job.kind === "region_edit" ? copy.board.editBadge : null}
          />
        )}
        {job.group && model && (
          // Made with other models in one request: which model this one is, without hovering.
          <span className="bs-tile-model" data-studio-tile-model={job.model} aria-hidden="true">
            {model.label}
          </span>
        )}
        {(model || usage > 0) && (
          <span className="bs-tile-info">
            {model && <span className="bs-tile-info-name">{model.label}</span>}
            {usage > 0 && <span className="bs-tile-info-credits bs-num">{credits(copy.credits.amount, usage, locale)}</span>}
          </span>
        )}
      </div>
      {canEdit && fit.like && (
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
        {canGenerate && fit.tools === wanted && (
          <button type="button" className="bs-tile-btn" data-studio-use aria-label={g.reference} title={g.reference} onClick={() => onAction("reference", entry.item)}>
            <StudioIcon name="plus" />
          </button>
        )}
        {canEdit && fit.tools === wanted && (
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
      {panel === "menu" && <Menu id={`${id}-panel`} label={g.more} entries={entries} anchor={more.current} onClose={close(more.current)} />}
      <span className="bs-sr" aria-live="polite" data-studio-copy-live>
        {copied.done ? copy.viewer.copied : ""}
      </span>
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
