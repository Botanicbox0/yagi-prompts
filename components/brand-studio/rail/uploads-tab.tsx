"use client";
/**
 * 업로드 (docs/BRAND-STUDIO-V3.md §4): what the asset panel did — upload by button or by dropping files,
 * search by name and tag, filter by role, edit details, delete — inside the rail. Every tile drags into
 * the prompt bar and the folders.
 */
import { useRef, useState } from "react";
import { STUDIO_ASSET_ROLES, STUDIO_LIMITS, STUDIO_UPLOAD_MIMES, type StudioAssetRole, type StudioAssetView } from "@/lib/brand-studio/contracts";
import { AssetDialog } from "./asset-dialog";
import { RailIcon } from "./icons";
import { RailMenu, Thumb, type RailKit } from "./parts";
import { fill, filterUploads, itemOfAsset } from "./text";

const ACCEPT = Object.values(STUDIO_UPLOAD_MIMES).flat().join(",");
const mb = (bytes: number) => Math.round(bytes / 1_000_000);

export interface UploadsTabProps {
  kit: RailKit;
  assets: readonly StudioAssetView[];
  notice: string | null;
  uploading: readonly string[];
  searchId: string;
  dropActive: boolean;
  onFiles(files: File[]): void;
  onUpdate(assetId: string, patch: { name?: string; role?: StudioAssetView["role"]; tags?: string[] }): Promise<unknown>;
  onDelete(assetId: string): Promise<unknown>;
}

export function UploadsTab({ kit, assets, notice, uploading, searchId, dropActive, onFiles, onUpdate, onDelete }: UploadsTabProps) {
  const { copy, canCreate } = kit;
  const u = copy.uploads;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<StudioAssetRole | "all">("all");
  const [editing, setEditing] = useState<StudioAssetView | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = filterUploads(assets, query, role);

  return (
    <section className="bsr-uploads" data-library-uploads>
      {canCreate && (
        <div className="bsr-upload">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) onFiles(files);
            }}
          />
          <button type="button" className="bsr-btn" data-variant="soft" onClick={() => input.current?.click()} data-studio-upload>
            <RailIcon name="upload" />
            {u.upload}
          </button>
          <p className="bsr-muted">
            {dropActive ? u.drop : fill(u.limits, { image: mb(STUDIO_LIMITS.imageBytesMax), video: mb(STUDIO_LIMITS.videoBytesMax), audio: mb(STUDIO_LIMITS.audioBytesMax) })}
          </p>
        </div>
      )}
      {uploading.length > 0 && (
        <div className="bsr-progress" role="status" data-library-uploading>
          <p>{fill(u.uploading, { n: uploading.length })}</p>
          <ul>
            {uploading.map((name, i) => (
              <li key={`${i}:${name}`}>
                <span className="bsr-progress-name">{name}</span>
                <span className="bsr-progress-bar" aria-hidden="true" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {notice && (
        <p className="bsr-alert" role="alert">
          {notice}
        </p>
      )}
      <div className="bsr-search">
        <label className="bsr-sr" htmlFor={searchId}>
          {u.search}
        </label>
        <RailIcon name="search" />
        <input id={searchId} type="search" className="bsr-field" value={query} placeholder={u.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="bsr-filter" role="group" aria-label={u.roleFilter}>
        {(["all", ...STUDIO_ASSET_ROLES] as const).map((value) => (
          <button key={value} type="button" className="bsr-chip" data-selected={role === value ? "" : undefined} aria-pressed={role === value} onClick={() => setRole(value)}>
            {value === "all" ? u.all : copy.roles[value]}
          </button>
        ))}
      </div>
      {!assets.length ? (
        <p className="bsr-empty" data-studio-assets-empty data-library-empty="uploads">
          {canCreate ? u.empty : u.emptyReadOnly}
        </p>
      ) : !shown.length ? (
        <p className="bsr-empty">{u.noMatch}</p>
      ) : (
        <ul className="bsr-grid">
          {shown.map((asset) => {
            const item = itemOfAsset(asset);
            const menuKey = `asset:${asset.id}`;
            const items = [
              ...(kit.editItems?.(item) ?? []),
              ...(canCreate ? [{ key: "edit", label: u.edit, run: () => setEditing(asset) }] : []),
              ...kit.fileItems(item),
            ];
            return (
              <Thumb
                key={asset.id}
                item={item}
                copy={copy}
                draggable={canCreate}
                attachOnPress={kit.attachOnPress}
                onAttach={kit.onAttach}
                onView={kit.onView}
                label={asset.role ? copy.roles[asset.role] : null}
                actions={[kit.likeAction(item)]}
                menu={
                  items.length > 0 && (
                    <RailMenu open={kit.menu === menuKey} label={fill(u.more, { name: asset.name })} items={items} onToggle={(next) => kit.setMenu(next ? menuKey : null)} />
                  )
                }
              />
            );
          })}
        </ul>
      )}
      {editing && (
        <AssetDialog
          asset={editing}
          copy={copy}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={() => setEditing(null)}
          returnFocus={() => document.querySelector<HTMLElement>(`[data-library-item="a:${editing.id}"] .bsr-thumb-main`)}
        />
      )}
    </section>
  );
}
