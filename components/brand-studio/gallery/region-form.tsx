"use client";
/**
 * The partial-edit form v2 (docs/BRAND-STUDIO-V3.md §4 "부분 수정 v2"), beside the picture in the viewer.
 *
 * Once a box is drawn: the input preview (the cut-out, picture 1), then the references numbered from 2
 * (dragged in from the gallery or the library, picked from the recent strip, or chosen as files), each
 * with what it is (로고 · 제품 · 인물 · 스타일), the model (only those that edit a part well), the cost in
 * credits and the instruction. Sending closes the form at once; the run shows up in the wall.
 */
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent } from "react";
import { extractClipboardImages, prepareClipboardUploadFiles } from "@/lib/brand-studio/clipboard-image";
import { STUDIO_LIMITS, STUDIO_UPLOAD_MIMES, type RegionBox, type StudioAssetRole } from "@/lib/brand-studio/contracts";
import type { StudioImageModel } from "@/lib/brand-studio/models";
import { credits, fill, type StudioCopy, type StudioLocale } from "../copy";
import { StudioIcon } from "../icons";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, startRefDrag, type RefSource, type TrayItem } from "../refs";
import { centeredBox } from "../region-math";

/** The kinds a partial-edit reference can be (docs/BRAND-STUDIO-V3.md §4). */
export const REGION_ROLES = ["logo", "product", "person", "style"] as const satisfies readonly StudioAssetRole[];

/** The cut-out as CSS: the picture scaled so the box fills the frame (no canvas, nothing to taint). */
export function cropStyle(box: RegionBox, size: { width: number | null; height: number | null }, url: string): Record<string, string> {
  const w = Math.max(0.02, box.w);
  const h = Math.max(0.02, box.h);
  const at = (start: number, span: number) => (span >= 0.999 ? 0 : (start / (1 - span)) * 100);
  const cw = size.width && size.height ? Math.max(1, Math.round(w * size.width)) : w;
  const ch = size.width && size.height ? Math.max(1, Math.round(h * size.height)) : h;
  return {
    backgroundImage: `url("${url.replace(/"/g, "%22")}")`,
    backgroundSize: `${(100 / w).toFixed(3)}% ${(100 / h).toFixed(3)}%`,
    backgroundPosition: `${at(box.x, w).toFixed(3)}% ${at(box.y, h).toFixed(3)}%`,
    aspectRatio: `${cw} / ${ch}`,
    "--crop-r": (cw / ch).toFixed(4),
  };
}

export interface RegionFormProps {
  picture: { url: string; width: number | null; height: number | null };
  box: RegionBox | null;
  copy: StudioCopy;
  locale: StudioLocale;
  models: readonly StudioImageModel[];
  model: string;
  /** "" when the model has no quality choice (no select is shown). */
  quality: string;
  references: readonly TrayItem[];
  /** Recent pictures to press or drag in (results and uploads). */
  recent: readonly TrayItem[];
  instruction: string;
  note: string | null;
  credits: number;
  uploading: boolean;
  onBox(box: RegionBox): void;
  onModel(id: string): void;
  onQuality(quality: string): void;
  onReferences(next: TrayItem[]): void;
  /** A dragged result or asset, as a reference (null when it is not a picture this screen knows). */
  resolve(source: RefSource): TrayItem | null;
  onFiles(files: File[]): void;
  onInstruction(text: string): void;
  onCancel(): void;
  onSend(): void;
}

export function RegionForm(props: RegionFormProps) {
  const { box, copy, locale, references } = props;
  const r = copy.region;
  const id = useId();
  const files = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const full = references.length + 1 >= (props.models.find((m) => m.id === props.model)?.maxReferences ?? STUDIO_LIMITS.referencesMax);

  const add = (item: TrayItem | null) => {
    if (!item || item.kind !== "image" || references.some((ref) => ref.key === item.key) || full) return;
    props.onReferences([...references, { ...item, role: REGION_ROLES.includes(item.role as never) ? item.role : undefined }]);
  };
  const drop = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    setDropActive(false);
    const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (source) add(props.resolve(source));
    else if (event.dataTransfer.files.length) props.onFiles(Array.from(event.dataTransfer.files));
  };

  const ingestClipboardFiles = useCallback(
    (rawFiles: File[]) => {
      if (!rawFiles.length || full) return;
      void prepareClipboardUploadFiles(rawFiles).then((ready) => {
        if (ready.length) props.onFiles(ready);
      });
    },
    [full, props.onFiles],
  );

  const onFormPaste = (event: ReactClipboardEvent) => {
    const pasted = extractClipboardImages(event.clipboardData);
    if (!pasted.length) return;
    event.preventDefault();
    event.stopPropagation();
    ingestClipboardFiles(pasted);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onWindowPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const pasted = extractClipboardImages(event.clipboardData);
      if (!pasted.length) return;
      event.preventDefault();
      event.stopPropagation();
      ingestClipboardFiles(pasted);
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [ingestClipboardFiles]);

  return (
    <form
      className="bs-region-form"
      data-studio-region-form
      data-drop-target={dropActive ? "" : undefined}
      onPaste={onFormPaste}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSend();
      }}
      onDragOver={(event) => {
        if (!acceptsDrag(event.dataTransfer?.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={drop}
    >
      <h3 className="bs-region-title">{copy.viewer.regionEdit}</h3>
      <p className="bs-muted">{r.hint}</p>
      {!box ? (
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => props.onBox(centeredBox())}>
          <StudioIcon name="region" />
          {r.place}
        </button>
      ) : (
        <div className="bs-region-inputs" data-studio-region-inputs>
          <figure className="bs-region-preview" data-studio-region-preview>
            <span className="bs-region-crop" role="img" aria-label={r.preview} style={cropStyle(box, props.picture, props.picture.url)} />
            <figcaption>
              <span className="bs-thumb-n bs-num">1</span>
              <span className="bs-label">{r.preview}</span>
            </figcaption>
          </figure>
          <div className="bs-region-refs" role="group" aria-labelledby={`${id}-refs`}>
            <p id={`${id}-refs`} className="bs-label">
              {r.refs}
            </p>
            <ul className="bs-region-ref-list">
              {references.map((ref, i) => (
                <li key={ref.key} className="bs-region-ref" data-region-ref={i + 2}>
                  <span className="bs-thumb" data-static>
                    <img src={ref.thumbUrl ?? ref.url} alt="" draggable={false} />
                  </span>
                  <span className="bs-thumb-n bs-num" aria-hidden="true">
                    {i + 2}
                  </span>
                  <button type="button" className="bs-thumb-x" aria-label={fill(r.removeRef, { n: i + 2 })} onClick={() => props.onReferences(references.filter((x) => x.key !== ref.key))}>
                    <StudioIcon name="close" />
                  </button>
                  <label className="bs-sr" htmlFor={`${id}-role-${i}`}>
                    {fill(r.roleLabel, { n: i + 2 })}
                  </label>
                  <select
                    id={`${id}-role-${i}`}
                    className="bs-role-select"
                    value={ref.role ?? ""}
                    onChange={(event) =>
                      props.onReferences(references.map((x) => (x.key === ref.key ? { ...x, role: (event.target.value || undefined) as StudioAssetRole | undefined } : x)))
                    }
                  >
                    <option value="">{r.roleNone}</option>
                    {REGION_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {copy.roles[role]}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
              <li className="bs-region-ref">
                <button type="button" className="bs-thumb bs-thumb-add" disabled={full || props.uploading} aria-label={r.addRefs} title={r.addRefs} onClick={() => files.current?.click()}>
                  <StudioIcon name={props.uploading ? "spark" : "plus"} />
                </button>
                <input
                  ref={files}
                  type="file"
                  className="bs-sr"
                  tabIndex={-1}
                  accept={STUDIO_UPLOAD_MIMES.image.join(",")}
                  multiple
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (picked.length) props.onFiles(picked);
                  }}
                />
              </li>
            </ul>
            <p className="bs-muted">{dropActive ? r.dropHere : r.refsHint}</p>
            {props.recent.length > 0 && (
              <div className="bs-region-recent">
                <p className="bs-label">{r.recent}</p>
                <ul className="bs-strip">
                  {props.recent.map((item) => {
                    const taken = references.some((ref) => ref.key === item.key);
                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          className="bs-thumb"
                          data-taken={taken ? "" : undefined}
                          disabled={taken || full}
                          draggable
                          onDragStart={(event) => startRefDrag(event, item.assetId ? { assetId: item.assetId } : { outputId: item.outputId! })}
                          aria-label={fill(r.addOne, { name: item.name })}
                          onClick={() => add(item)}
                        >
                          <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" draggable={false} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
      {props.models.length > 1 && (
        <span className="bs-select" data-control="region-model">
          <label htmlFor={`${id}-model`} className="bs-sr">
            {r.model}
          </label>
          <span className="bs-select-value" aria-hidden="true">
            {props.models.find((m) => m.id === props.model)?.label}
          </span>
          <StudioIcon name="chevron" />
          <select id={`${id}-model`} value={props.model} onChange={(event) => props.onModel(event.target.value)}>
            {props.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </span>
      )}
      {(() => {
        const qualities = props.models.find((m) => m.id === props.model)?.qualities ?? [];
        if (!qualities.length) return null;
        const label = (q: string) => copy.qualities[q as keyof StudioCopy["qualities"]] ?? q;
        return (
          <span className="bs-select" data-control="region-quality">
            <label htmlFor={`${id}-quality`} className="bs-sr">
              {copy.dock.quality}
            </label>
            <span className="bs-select-value" aria-hidden="true">
              {label(props.quality)}
            </span>
            <StudioIcon name="chevron" />
            <select id={`${id}-quality`} value={props.quality} onChange={(event) => props.onQuality(event.target.value)}>
              {qualities.map((q) => (
                <option key={q} value={q}>
                  {label(q)}
                </option>
              ))}
            </select>
          </span>
        );
      })()}
      <label className="bs-label" htmlFor={`${id}-instruction`}>
        {r.instruction}
      </label>
      <textarea
        id={`${id}-instruction`}
        className="bs-field"
        rows={3}
        maxLength={STUDIO_LIMITS.promptMax}
        value={props.instruction}
        placeholder={references.length ? r.instructionWithRefs : r.instructionPlaceholder}
        onChange={(event) => props.onInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {props.note && (
        <p className="bs-dock-message" role="alert">
          {props.note}
        </p>
      )}
      <div className="bs-row bs-region-actions">
        <button type="button" className="bs-btn" data-variant="ghost" data-size="md" onClick={props.onCancel}>
          {r.cancel}
        </button>
        <span className="bs-spacer" />
        <button type="submit" className="bs-btn bs-submit" data-variant="solid" data-size="md" data-studio-region-send>
          <span>{r.send}</span>
          <span className="bs-submit-cost bs-num" data-studio-region-quote>
            {credits(copy.credits.amount, props.credits, locale)}
          </span>
        </button>
      </div>
    </form>
  );
}
