"use client";
/** Rename, re-role, re-tag or delete one upload (delete asks once more, inline). */
import { useId, useState } from "react";
import { STUDIO_ASSET_ROLES, STUDIO_LIMITS, type StudioAssetRole, type StudioAssetView } from "@/lib/brand-studio/contracts";
import { useModal } from "../modal";
import { libraryFailed } from "./library-api";
import { fill, tagsFrom, writeError, type LibraryCopy } from "./text";

export interface AssetDialogProps {
  asset: StudioAssetView;
  copy: LibraryCopy;
  onUpdate(assetId: string, patch: { name?: string; role?: StudioAssetView["role"]; tags?: string[] }): Promise<unknown>;
  onDelete(assetId: string): Promise<unknown>;
  onClose(): void;
}

export function AssetDialog({ asset, copy, onUpdate, onDelete, onClose }: AssetDialogProps) {
  const u = copy.uploads;
  const ref = useModal();
  const id = useId();
  const [name, setName] = useState(asset.name);
  const [role, setRole] = useState<StudioAssetRole | "">(asset.role ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (libraryFailed(result)) setNotice(writeError(copy, result.code, "asset"));
    else onClose();
  }

  return (
    <dialog
      ref={ref}
      className="bsr-dialog"
      aria-labelledby={`${id}-title`}
      data-library-asset-editor
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        className="bsr-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void run(() => onUpdate(asset.id, { name: name.trim().slice(0, STUDIO_LIMITS.nameMax), role: role || null, tags: tagsFrom(tags) }));
        }}
      >
        <h2 id={`${id}-title`}>{u.edit}</h2>
        <label htmlFor={`${id}-name`}>{u.name}</label>
        <input id={`${id}-name`} className="bsr-field" value={name} maxLength={STUDIO_LIMITS.nameMax} required onChange={(event) => setName(event.target.value)} />
        <label htmlFor={`${id}-role`}>{u.role}</label>
        <select id={`${id}-role`} className="bsr-field" value={role} onChange={(event) => setRole(event.target.value as StudioAssetRole | "")}>
          <option value="">{u.roleNone}</option>
          {STUDIO_ASSET_ROLES.map((value) => (
            <option key={value} value={value}>
              {copy.roles[value]}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-tags`}>{u.tags}</label>
        <input id={`${id}-tags`} className="bsr-field" value={tags} aria-describedby={`${id}-tags-hint`} onChange={(event) => setTags(event.target.value)} />
        <p id={`${id}-tags-hint`} className="bsr-muted">
          {fill(u.tagsHint, { n: STUDIO_LIMITS.tagsMax })}
        </p>
        {notice && (
          <p className="bsr-alert" role="alert">
            {notice}
          </p>
        )}
        {confirming ? (
          <div className="bsr-confirm" role="group" aria-label={u.deleteYes}>
            <p>{u.deleteConfirm}</p>
            <div className="bsr-row">
              <button type="button" className="bsr-btn" data-variant="ghost" onClick={() => setConfirming(false)} autoFocus>
                {u.cancel}
              </button>
              <button type="button" className="bsr-btn" data-variant="soft" data-tone="danger" disabled={busy} onClick={() => void run(() => onDelete(asset.id))}>
                {u.deleteYes}
              </button>
            </div>
          </div>
        ) : (
          <div className="bsr-row bsr-dialog-actions">
            <button type="button" className="bsr-btn" data-variant="ghost" data-tone="danger" onClick={() => setConfirming(true)}>
              {u.delete}
            </button>
            <span className="bsr-spacer" />
            <button type="button" className="bsr-btn" data-variant="ghost" onClick={onClose}>
              {u.cancel}
            </button>
            <button type="submit" className="bsr-btn" data-variant="soft" data-tone="accent" disabled={busy || !name.trim()}>
              {u.save}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
