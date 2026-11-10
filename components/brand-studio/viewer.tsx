/**
 * The viewer (docs/BRAND-STUDIO-V2.md §5.2): one result or asset, large, with the actions that apply
 * to it. Esc closes, ←/→ move between results, focus stays inside and returns to where it was.
 */
import { useId, useState, type KeyboardEvent } from "react";
import type { RegionBox, StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioCopy } from "./copy";
import { StudioIcon } from "./icons";
import { useModal } from "./modal";
import { RegionEditor } from "./region-editor";
import { centeredBox } from "./region-math";

export type ViewerItem = { type: "output"; output: StudioOutputView; job: StudioJobView } | { type: "asset"; asset: StudioAssetView };

export interface ViewerActions {
  regionEdit(item: ViewerItem, box: RegionBox, instruction: string): Promise<boolean>;
  rerun(job: StudioJobView): void;
  toVideo(item: ViewerItem): void;
  /** The press alternative to dragging this result or asset into the tray. */
  reference(item: ViewerItem): void;
  save(output: StudioOutputView): void;
  campaign(item: ViewerItem): void;
  finalize(output: StudioOutputView): void;
  reuse(job: StudioJobView): void;
}

export interface ViewerProps {
  items: readonly ViewerItem[];
  index: number;
  copy: StudioCopy;
  /** Owner or editor: may save results and send them to a campaign. */
  canCreate: boolean;
  /** `canCreate` and an open usage limit: may start new runs from here. */
  canGenerate: boolean;
  /** The action currently running, so its button shows it and cannot be pressed twice. */
  busy: string | null;
  notice: string | null;
  parentOf(outputId: string | null): StudioOutputView | null;
  onIndex(index: number): void;
  onClose(): void;
  actions: ViewerActions;
}

export const itemKey = (item: ViewerItem) => (item.type === "output" ? `o:${item.output.id}` : `a:${item.asset.id}`);
const media = (item: ViewerItem) => (item.type === "output" ? item.output : item.asset);
/** Plain image and video runs can run again as they were; edits and remixes go back to the dock. */
export const canRerun = (job: StudioJobView) => job.kind === "image" || job.kind === "video";

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
        <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.prev} disabled={index === 0} onClick={() => onIndex(index - 1)}>
          <StudioIcon name="prev" />
        </button>
        <span className="bs-num bs-muted">
          {index + 1} / {items.length}
        </span>
        <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.next} disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)}>
          <StudioIcon name="next" />
        </button>
        <span className="bs-spacer" />
        <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" aria-label={copy.viewer.close} onClick={onClose}>
          <StudioIcon name="close" />
        </button>
      </div>
      <ViewerContent key={itemKey(item)} {...props} item={item} />
    </dialog>
  );
}

function ViewerContent({ item, copy, canCreate, canGenerate, busy, notice, parentOf, actions }: ViewerProps & { item: ViewerItem }) {
  const v = copy.viewer;
  const [region, setRegion] = useState(false);
  const [box, setBox] = useState<RegionBox | null>(null);
  const [instruction, setInstruction] = useState("");
  const [regionNote, setRegionNote] = useState<string | null>(null);
  const [side, setSide] = useState<"after" | "before">("after");
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
              <button type="button" className="bs-btn" data-variant="solid" data-size="md" disabled={busy === "region"} onClick={() => void sendRegion()} data-studio-region-send>
                {copy.region.send}
              </button>
            </div>
          </div>
        ) : (
          <div className="bs-viewer-actions" data-studio-viewer-actions>
            {canGenerate && image && <Action name="region" label={v.regionEdit} onClick={() => setRegion(true)} />}
            {canGenerate && job && canRerun(job) && <Action name="rerun" label={v.rerun} busy={busy} onClick={() => actions.rerun(job)} />}
            {canGenerate && image && <Action name="to-video" label={v.toVideo} onClick={() => actions.toVideo(item)} />}
            {canGenerate && <Action name="reference" label={v.reference} onClick={() => actions.reference(item)} />}
            {canCreate && item.type === "output" &&
              (item.output.savedAssetId ? (
                <p className="bs-saved" data-studio-saved>{v.saved}</p>
              ) : (
                <Action name="save" label={v.save} busy={busy} onClick={() => actions.save(item.output)} />
              ))}
            {canGenerate && item.type === "output" && item.output.draft && (
              <Action name="finalize" label={v.finalize} busy={busy} onClick={() => actions.finalize(item.output)} />
            )}
            {canCreate && <Action name="campaign" label={v.campaign} onClick={() => actions.campaign(item)} />}
            <a className="bs-btn" data-variant="ghost" data-size="md" href={file.url} download target="_blank" rel="noopener noreferrer" data-action="download">
              {v.download}
            </a>
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

function Action({ name, label, busy = null, onClick }: { name: string; label: string; busy?: string | null; onClick(): void }) {
  return (
    <button type="button" className="bs-btn" data-variant="soft" data-size="md" data-action={name} disabled={busy === name} aria-busy={busy === name} onClick={onClick}>
      {label}
    </button>
  );
}
