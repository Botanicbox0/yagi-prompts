/** Rename, re-role, re-tag or delete one library asset (delete asks once more, inline). */
import { useId, useState } from "react";
import {
  STUDIO_ASSET_ROLES,
  STUDIO_LIMITS,
  type StudioAssetRole,
  type StudioAssetSaved,
  type StudioAssetView,
  type StudioDone,
} from "@/lib/brand-studio/contracts";
import { isFailure, type ApiResult } from "./api";
import { errorLine, fill, type StudioCopy } from "./copy";
import { useModal } from "./modal";

/** "봄, 신제품 ,  " -> ["봄", "신제품"], each within the contract's length, at most `tagsMax`. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,，]/)) {
    const tag = part.trim().slice(0, STUDIO_LIMITS.tagMax);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, STUDIO_LIMITS.tagsMax);
}

export interface AssetEditorProps {
  asset: StudioAssetView;
  copy: StudioCopy;
  onSave(input: { assetId: string; name?: string; role?: StudioAssetRole | null; tags?: string[] }): Promise<ApiResult<StudioAssetSaved>>;
  onDelete(assetId: string): Promise<ApiResult<StudioDone>>;
  onClose(): void;
}

export function AssetEditor({ asset, copy, onSave, onDelete, onClose }: AssetEditorProps) {
  const a = copy.assets;
  const ref = useModal();
  const id = useId();
  const [name, setName] = useState(asset.name);
  const [role, setRole] = useState<StudioAssetRole | "">(asset.role ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    const result = await onSave({ assetId: asset.id, name: name.trim().slice(0, STUDIO_LIMITS.nameMax), role: role || null, tags: parseTags(tags) });
    setBusy(false);
    if (isFailure(result)) setNotice(errorLine(copy, result.code));
    else onClose();
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    const result = await onDelete(asset.id);
    setBusy(false);
    if (isFailure(result)) setNotice(errorLine(copy, result.code));
    else onClose();
  }

  return (
    <dialog
      ref={ref}
      className="bs-dialog"
      aria-labelledby={`${id}-title`}
      data-studio-asset-editor
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        className="bs-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id={`${id}-title`}>{a.edit}</h2>
        <label htmlFor={`${id}-name`}>{a.name}</label>
        <input id={`${id}-name`} className="bs-field" value={name} maxLength={STUDIO_LIMITS.nameMax} required onChange={(event) => setName(event.target.value)} />
        <label htmlFor={`${id}-role`}>{a.role}</label>
        <select id={`${id}-role`} className="bs-field" value={role} onChange={(event) => setRole(event.target.value as StudioAssetRole | "")}>
          <option value="">{copy.tray.roleNone}</option>
          {STUDIO_ASSET_ROLES.map((value) => (
            <option key={value} value={value}>
              {copy.roles[value]}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-tags`}>{a.tags}</label>
        <input id={`${id}-tags`} className="bs-field" value={tags} aria-describedby={`${id}-tags-hint`} onChange={(event) => setTags(event.target.value)} />
        <p id={`${id}-tags-hint`} className="bs-muted">
          {fill(a.tagsHint, { n: STUDIO_LIMITS.tagsMax })}
        </p>
        {notice && <p className="bs-dock-message" role="alert">{notice}</p>}
        {confirming ? (
          <div className="bs-confirm" role="group" aria-label={a.deleteConfirm}>
            <p>{a.deleteConfirm}</p>
            <div className="bs-row">
              <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={() => setConfirming(false)}>
                {a.cancel}
              </button>
              <button type="button" className="bs-btn" data-variant="soft" data-tone="danger" data-size="sm" disabled={busy} onClick={() => void remove()}>
                {a.delete}
              </button>
            </div>
          </div>
        ) : (
          <div className="bs-row bs-dialog-actions">
            <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={() => setConfirming(true)}>
              {a.delete}
            </button>
            <span className="bs-spacer" />
            <button type="button" className="bs-btn" data-variant="ghost" data-size="md" onClick={onClose}>
              {a.cancel}
            </button>
            <button type="submit" className="bs-btn" data-variant="solid" data-size="md" disabled={busy}>
              {a.save}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
