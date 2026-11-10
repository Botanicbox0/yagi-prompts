"use client";
/**
 * The editor's side panels: what to add (text, shapes, pictures from the library), the layer list and
 * the properties of the selected layer. Thin: every change goes back through callbacks to the editor.
 */
import { useId, useState, type ReactNode } from "react";
import type { StudioAssetRole } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { startRefDrag, type RefSource } from "../refs";
import type { StudioLibrary } from "../seams";
import { isLight, normalizeHex } from "./colors";
import { LayerIcon, type LayerIconName } from "./icons";
import {
  FONTS,
  SWATCHES,
  canMove,
  clamp,
  fontChoice,
  type FontId,
  type Layer,
  type LayerDoc,
  type LayerPatch,
  type ShapeLayer,
  type TextAlign,
  type TextLayer,
} from "./model";

export type LayersCopy = Dictionary["studioLayers"];

export const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));

/** Something that can become an image layer. */
export interface PickItem {
  key: string;
  ref: RefSource | null;
  url: string;
  thumbUrl: string | null;
  name: string;
  width: number | null;
  height: number | null;
  role?: StudioAssetRole | null;
}

/* ------------------------------------------------------------- add panel */

export interface AddPanelProps {
  copy: LayersCopy;
  assets: PickItem[];
  library: StudioLibrary | null;
  likedItems: PickItem[];
  folderItems(folderId: string): PickItem[] | null;
  uploading: string[];
  onAddText(): void;
  onAddShape(shape: "rect" | "ellipse"): void;
  onPick(item: PickItem): void;
  onFiles(files: File[]): void;
}

type PickTab = "assets" | "liked" | "folders";

export function AddPanel({ copy, assets, library, likedItems, folderItems, uploading, onAddText, onAddShape, onPick, onFiles }: AddPanelProps) {
  const a = copy.add;
  const id = useId();
  const [tab, setTab] = useState<PickTab>("assets");
  const [folder, setFolder] = useState<string | null>(null);
  const tabs: Array<[PickTab, string]> = library ? [["assets", a.tabAssets], ["liked", a.tabLiked], ["folders", a.tabFolders]] : [["assets", a.tabAssets]];
  const openFolder = folder ? folderItems(folder) : null;

  return (
    <div className="bsl-panel-body" data-layers-add>
      <h2 className="bsl-panel-title">{a.title}</h2>
      <div className="bsl-add-grid">
        <AddButton icon="text" label={a.text} onClick={onAddText} data="text" />
        <AddButton icon="rect" label={a.rect} onClick={() => onAddShape("rect")} data="rect" />
        <AddButton icon="ellipse" label={a.ellipse} onClick={() => onAddShape("ellipse")} data="ellipse" />
      </div>

      <h3 className="bsl-panel-subtitle">{a.images}</h3>
      <label className="bsl-btn bsl-upload" data-variant="soft" htmlFor={`${id}-file`}>
        <LayerIcon name="upload" />
        <span>{uploading.length ? a.uploading : a.upload}</span>
      </label>
      <input
        id={`${id}-file`}
        className="bsl-sr"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {tabs.length > 1 && (
        <div className="bsl-seg" role="tablist" aria-label={a.images}>
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${id}-tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`${id}-panel`}
              className="bsl-seg-btn"
              onClick={() => {
                setTab(value);
                setFolder(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div id={`${id}-panel`} role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `${id}-tab-${tab}` : undefined} className="bsl-pick">
        <p className="bsl-hint">{a.dragHint}</p>
        {tab === "assets" && <PickGrid items={assets} empty={a.emptyAssets} copy={copy} onPick={onPick} />}
        {tab === "liked" && <PickGrid items={likedItems} empty={a.emptyLiked} copy={copy} onPick={onPick} />}
        {tab === "folders" && library && !folder && (
          library.folders.length ? (
            <ul className="bsl-folders">
              {library.folders.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="bsl-folder"
                    onClick={() => {
                      library.openFolder(f.id);
                      setFolder(f.id);
                    }}
                  >
                    <LayerIcon name="folder" />
                    <span className="bsl-ellipsis">{f.name}</span>
                    <span className="bsl-num bsl-muted">{f.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bsl-hint">{library.ready ? a.emptyFolders : a.loading}</p>
          )
        )}
        {tab === "folders" && folder && (
          <>
            <button type="button" className="bsl-btn" data-variant="ghost" data-size="sm" onClick={() => setFolder(null)}>
              <LayerIcon name="back" />
              {a.allFolders}
            </button>
            {openFolder ? <PickGrid items={openFolder} empty={a.folderEmpty} copy={copy} onPick={onPick} /> : <p className="bsl-hint">{a.loading}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function AddButton({ icon, label, onClick, data }: { icon: LayerIconName; label: string; onClick(): void; data: string }) {
  return (
    <button type="button" className="bsl-add" onClick={onClick} data-add={data}>
      <LayerIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function PickGrid({ items, empty, copy, onPick }: { items: PickItem[]; empty: string; copy: LayersCopy; onPick(item: PickItem): void }) {
  if (!items.length) return <p className="bsl-hint">{empty}</p>;
  return (
    <ul className="bsl-pick-grid" data-layers-picker>
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="bsl-pick-item"
            draggable={Boolean(item.ref)}
            aria-label={fill(copy.add.addImage, { name: item.name })}
            title={item.name}
            onClick={() => onPick(item)}
            onDragStart={(event) => item.ref && startRefDrag(event, item.ref)}
          >
            <img src={item.thumbUrl ?? item.url} alt="" draggable={false} loading="lazy" />
            {item.role === "logo" && <span className="bsl-pick-role">{copy.add.roleLogo}</span>}
            {item.role === "product" && <span className="bsl-pick-role">{copy.add.roleProduct}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------- layer list */

export interface LayersPanelProps {
  copy: LayersCopy;
  doc: LayerDoc;
  baseThumb: string;
  selectedId: string | null;
  onSelect(id: string): void;
  onPatch(id: string, patch: LayerPatch): void;
}

export function LayersPanel({ copy, doc, baseThumb, selectedId, onSelect, onPatch }: LayersPanelProps) {
  const l = copy.layers;
  const [renaming, setRenaming] = useState<string | null>(null);
  const top = [...doc.layers].reverse();
  return (
    <div className="bsl-panel-body" data-layers-list>
      <h2 className="bsl-panel-title">
        {l.title}
        <span className="bsl-count bsl-num">{doc.layers.length}</span>
      </h2>
      {!doc.layers.length && <p className="bsl-hint">{l.empty}</p>}
      <ul className="bsl-layer-list">
        {top.map((layer) => (
          <li key={layer.id} className="bsl-layer-row" data-selected={layer.id === selectedId || undefined} data-hidden={layer.hidden || undefined}>
            {renaming === layer.id ? (
              <RenameField
                label={l.renameLabel}
                value={layer.name}
                onDone={(name) => {
                  setRenaming(null);
                  if (name !== null && name.trim()) onPatch(layer.id, { name: name.trim() });
                }}
              />
            ) : (
              <button
                type="button"
                className="bsl-layer-pick"
                aria-pressed={layer.id === selectedId}
                aria-label={fill(l.select, { name: layer.name })}
                onClick={() => onSelect(layer.id)}
                onDoubleClick={() => setRenaming(layer.id)}
              >
                <LayerThumb layer={layer} />
                <span className="bsl-ellipsis">{layer.name}</span>
              </button>
            )}
            <IconButton icon="pencil" label={`${layer.name} · ${l.rename}`} onClick={() => setRenaming(layer.id)} quiet />
            <IconButton icon={layer.hidden ? "eyeOff" : "eye"} label={`${layer.name} · ${layer.hidden ? l.show : l.hide}`} on={layer.hidden} onClick={() => onPatch(layer.id, { hidden: !layer.hidden })} quiet />
            <IconButton icon={layer.locked ? "lock" : "unlock"} label={`${layer.name} · ${layer.locked ? l.unlock : l.lock}`} on={layer.locked} onClick={() => onPatch(layer.id, { locked: !layer.locked })} quiet />
          </li>
        ))}
        <li className="bsl-layer-row" data-base>
          <span className="bsl-layer-pick" aria-disabled="true">
            <span className="bsl-layer-thumb">
              <img src={baseThumb} alt="" draggable={false} />
            </span>
            <span className="bsl-ellipsis">{copy.names.base}</span>
          </span>
          <span className="bsl-layer-fixed">
            <LayerIcon name="lock" />
          </span>
        </li>
      </ul>
    </div>
  );
}

function LayerThumb({ layer }: { layer: Layer }) {
  if (layer.kind === "image")
    return (
      <span className="bsl-layer-thumb">
        <img src={layer.src.url} alt="" draggable={false} loading="lazy" />
      </span>
    );
  return (
    <span className="bsl-layer-thumb" data-kind={layer.kind}>
      <LayerIcon name={layer.kind === "text" ? "text" : layer.shape === "ellipse" ? "ellipse" : "rect"} />
    </span>
  );
}

function RenameField({ label, value, onDone }: { label: string; value: string; onDone(name: string | null): void }) {
  const [text, setText] = useState(value);
  return (
    <input
      className="bsl-input bsl-rename"
      aria-label={label}
      value={text}
      maxLength={60}
      autoFocus
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onDone(text);
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone(null);
        }
      }}
    />
  );
}

/** `on` only tints the icon; a toggle says its next action in its label (숨기기 ↔ 보이기). */
export function IconButton({ icon, label, onClick, on, disabled, quiet, data }: { icon: LayerIconName; label: string; onClick(): void; on?: boolean; disabled?: boolean; quiet?: boolean; data?: string }) {
  return (
    <button
      type="button"
      className="bsl-icon-btn"
      data-quiet={quiet || undefined}
      data-on={on || undefined}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-action={data}
    >
      <LayerIcon name={icon} />
    </button>
  );
}

/* -------------------------------------------------------------- inspector */

export interface PropsPanelProps {
  copy: LayersCopy;
  doc: LayerDoc;
  layer: Layer | null;
  /** The height shown for text (laid out, not stored). */
  frameHeight: number;
  recent: string[];
  onPatch(id: string, patch: LayerPatch, key?: string): void;
  onColorUsed(color: string): void;
  onEditText(id: string): void;
  onTogglePlate(layer: TextLayer): void;
  onRestoreRatio(id: string): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
  onMove(id: string, step: 1 | -1): void;
}

export function PropsPanel(props: PropsPanelProps) {
  const { copy, doc, layer, frameHeight, onPatch } = props;
  const p = copy.props;
  const l = copy.layers;
  if (!layer)
    return (
      <div className="bsl-panel-body" data-layers-props>
        <h2 className="bsl-panel-title">{p.title}</h2>
        <p className="bsl-hint">{p.nothing}</p>
      </div>
    );
  const set = (patch: LayerPatch, key?: string) => onPatch(layer.id, patch, key ? `${layer.id}:${key}` : undefined);
  const isText = layer.kind === "text";
  return (
    // Keyed by layer: half-typed field values never carry over to the next selected layer.
    <div key={layer.id} className="bsl-panel-body" data-layers-props data-kind={layer.kind}>
      <h2 className="bsl-panel-title">
        <span className="bsl-ellipsis">{layer.name}</span>
      </h2>
      <div className="bsl-toolrow" role="group" aria-label={p.title}>
        <IconButton icon="up" label={l.forward} disabled={!canMove(doc, layer.id, 1)} onClick={() => props.onMove(layer.id, 1)} data="forward" />
        <IconButton icon="down" label={l.backward} disabled={!canMove(doc, layer.id, -1)} onClick={() => props.onMove(layer.id, -1)} data="backward" />
        <IconButton icon="copy" label={l.duplicate} onClick={() => props.onDuplicate(layer.id)} data="duplicate" />
        <IconButton icon={layer.locked ? "lock" : "unlock"} label={layer.locked ? l.unlock : l.lock} on={layer.locked} onClick={() => set({ locked: !layer.locked })} data="lock" />
        <IconButton icon={layer.hidden ? "eyeOff" : "eye"} label={layer.hidden ? l.show : l.hide} on={layer.hidden} onClick={() => set({ hidden: !layer.hidden })} data="hide" />
        <IconButton icon="trash" label={l.delete} disabled={layer.locked} onClick={() => props.onDelete(layer.id)} data="delete" />
      </div>

      {layer.kind === "text" && <TextProps {...props} layer={layer} set={set} />}
      {layer.kind === "shape" && <ShapeProps {...props} layer={layer} set={set} />}
      {layer.kind === "image" && (
        <button type="button" className="bsl-btn" data-variant="soft" data-size="sm" onClick={() => props.onRestoreRatio(layer.id)}>
          <LayerIcon name="ratio" />
          {p.restoreRatio}
        </button>
      )}

      <fieldset className="bsl-fieldset" disabled={layer.locked}>
        <div className="bsl-grid2">
          <NumberField label={p.x} value={layer.x} onChange={(x) => set({ x }, "x")} />
          <NumberField label={p.y} value={layer.y} onChange={(y) => set({ y }, "y")} />
          <NumberField label={p.w} value={layer.w} min={4} onChange={(w) => set(widthPatch(layer, w), "w")} />
          <NumberField label={p.h} value={isText ? frameHeight : layer.h} min={4} disabled={isText} onChange={(h) => set(heightPatch(layer, h), "h")} />
          <NumberField label={p.rotation} value={layer.rotation} step={1} suffix="°" onChange={(rotation) => set({ rotation }, "rotation")} />
          <NumberField label={p.opacity} value={Math.round(layer.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ opacity: clamp(v, 0, 100) / 100 }, "opacity")} />
        </div>
        <input
          className="bsl-range"
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          aria-label={p.opacity}
          onChange={(event) => set({ opacity: Number(event.target.value) / 100 }, "opacity")}
        />
      </fieldset>
    </div>
  );
}

/** Images keep their ratio when the width is typed; text keeps its height (it follows the lines). */
function widthPatch(layer: Layer, w: number): LayerPatch {
  if (layer.kind === "image" && layer.w > 0) return { w, h: (layer.h / layer.w) * w };
  return { w };
}

function heightPatch(layer: Layer, h: number): LayerPatch {
  if (layer.kind === "image" && layer.h > 0) return { h, w: (layer.w / layer.h) * h };
  return { h };
}

type SetFn = (patch: LayerPatch, key?: string) => void;

function TextProps({ copy, layer, set, recent, onColorUsed, onEditText, onTogglePlate }: PropsPanelProps & { layer: TextLayer; set: SetFn }) {
  const p = copy.props;
  const id = useId();
  const weights = fontChoice(layer.font).weights;
  return (
    <fieldset className="bsl-fieldset" disabled={layer.locked}>
      <label className="bsl-label" htmlFor={`${id}-text`}>
        {p.content}
      </label>
      <textarea
        id={`${id}-text`}
        className="bsl-input bsl-textarea"
        rows={3}
        value={layer.text}
        maxLength={2000}
        onChange={(event) => set({ text: event.target.value }, "text")}
      />
      <button type="button" className="bsl-btn" data-variant="ghost" data-size="sm" onClick={() => onEditText(layer.id)}>
        <LayerIcon name="pencil" />
        {p.editInPlace}
      </button>
      <div className="bsl-grid2">
        <SelectField label={p.font} value={layer.font} onChange={(font) => set({ font: font as FontId })}>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </SelectField>
        <SelectField label={p.weight} value={String(layer.weight)} onChange={(w) => set({ weight: Number(w) })}>
          {weights.map((w) => (
            <option key={w} value={w}>
              {p.weights[`w${w}` as keyof typeof p.weights] ?? w}
            </option>
          ))}
        </SelectField>
        <NumberField label={p.size} value={layer.size} min={4} suffix="px" onChange={(size) => set({ size }, "size")} />
        <NumberField label={p.letterSpacing} value={Math.round(layer.letterSpacing * 1000) / 10} step={0.5} suffix="%" onChange={(v) => set({ letterSpacing: v / 100 }, "letterSpacing")} />
        <NumberField label={p.lineHeight} value={layer.lineHeight} step={0.05} min={0.5} max={4} onChange={(lineHeight) => set({ lineHeight }, "lineHeight")} />
      </div>
      <div className="bsl-seg" role="radiogroup" aria-label={p.align}>
        {(
          [
            ["left", p.alignLeft, "alignLeft"],
            ["center", p.alignCenter, "alignCenter"],
            ["right", p.alignRight, "alignRight"],
          ] as Array<[TextAlign, string, LayerIconName]>
        ).map(([value, label, icon]) => (
          <button key={value} type="button" role="radio" aria-checked={layer.align === value} aria-label={label} title={label} className="bsl-seg-btn" onClick={() => set({ align: value })}>
            <LayerIcon name={icon} />
          </button>
        ))}
      </div>
      <ColorField label={p.color} value={layer.color} recent={recent} copy={copy} onChange={(color) => color && set({ color }, "color")} onUsed={onColorUsed} />
      <label className="bsl-check">
        <input type="checkbox" checked={Boolean(layer.plate)} onChange={() => onTogglePlate(layer)} />
        <span>{p.plate}</span>
      </label>
      {layer.plate && (
        <ColorField
          label={p.plateColor}
          value={layer.plate.color}
          recent={recent}
          copy={copy}
          onChange={(color) => color && layer.plate && set({ plate: { ...layer.plate, color } }, "plateColor")}
          onUsed={onColorUsed}
        />
      )}
    </fieldset>
  );
}

function ShapeProps({ copy, layer, set, recent, onColorUsed }: PropsPanelProps & { layer: ShapeLayer; set: SetFn }) {
  const p = copy.props;
  return (
    <fieldset className="bsl-fieldset" disabled={layer.locked}>
      <div className="bsl-seg" role="radiogroup" aria-label={p.shape}>
        {(
          [
            ["rect", copy.add.rect, "rect"],
            ["ellipse", copy.add.ellipse, "ellipse"],
          ] as Array<["rect" | "ellipse", string, LayerIconName]>
        ).map(([value, label, icon]) => (
          <button key={value} type="button" role="radio" aria-checked={layer.shape === value} aria-label={label} title={label} className="bsl-seg-btn" onClick={() => set({ shape: value })}>
            <LayerIcon name={icon} />
          </button>
        ))}
      </div>
      <ColorField label={p.fill} value={layer.fill} nullable recent={recent} copy={copy} onChange={(fill) => set({ fill }, "fill")} onUsed={onColorUsed} />
      <ColorField
        label={p.stroke}
        value={layer.stroke}
        nullable
        recent={recent}
        copy={copy}
        onChange={(stroke) => set({ stroke, ...(stroke && layer.strokeWidth <= 0 ? { strokeWidth: 2 } : {}) }, "stroke")}
        onUsed={onColorUsed}
      />
      <div className="bsl-grid2">
        <NumberField label={p.strokeWidth} value={layer.strokeWidth} min={0} suffix="px" disabled={!layer.stroke} onChange={(strokeWidth) => set({ strokeWidth }, "strokeWidth")} />
        {layer.shape === "rect" && <NumberField label={p.radius} value={layer.radius} min={0} suffix="px" onChange={(radius) => set({ radius }, "radius")} />}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------- fields */

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange(value: string): void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="bsl-field">
      <label className="bsl-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="bsl-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

/** Small values (line height, spacing) keep two decimals; positions and sizes one. */
const show = (value: number) => String(Math.abs(value) < 10 ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10);

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="bsl-field">
      <label className="bsl-label" htmlFor={id}>
        {label}
      </label>
      <span className="bsl-number">
        <input
          id={id}
          className="bsl-input bsl-num"
          type="number"
          inputMode="decimal"
          value={draft ?? show(value)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            const n = Number.parseFloat(event.target.value);
            if (Number.isFinite(n)) onChange(clamp(n, min ?? -100_000, max ?? 100_000));
          }}
          onBlur={() => setDraft(null)}
        />
        {suffix && <span className="bsl-unit" aria-hidden="true">{suffix}</span>}
      </span>
    </div>
  );
}

export function ColorField({
  label,
  value,
  nullable,
  recent,
  copy,
  onChange,
  onUsed,
}: {
  label: string;
  value: string | null;
  nullable?: boolean;
  recent: string[];
  copy: LayersCopy;
  onChange(color: string | null): void;
  onUsed(color: string): void;
}) {
  const id = useId();
  const c = copy.color;
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const named: Array<[string, string]> = [
    [SWATCHES.black, c.black],
    [SWATCHES.white, c.white],
    [SWATCHES.blue, c.blue],
  ];
  const extra = recent.filter((r) => !named.some(([hex]) => hex === r));
  const pick = (hex: string) => {
    setDraft(null);
    setInvalid(false);
    onChange(hex);
    onUsed(hex);
  };
  const current = value ? normalizeHex(value) : null;
  return (
    <div className="bsl-color" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="bsl-label">
        {label}
      </span>
      <div className="bsl-swatches">
        {nullable && (
          <button type="button" className="bsl-swatch" data-none aria-label={c.none} title={c.none} aria-pressed={value === null} onClick={() => onChange(null)} />
        )}
        {named.map(([hex, name]) => (
          <Swatch key={hex} hex={hex} label={name} pressed={current === hex} onPick={pick} />
        ))}
        {extra.length > 0 && <span className="bsl-swatch-gap" aria-hidden="true" />}
        {extra.map((hex) => (
          <Swatch key={hex} hex={hex} label={fill(c.pick, { color: hex })} pressed={current === hex} onPick={pick} recentLabel={c.recent} />
        ))}
      </div>
      <div className="bsl-hex">
        <label className="bsl-sr" htmlFor={`${id}-hex`}>
          {`${label} · ${c.hex}`}
        </label>
        <span className="bsl-hex-chip" style={{ background: current ?? "transparent" }} data-none={current ? undefined : true} aria-hidden="true" />
        <input
          id={`${id}-hex`}
          className="bsl-input bsl-num"
          value={draft ?? current ?? ""}
          placeholder={c.hex}
          maxLength={7}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-err` : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            const hex = normalizeHex(event.target.value);
            if (hex && event.target.value.replace("#", "").length === 6) {
              setInvalid(false);
              onChange(hex);
            }
          }}
          onBlur={() => {
            if (draft === null) return;
            const hex = normalizeHex(draft);
            if (hex) {
              pick(hex);
            } else if (draft.trim()) setInvalid(true);
            else setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      </div>
      {invalid && (
        <p id={`${id}-err`} className="bsl-error" role="alert">
          {c.invalid}
        </p>
      )}
    </div>
  );
}

function Swatch({ hex, label, pressed, onPick, recentLabel }: { hex: string; label: string; pressed: boolean; onPick(hex: string): void; recentLabel?: string }) {
  return (
    <button
      type="button"
      className="bsl-swatch"
      style={{ background: hex }}
      data-light={isLight(hex) || undefined}
      aria-label={recentLabel ? `${recentLabel}: ${label}` : label}
      title={recentLabel ? `${recentLabel} · ${hex}` : `${label} · ${hex}`}
      aria-pressed={pressed}
      onClick={() => onPick(hex)}
    >
      {pressed && <LayerIcon name="check" />}
    </button>
  );
}
