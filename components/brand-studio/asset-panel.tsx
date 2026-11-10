/**
 * The company asset library (docs/BRAND-STUDIO-V2.md §5.2): the right rail on a desktop, a sheet that
 * rises from the bottom on a phone. Search by name and tag, filter by role, drag a tile into the tray
 * or press it, upload by button or by dropping files. Every drag has a press alternative.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { STUDIO_ASSET_ROLES, STUDIO_LIMITS, STUDIO_UPLOAD_MIMES, type StudioAssetRole, type StudioAssetView } from "@/lib/brand-studio/contracts";
import { AssetEditor, type AssetEditorProps } from "./asset-editor";
import { fill, type StudioCopy } from "./copy";
import { StudioIcon } from "./icons";
import { startRefDrag } from "./refs";

export function filterAssets(assets: readonly StudioAssetView[], query: string, role: StudioAssetRole | "all"): StudioAssetView[] {
  const needle = query.trim().toLowerCase();
  return assets.filter(
    (asset) =>
      (role === "all" || asset.role === role) &&
      (!needle || asset.name.toLowerCase().includes(needle) || asset.tags.some((tag) => tag.toLowerCase().includes(needle))),
  );
}

const ACCEPT = Object.values(STUDIO_UPLOAD_MIMES).flat().join(",");
const mb = (bytes: number) => Math.round(bytes / 1_000_000);

export interface AssetPanelProps {
  assets: readonly StudioAssetView[];
  copy: StudioCopy;
  canCreate: boolean;
  /** Pressing a tile adds it to the tray (only while the dock is there); otherwise it opens it. */
  attachOnPress: boolean;
  open: boolean;
  notice: string | null;
  uploading: readonly string[];
  searchId: string;
  onClose(): void;
  onAttach(asset: StudioAssetView): void;
  onView(asset: StudioAssetView): void;
  onFiles(files: File[]): void;
  onUpdate: AssetEditorProps["onSave"];
  onDelete: AssetEditorProps["onDelete"];
}

export function AssetPanel(props: AssetPanelProps) {
  const { assets, copy, canCreate } = props;
  const a = copy.assets;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<StudioAssetRole | "all">("all");
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<StudioAssetView | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const shown = filterAssets(assets, query, role);

  return (
    <aside
      className="bs-assets"
      data-studio-assets
      data-open={props.open ? "" : undefined}
      data-drop-target={dropActive ? "" : undefined}
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && props.open && !menu && !editing) props.onClose();
      }}
      onDragOver={(event) => {
        if (!canCreate || !Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        if (!canCreate || !event.dataTransfer.files.length) return;
        event.preventDefault();
        setDropActive(false);
        props.onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="bs-assets-head">
        <h2 id={`${id}-title`}>{a.title}</h2>
        <button type="button" className="bs-btn bs-sheet-close" data-variant="ghost" data-size="sm" onClick={props.onClose} aria-label={a.close}>
          <StudioIcon name="close" />
        </button>
      </div>
      <label className="bs-sr" htmlFor={props.searchId}>
        {a.search}
      </label>
      <input
        id={props.searchId}
        type="search"
        className="bs-field"
        value={query}
        placeholder={a.searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="bs-filter" role="group" aria-label={a.roleFilter}>
        {(["all", ...STUDIO_ASSET_ROLES] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="bs-chip"
            data-size="sm"
            data-selected={role === value ? "" : undefined}
            aria-pressed={role === value}
            onClick={() => setRole(value)}
          >
            {value === "all" ? a.all : copy.roles[value]}
          </button>
        ))}
      </div>
      {canCreate && (
        <div className="bs-upload">
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) props.onFiles(files);
          }} />
          <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => input.current?.click()} data-studio-upload>
            <StudioIcon name="upload" />
            {props.uploading.length ? a.uploading : a.upload}
          </button>
          <p className="bs-muted">{dropActive ? a.drop : fill(a.limits, { image: mb(STUDIO_LIMITS.imageBytesMax), video: mb(STUDIO_LIMITS.videoBytesMax), audio: mb(STUDIO_LIMITS.audioBytesMax) })}</p>
        </div>
      )}
      {props.notice && (
        <p className="bs-dock-message" role="alert">
          {props.notice}
        </p>
      )}
      {!assets.length ? (
        <p className="bs-muted" data-studio-assets-empty>{a.empty}</p>
      ) : !shown.length ? (
        <p className="bs-muted">{a.noMatch}</p>
      ) : (
        <ul className="bs-asset-grid">
          {shown.map((asset) => (
            <li key={asset.id} className="bs-asset" data-asset-kind={asset.kind}>
              <button
                type="button"
                className="bs-asset-tile"
                draggable={canCreate}
                onDragStart={(event) => startRefDrag(event, { assetId: asset.id })}
                onClick={() => (props.attachOnPress ? props.onAttach(asset) : props.onView(asset))}
                aria-label={props.attachOnPress ? fill(a.attach, { name: asset.name }) : `${a.view}: ${asset.name}`}
                title={props.attachOnPress ? a.dragHint : undefined}
              >
                {asset.kind === "video" ? (
                  <video src={`${asset.url}#t=0.1`} poster={asset.thumbUrl ?? undefined} muted playsInline preload="metadata" tabIndex={-1} />
                ) : asset.kind === "image" ? (
                  <img src={asset.thumbUrl ?? asset.url} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="bs-asset-audio" aria-hidden="true">
                    <StudioIcon name="play" />
                  </span>
                )}
              </button>
              <p className="bs-asset-name">{asset.name}</p>
              <AssetMenu
                open={menu === asset.id}
                label={fill(a.more, { name: asset.name })}
                items={[
                  { key: "view", label: a.view, run: () => props.onView(asset) },
                  ...(canCreate ? [{ key: "edit", label: a.edit, run: () => setEditing(asset) }] : []),
                ]}
                onToggle={(next) => setMenu(next ? asset.id : null)}
              />
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <AssetEditor
          asset={editing}
          copy={copy}
          onSave={props.onUpdate}
          onDelete={props.onDelete}
          onClose={() => setEditing(null)}
        />
      )}
    </aside>
  );
}

function AssetMenu({
  open,
  label,
  items,
  onToggle,
}: {
  open: boolean;
  label: string;
  items: Array<{ key: string; label: string; run(): void }>;
  onToggle(open: boolean): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [open]);
  const close = () => {
    onToggle(false);
    trigger.current?.focus();
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") close();
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      entries[(at + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length]?.focus();
    }
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="bs-asset-more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onToggle(!open)}
      >
        <StudioIcon name="more" />
      </button>
      {open && (
        <div id={id} ref={list} className="bs-menu" role="menu" aria-label={label} onKeyDown={keys}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                onToggle(false);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
