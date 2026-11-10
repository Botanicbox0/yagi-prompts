"use client";
/**
 * "폴더에 담기": the organization's folders as a short list, and a new folder in one line. Folders are
 * shared by the whole team (docs/BRAND-STUDIO-V3.md §2); the library hook (slice B2) does the writing.
 */
import { useEffect, useId, useState } from "react";
import { STUDIO_LIMITS } from "@/lib/brand-studio/contracts";
import type { StudioFolderView } from "../seams";
import { StudioIcon } from "../icons";
import { moveFocus, useAnchored, useDismiss } from "./menu";

export interface FolderPickerWords {
  title: string;
  empty: string;
  newFolder: string;
  newFolderName: string;
  create: string;
}

export function FolderPicker({
  id,
  folders,
  words,
  onPick,
  onCreate,
  onClose,
  anchor,
}: {
  id: string;
  /** The button that opened it; the list is placed beside it in the viewport. */
  anchor?: HTMLElement | null;
  folders: readonly StudioFolderView[];
  words: FolderPickerWords;
  onPick(folderId: string): void;
  onCreate(name: string): void;
  onClose(): void;
}) {
  const box = useDismiss(onClose);
  useAnchored(box, anchor, onClose);
  const field = useId();
  const [name, setName] = useState("");
  useEffect(() => {
    (box.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? box.current?.querySelector<HTMLElement>("input"))?.focus({ preventScroll: true });
  }, [box]);
  return (
    <div
      ref={box}
      id={id}
      className="bs-menu bs-folders"
      role="dialog"
      aria-label={words.title}
      data-studio-folder-picker
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="bs-menu-title">{words.title}</p>
      {folders.length ? (
        <div role="menu" aria-label={words.title} onKeyDown={moveFocus}>
          {folders.map((folder) => (
            <button key={folder.id} type="button" role="menuitem" data-folder={folder.id} onClick={() => onPick(folder.id)}>
              <StudioIcon name="folder" />
              <span>{folder.name}</span>
              <span className="bs-menu-count bs-num">{folder.count}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="bs-menu-note">{words.empty}</p>
      )}
      <form
        className="bs-folder-new"
        onSubmit={(event) => {
          event.preventDefault();
          const clean = name.trim();
          if (clean) onCreate(clean.slice(0, STUDIO_LIMITS.nameMax));
        }}
      >
        <label className="bs-sr" htmlFor={field}>
          {words.newFolderName}
        </label>
        <input id={field} className="bs-field" value={name} placeholder={words.newFolder} maxLength={STUDIO_LIMITS.nameMax} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="bs-btn" data-variant="soft" data-size="sm" disabled={!name.trim()}>
          {words.create}
        </button>
      </form>
    </div>
  );
}
