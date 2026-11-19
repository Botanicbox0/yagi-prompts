"use client";
/** Rename, re-role, re-tag or delete one upload (delete asks once more, inline). A centred modal: Esc and a
 * press on the backdrop close it, and focus goes back to the tile it was opened for (`returnFocus`). */
import { useId, useState } from "react";
import { STUDIO_LIMITS, type StudioAssetRole, type StudioAssetView } from "@/lib/brand-studio/contracts";
import { useBackdropClose, useModal } from "../modal";
import { RoleChips } from "../role-chips";
import { libraryFailed } from "./library-api";
import { fill, tagsFrom, writeError, type LibraryCopy } from "./text";

export interface AssetDialogProps {
  asset: StudioAssetView;
  copy: LibraryCopy;
  onUpdate(assetId: string, patch: { name?: string; role?: StudioAssetView["role"]; tags?: string[] }): Promise<unknown>;
  onDelete(assetId: string): Promise<unknown>;
  onClose(): void;
  /** Where focus goes when the dialog closes (the tile; the menu that opened the dialog is gone by then). */
  returnFocus?(): HTMLElement | null;
}

export function AssetDialog({ asset, copy, onUpdate, onDelete, onClose, returnFocus }: AssetDialogProps) {
  const u = copy.uploads;
  const ref = useModal({ returnFocus });
  const backdrop = useBackdropClose(onClose);
  const id = useId();
  const [name, setName] = useState(asset.name);
  const [role, setRole] = useState<StudioAssetRole | "">(asset.role ?? "");
  // Said only while the shown role is still the recognised one.
  const recognised = asset.roleSource === "auto" && Boolean(asset.role) && role === asset.role;
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
      {...backdrop}
    >
      <form
        className="bsr-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          // The role goes only when it changed: saving a new name must not turn a recognised role into a chosen one.
          const changedRole = role !== (asset.role ?? "") ? { role: role || null } : {};
          if (name.trim()) void run(() => onUpdate(asset.id, { name: name.trim().slice(0, STUDIO_LIMITS.nameMax), ...changedRole, tags: tagsFrom(tags) }));
        }}
      >
        <h2 id={`${id}-title`}>{u.edit}</h2>
        <label htmlFor={`${id}-name`}>{u.name}</label>
        <input id={`${id}-name`} className="bsr-field" value={name} maxLength={STUDIO_LIMITS.nameMax} required onChange={(event) => setName(event.target.value)} />
        <span id={`${id}-role`} className="bsr-dialog-label">
          {u.role}
        </span>
        <RoleChips
          value={role}
          onChange={setRole}
          noneLabel={u.roleNone}
          roleLabels={copy.roles}
          labelledBy={`${id}-role`}
          describedBy={recognised ? `${id}-role-hint` : undefined}
        />
        {recognised && (
          <p id={`${id}-role-hint`} className="bsr-muted" data-library-role-auto>
            {u.roleAuto}
          </p>
        )}
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
