"use client";
/**
 * 폴더 (docs/BRAND-STUDIO-V3.md §4): folders the organization shares. Tiles with a four-picture mosaic
 * and a count; make, rename and delete (asks once more); open one to see its grid. Dropping a dragged
 * result or upload on a tile, or on an open folder's grid, files it there.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { LIBRARY_LIMITS } from "@/lib/brand-studio/library-contracts";
import { decodeRefDrag, REF_DRAG_TYPE, type RefSource } from "../refs";
import type { StudioFolderView, StudioLibrary } from "../seams";
import { RailIcon } from "./icons";
import { isTempFolder } from "./library-store";
import { RailMenu, Thumb, type RailKit } from "./parts";
import { fill, writeError } from "./text";

const carriesRef = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(REF_DRAG_TYPE);
const lastError = (library: StudioLibrary) => (library as { lastError?: Parameters<typeof writeError>[1] }).lastError ?? null;

export interface FoldersTabProps {
  kit: RailKit;
  library: StudioLibrary;
  openId: string | null;
  onOpen(folderId: string | null): void;
  /** Start with the name field open (the "make a folder first" path from a menu). */
  creating: boolean;
  onCreating(open: boolean): void;
}

export function FoldersTab({ kit, library, openId, onOpen, creating, onCreating }: FoldersTabProps) {
  const { copy, canCreate } = kit;
  const f = copy.folders;
  const [over, setOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const open = openId ? library.folders.find((folder) => folder.id === openId) ?? null : null;

  // Opening loads (and refreshes) the folder; a folder deleted elsewhere sends the rail back to the list.
  // Keyed on the id alone: a library whose functions change identity each render must not reload in a loop.
  const openFolder = useRef(library.openFolder);
  openFolder.current = library.openFolder;
  useEffect(() => {
    if (openId) openFolder.current(openId);
  }, [openId]);
  useEffect(() => {
    if (openId && library.ready && !open) onOpen(null);
  }, [openId, open, library.ready, onOpen]);

  async function file(folder: StudioFolderView, ref: RefSource) {
    const done = await library.addToFolder(folder.id, ref);
    kit.say(done ? fill(f.filed, { name: folder.name }) : writeError(copy, lastError(library), "add"));
  }

  const dropProps = (folder: StudioFolderView) =>
    canCreate && !isTempFolder(folder.id)
      ? {
          onDragOver(event: DragEvent) {
            if (!carriesRef(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setOver(folder.id);
          },
          onDragLeave(event: DragEvent) {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
          },
          onDrop(event: DragEvent) {
            setOver(null);
            const ref = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
            if (!ref) return;
            event.preventDefault();
            event.stopPropagation();
            void file(folder, ref);
          },
        }
      : {};

  if (open) {
    const items = library.folderItems(open.id);
    return (
      <section className="bsr-folder-view" data-library-folder-open={open.id} data-drop={over === open.id ? "" : undefined} {...dropProps(open)}>
        <div className="bsr-folder-bar">
          <button type="button" className="bsr-btn" data-variant="ghost" onClick={() => onOpen(null)} data-library-back>
            <RailIcon name="back" />
            {f.back}
          </button>
        </div>
        <h3 className="bsr-folder-title">
          <span>{open.name}</span>
          <span className="bsr-count">{fill(f.count, { n: open.count })}</span>
        </h3>
        {over === open.id && <p className="bsr-drop-hint">{fill(f.drop, { name: open.name })}</p>}
        {items === null ? (
          <SkeletonGrid />
        ) : items.length === 0 ? (
          <p className="bsr-empty">{f.emptyFolder}</p>
        ) : (
          <ul className="bsr-grid">
            {items.map((item) => {
              const editMenu = kit.editItems?.(item) ?? [];
              const menuKey = `folder-item:${open.id}:${item.key}`;
              return (
                <Thumb
                  key={item.key}
                  item={item}
                  copy={copy}
                  draggable={canCreate}
                  attachOnPress={kit.attachOnPress}
                  onAttach={kit.onAttach}
                  onView={kit.onView}
                  actions={[
                    kit.likeAction(item),
                    ...(canCreate
                      ? [
                          {
                            key: "remove",
                            label: fill(f.remove, { name: item.name ?? copy.item[item.kind] }),
                            icon: "remove" as const,
                            run: () =>
                              void library.removeFromFolder(open.id, item.ref).then((done) => {
                                if (!done) kit.say(writeError(copy, lastError(library), "remove"));
                              }),
                          },
                        ]
                      : []),
                  ]}
                  menu={
                    editMenu.length > 0 && (
                      <RailMenu
                        open={kit.menu === menuKey}
                        label={fill(copy.uploads.more, { name: item.name ?? copy.item[item.kind] })}
                        items={editMenu}
                        onToggle={(next) => kit.setMenu(next ? menuKey : null)}
                      />
                    )
                  }
                />
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="bsr-folders" data-library-folders>
      {canCreate &&
        (creating ? (
          <NameForm
            label={f.nameLabel}
            placeholder={f.namePlaceholder}
            submit={f.createSave}
            cancel={f.cancel}
            initial=""
            onCancel={() => onCreating(false)}
            onSubmit={(name) => {
              onCreating(false);
              void library.createFolder(name).then((made) => {
                if (!made) kit.say(writeError(copy, lastError(library), "create"));
              });
            }}
          />
        ) : (
          <button type="button" className="bsr-btn" data-variant="soft" onClick={() => onCreating(true)} data-library-new-folder>
            <RailIcon name="plus" />
            {f.create}
          </button>
        ))}
      {library.folders.length === 0 ? (
        <p className="bsr-empty" data-library-empty="folders">
          {canCreate ? f.empty : f.emptyReadOnly}
        </p>
      ) : (
        <ul className="bsr-folder-grid">
          {library.folders.map((folder) => {
            const temp = isTempFolder(folder.id);
            if (renaming === folder.id) {
              return (
                <li key={folder.id} className="bsr-folder" data-editing="">
                  <NameForm
                    label={f.nameLabel}
                    placeholder={f.namePlaceholder}
                    submit={f.renameSave}
                    cancel={f.cancel}
                    initial={folder.name}
                    onCancel={() => setRenaming(null)}
                    onSubmit={(name) => {
                      setRenaming(null);
                      void library.renameFolder(folder.id, name).then((done) => {
                        if (!done) kit.say(writeError(copy, lastError(library), "rename"));
                      });
                    }}
                  />
                </li>
              );
            }
            if (confirming === folder.id) {
              return (
                <li key={folder.id} className="bsr-folder" data-confirming="">
                  <div className="bsr-confirm" role="group" aria-label={f.deleteYes}>
                    <p>{fill(f.deleteConfirm, { name: folder.name })}</p>
                    <div className="bsr-row">
                      <button type="button" className="bsr-btn" data-variant="ghost" onClick={() => setConfirming(null)} autoFocus>
                        {f.cancel}
                      </button>
                      <button
                        type="button"
                        className="bsr-btn"
                        data-variant="soft"
                        data-tone="danger"
                        onClick={() => {
                          setConfirming(null);
                          void library.deleteFolder(folder.id).then((done) => {
                            if (!done) kit.say(writeError(copy, lastError(library), "delete"));
                          });
                        }}
                      >
                        {f.deleteYes}
                      </button>
                    </div>
                  </div>
                </li>
              );
            }
            return (
              <li
                key={folder.id}
                className="bsr-folder"
                data-library-folder={folder.id}
                data-pending={temp ? "" : undefined}
                data-drop={over === folder.id ? "" : undefined}
                {...dropProps(folder)}
              >
                <button type="button" className="bsr-folder-open" disabled={temp} onClick={() => onOpen(folder.id)} aria-label={fill(f.open, { name: folder.name })}>
                  <Mosaic covers={folder.covers} />
                  <span className="bsr-folder-name">{folder.name}</span>
                  <span className="bsr-count">{fill(f.count, { n: folder.count })}</span>
                </button>
                {over === folder.id && (
                  <span className="bsr-folder-drop" aria-hidden="true">
                    {fill(f.drop, { name: folder.name })}
                  </span>
                )}
                {canCreate && !temp && (
                  <div className="bsr-folder-actions">
                    <RailMenu
                      open={kit.menu === `folder:${folder.id}`}
                      label={fill(f.more, { name: folder.name })}
                      onToggle={(next) => kit.setMenu(next ? `folder:${folder.id}` : null)}
                      items={[
                        { key: "rename", label: f.rename, run: () => setRenaming(folder.id) },
                        { key: "delete", label: f.delete, tone: "danger", run: () => setConfirming(folder.id) },
                      ]}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Mosaic({ covers }: { covers: string[] }) {
  const shown = covers.slice(0, 4);
  return (
    <span className="bsr-mosaic" data-n={shown.length} aria-hidden="true">
      {shown.length === 0 ? <RailIcon name="folder" /> : shown.map((src, i) => <img key={`${i}:${src}`} src={src} alt="" loading="lazy" decoding="async" draggable={false} />)}
    </span>
  );
}

function NameForm({
  label,
  placeholder,
  submit,
  cancel,
  initial,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  submit: string;
  cancel: string;
  initial: string;
  onSubmit(name: string): void;
  onCancel(): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSubmit(name);
  };
  return (
    <form className="bsr-name-form" onSubmit={send} data-library-name-form>
      <label className="bsr-sr" htmlFor={id}>
        {label}
      </label>
      <input
        ref={input}
        id={id}
        className="bsr-field"
        value={name}
        placeholder={placeholder}
        maxLength={LIBRARY_LIMITS.folderNameMax}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="bsr-row">
        <button type="button" className="bsr-btn" data-variant="ghost" onClick={onCancel}>
          {cancel}
        </button>
        <button type="submit" className="bsr-btn" data-variant="soft" data-tone="accent" disabled={!name.trim()}>
          {submit}
        </button>
      </div>
    </form>
  );
}

export function SkeletonGrid({ n = 6 }: { n?: number }) {
  return (
    <ul className="bsr-grid" aria-hidden="true" data-library-skeleton>
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="bsr-thumb" data-skeleton="" />
      ))}
    </ul>
  );
}
