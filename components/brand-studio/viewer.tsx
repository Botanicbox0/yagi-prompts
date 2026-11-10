/**
 * The viewer (docs/BRAND-STUDIO-V2.md §5.2): one result or asset, large, with the actions that apply
 * to it. A centred dialog (full screen on a phone); only the side column scrolls. Esc closes, ←/→ move
 * between results, focus stays inside and returns to where it was.
 */
import { useId, useState, type KeyboardEvent } from "react";
import type { RegionBox, StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioCopy } from "./copy";
import { StudioIcon, type StudioIconName } from "./icons";
import { useModal } from "./modal";
import { RegionEditor } from "./region-editor";
import { centeredBox } from "./region-math";

export type ViewerItem = { type: "output"; output: StudioOutputView; job: StudioJobView } | { type: "asset"; asset: StudioAssetView };

export interface ViewerActions {
  regionEdit(item: ViewerItem, box: RegionBox, instruction: string): Promise<boolean>;
  /** Plain runs start again as they were; a partial edit reopens its box; a reference-video run goes back to the dock. */
  rerun(job: StudioJobView): void;
  toVideo(item: ViewerItem): void;
  /** The press alternative to dragging this result or asset into the tray. */
  reference(item: ViewerItem): void;
  save(output: StudioOutputView): void;
  campaign(item: ViewerItem): void;
  finalize(output: StudioOutputView): void;
  reuse(job: StudioJobView): void;
  /** True when the result is gone. */
  remove(output: StudioOutputView): Promise<boolean>;
}

/** Opens the partial-edit form on one item with a box and an instruction already in place. */
export interface RegionPreset {
  key: string;
  box: RegionBox | null;
  instruction: string;
}

export interface ViewerProps {
  items: readonly ViewerItem[];
  index: number;
  copy: StudioCopy;
  /** Owner or editor: may save results, delete them and send them to a campaign. */
  canCreate: boolean;
  /** `canCreate` and an open usage limit: may start new runs from here. */
  canGenerate: boolean;
  /** The action currently running, so its button shows it and cannot be pressed twice. */
  busy: string | null;
  notice: string | null;
  /** What one partial edit takes from the allowance, already formatted ("약 ₩211"). */
  regionQuote?: string | null;
  regionPreset?: RegionPreset | null;
  parentOf(outputId: string | null): StudioOutputView | null;
  onIndex(index: number): void;
  onClose(): void;
  actions: ViewerActions;
}

export const itemKey = (item: ViewerItem) => (item.type === "output" ? `o:${item.output.id}` : `a:${item.asset.id}`);
const media = (item: ViewerItem) => (item.type === "output" ? item.output : item.asset);
/** Everything but a 1080p final can be made again with the settings it had. */
export const canRerun = (job: StudioJobView) => job.kind !== "video_final";

export function Viewer(props: ViewerProps) {
  const { items, index, copy, onIndex, onClose } = props;
  const ref = useModal();
  const id = useId();
  const item = items[index];
  if (!item) return null;
  const keys = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.defaultPrevented || (event.target as HTMLElement).closest?.("input, textarea, select")) return;
    if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    else if (event.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
  };
  return (
    <dialog
      ref={ref}
      className="bs-viewer"
      aria-labelledby={`${id}-title`}
      data-studio-viewer
      onKeyDown={keys}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="bs-viewer-bar">
        <h2 id={`${id}-title`} className="bs-sr">
          {item.type === "output" ? copy.viewer.label : copy.viewer.assetLabel}
        </h2>
        <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.prev} disabled={index === 0} onClick={() => onIndex(index - 1)}>
          <StudioIcon name="prev" />
        </button>
        <span className="bs-num bs-muted">
          {index + 1} / {items.length}
        </span>
        <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.next} disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)}>
          <StudioIcon name="next" />
        </button>
        <span className="bs-spacer" />
        <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.close} onClick={onClose}>
          <StudioIcon name="close" />
        </button>
      </div>
      <ViewerContent key={itemKey(item)} {...props} item={item} />
    </dialog>
  );
}

function ViewerContent({ item, copy, canCreate, canGenerate, busy, notice, regionQuote = null, regionPreset = null, parentOf, actions }: ViewerProps & { item: ViewerItem }) {
  const v = copy.viewer;
  const preset = regionPreset?.key === itemKey(item) ? regionPreset : null;
  const [region, setRegion] = useState(Boolean(preset));
  const [box, setBox] = useState<RegionBox | null>(preset?.box ?? null);
  const [instruction, setInstruction] = useState(preset?.instruction ?? "");
  const [regionNote, setRegionNote] = useState<string | null>(null);
  const [side, setSide] = useState<"after" | "before">("after");
  const [confirming, setConfirming] = useState(false);
  const id = useId();
  const file = media(item);
  const job = item.type === "output" ? item.job : null;
  const parent = job ? parentOf(job.parentOutputId) : null;
  const shown = side === "before" && parent ? parent : file;
  const image = file.kind === "image";
  const name = item.type === "asset" ? item.asset.name : "";

  const picture =
    shown.kind === "video" ? (
      <video src={shown.url} poster={shown.thumbUrl ?? undefined} controls playsInline preload="metadata" />
    ) : shown.kind === "audio" ? (
      <audio src={shown.url} controls preload="metadata" />
    ) : (
      <img src={shown.url} alt={name} draggable={false} />
    );

  async function sendRegion() {
    if (!box) return setRegionNote(copy.region.needBox);
    if (!instruction.trim()) return setRegionNote(copy.dock.emptyPrompt);
    setRegionNote(null);
    if (await actions.regionEdit(item, box, instruction.trim())) {
      setRegion(false);
      setBox(null);
      setInstruction("");
    }
  }

  const tiles: Array<{ name: string; icon: StudioIconName; label: string; run(): void; show: boolean }> = [
    { name: "region", icon: "region", label: v.regionEdit, run: () => setRegion(true), show: canGenerate && image },
    { name: "rerun", icon: "rerun", label: v.rerun, run: () => job && actions.rerun(job), show: canGenerate && Boolean(job && canRerun(job)) },
    { name: "to-video", icon: "video", label: v.toVideo, run: () => actions.toVideo(item), show: canGenerate && image },
    { name: "reference", icon: "attach", label: v.reference, run: () => actions.reference(item), show: canGenerate },
    { name: "save", icon: "save", label: v.save, run: () => item.type === "output" && actions.save(item.output), show: canCreate && item.type === "output" && !item.output.savedAssetId },
    { name: "finalize", icon: "spark", label: v.finalize, run: () => item.type === "output" && actions.finalize(item.output), show: canGenerate && item.type === "output" && item.output.draft },
    { name: "campaign", icon: "send", label: v.campaign, run: () => actions.campaign(item), show: canCreate },
  ];
  const saved = canCreate && item.type === "output" && Boolean(item.output.savedAssetId);

  return (
    <div className="bs-viewer-body">
      <figure className="bs-viewer-media" data-kind={shown.kind}>
        {region ? (
          <RegionEditor box={box} onChange={setBox} copy={copy}>
            {picture}
          </RegionEditor>
        ) : (
          picture
        )}
      </figure>
      <div className="bs-viewer-side">
        {parent && job && (
          <fieldset className="bs-seg" data-studio-compare>
            <legend className="bs-sr">{v.compare}</legend>
            {(["before", "after"] as const).map((value) => (
              <label key={value} className="bs-seg-option">
                <input type="radio" name={`${id}-compare`} value={value} checked={side === value} onChange={() => setSide(value)} />
                <span>{v[value]}</span>
              </label>
            ))}
          </fieldset>
        )}
        {region ? (
          <div className="bs-region-form" data-studio-region-form>
            <p className="bs-muted">{copy.region.hint}</p>
            {!box && (
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => setBox(centeredBox())}>
                <StudioIcon name="region" />
                {copy.region.place}
              </button>
            )}
            <label className="bs-label" htmlFor={`${id}-instruction`}>
              {copy.region.instruction}
            </label>
            <textarea
              id={`${id}-instruction`}
              className="bs-field"
              rows={3}
              value={instruction}
              placeholder={copy.region.instructionPlaceholder}
              onChange={(event) => setInstruction(event.target.value)}
            />
            {regionNote && <p className="bs-dock-message" role="alert">{regionNote}</p>}
            <div className="bs-row">
              <button type="button" className="bs-btn" data-variant="ghost" data-size="md" onClick={() => setRegion(false)}>
                {copy.region.cancel}
              </button>
              <span className="bs-spacer" />
              {regionQuote && <span className="bs-num bs-quote" data-studio-region-quote>{regionQuote}</span>}
              <button type="button" className="bs-btn" data-variant="solid" data-size="md" disabled={busy === "region"} onClick={() => void sendRegion()} data-studio-region-send>
                {copy.region.send}
              </button>
            </div>
          </div>
        ) : (
          <div className="bs-viewer-actions" data-studio-viewer-actions>
            <div className="bs-action-grid">
              {tiles.filter((tile) => tile.show).map((tile) => (
                <button
                  key={tile.name}
                  type="button"
                  className="bs-btn bs-action"
                  data-variant="soft"
                  data-action={tile.name}
                  disabled={busy === tile.name}
                  aria-busy={busy === tile.name}
                  onClick={tile.run}
                >
                  <StudioIcon name={tile.icon} />
                  <span>{tile.label}</span>
                </button>
              ))}
              {saved && (
                <p className="bs-action bs-action-done" data-studio-saved>
                  <StudioIcon name="save" />
                  <span>{v.saved}</span>
                </p>
              )}
            </div>
            <div className="bs-row bs-quiet-actions">
              <a className="bs-btn" data-variant="ghost" data-size="sm" href={file.url} download target="_blank" rel="noopener noreferrer" data-action="download">
                <StudioIcon name="download" />
                {v.download}
              </a>
              {canCreate && item.type === "output" && !confirming && (
                <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" data-action="delete" onClick={() => setConfirming(true)}>
                  <StudioIcon name="trash" />
                  {v.delete}
                </button>
              )}
            </div>
            {confirming && item.type === "output" && (
              <div className="bs-confirm-box" role="group" aria-label={v.delete} data-studio-delete-confirm>
                <p>{v.deleteConfirm}</p>
                <div className="bs-row">
                  <button type="button" className="bs-btn" data-variant="soft" data-size="sm" data-tone="danger" disabled={busy === "delete"} onClick={() => void actions.remove(item.output).then((gone) => !gone && setConfirming(false))}>
                    {v.delete}
                  </button>
                  <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={() => setConfirming(false)}>
                    {v.cancel}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {notice && <p className="bs-notice" role="status">{notice}</p>}
        {job && (
          <details className="bs-prompt-details" data-studio-prompt-details>
            <summary>{v.promptToggle}</summary>
            <p className="bs-label">{v.yourPrompt}</p>
            <p>{job.prompt || copy.board.noPrompt}</p>
            <p className="bs-label">{v.sentPrompt}</p>
            <p>{job.finalPrompt ?? v.notEnhanced}</p>
            {canGenerate && job.kind !== "video_final" && (
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => actions.reuse(job)}>
                {v.reuse}
              </button>
            )}
          </details>
        )}
      </div>
    </div>
  );
}
