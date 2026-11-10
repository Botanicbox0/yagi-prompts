"use client";
/**
 * The image screen's library rail (docs/BRAND-STUDIO-V3.md §4): 폴더 | 좋아요 | 업로드. Every thumbnail
 * drags into the prompt bar, the region editor, the layer editor and the folders; pressing it attaches it
 * (or opens it when there is no prompt bar). On a desktop the rail folds to a narrow handle (remembered);
 * on a phone it is a bottom sheet the screen opens.
 *
 * Techniques (docs/design/TOOLBOX.md §1-3): frosted milky panel with a double-ring edge, dark glass chips
 * over media, tabular numerals for counts and lengths, one spring for every move.
 */
import "./rail.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { REF_DRAG_TYPE, type RefSource } from "../refs";
import type { LibraryItemView, LibraryRailProps, StudioFolderView } from "../seams";
import { SkeletonGrid, FoldersTab } from "./folders-tab";
import { RailIcon, type RailIconName } from "./icons";
import { hasExtras, isTempFolder } from "./library-store";
import { RailMenu, Thumb, type MenuItem, type RailKit, type ThumbAction } from "./parts";
import { fill, itemName, itemOfAsset, itemOfOutput, RAIL_STORAGE_KEY, RAIL_TABS, readRailPrefs, writeError, type RailPrefs, type RailTab } from "./text";
import { UploadsTab } from "./uploads-tab";

const TAB_ICONS: Record<RailTab, RailIconName> = { folders: "folder", liked: "heart", uploads: "upload" };
const PHONE = "(max-width: 900px)";
const SPRING_LOAD_MS = 450;
const STATUS_MS = 4000;

const has = (event: DragEvent, type: string) => Array.from(event.dataTransfer.types).includes(type);

export function LibraryRail(props: LibraryRailProps & { copy: Dictionary["studioLibrary"]; /** Before a remembered tab is read; uploads by default. */ initialTab?: RailTab }) {
  const { copy, library, canCreate, attachOnPress } = props;
  const [tab, setTab] = useState<RailTab>(props.initialTab ?? "uploads");
  const [collapsed, setCollapsed] = useState(false);
  const [phone, setPhone] = useState(false);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLElement>(null);
  const id = useId();
  const folded = collapsed && !phone;

  // Preferences and the phone query are read after the first paint, so the server markup and the first
  // client render agree.
  useEffect(() => {
    try {
      const prefs = readRailPrefs(window.localStorage.getItem(RAIL_STORAGE_KEY));
      if (prefs) {
        setCollapsed(prefs.collapsed);
        setTab(prefs.tab);
      }
    } catch {
      // Storage can be blocked; the defaults stand.
    }
    const query = window.matchMedia?.(PHONE);
    if (!query) return;
    setPhone(query.matches);
    const change = () => setPhone(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (springTimer.current) clearTimeout(springTimer.current);
    },
    [],
  );
  // A phone sheet that opens takes focus, unless something inside already has it (the screen focused search).
  useEffect(() => {
    if (!phone || !props.open) return;
    const frame = requestAnimationFrame(() => {
      if (!root.current?.contains(document.activeElement)) root.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [phone, props.open]);

  const remember = useCallback((next: RailPrefs) => {
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }, []);
  const choose = useCallback(
    (next: RailTab, expand = false) => {
      setTab(next);
      setMenu(null);
      if (expand) setCollapsed(false);
      remember({ tab: next, collapsed: expand ? false : collapsed });
    },
    [collapsed, remember],
  );
  const fold = (next: boolean) => {
    setCollapsed(next);
    setMenu(null);
    remember({ tab, collapsed: next });
  };

  const say = useCallback((text: string) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatus(text);
    statusTimer.current = setTimeout(() => setStatus(""), STATUS_MS);
  }, []);
  const lastError = () => (hasExtras(library) ? library.lastError : null);

  const file = useCallback(
    async (folder: StudioFolderView, ref: RefSource) => {
      const done = await library.addToFolder(folder.id, ref);
      say(done ? fill(copy.folders.filed, { name: folder.name }) : writeError(copy, hasExtras(library) ? library.lastError : null, "add"));
    },
    [copy, library, say],
  );

  const kit: RailKit = {
    copy,
    canCreate,
    attachOnPress,
    onAttach: props.onAttach,
    onView: props.onView,
    menu,
    setMenu,
    say,
    likeAction(item: LibraryItemView): ThumbAction {
      const liked = library.liked.has(item.key);
      const name = itemName(item, copy);
      return {
        key: "like",
        label: fill(copy.item.like, { name }),
        title: fill(liked ? copy.item.unlike : copy.item.like, { name }),
        icon: "heart",
        pressed: liked,
        run: () =>
          void library.toggleLike(item.ref).then((done) => {
            if (!done) say(writeError(copy, lastError(), "like"));
          }),
      };
    },
    fileItems(item: LibraryItemView): MenuItem[] {
      if (!canCreate) return [];
      const folders = library.folders.filter((folder) => !isTempFolder(folder.id));
      if (!folders.length) {
        return [
          {
            key: "file:new",
            label: copy.folders.create,
            before: copy.folders.addTo,
            run: () => {
              say(copy.folders.noFolders);
              setOpenFolderId(null);
              setCreating(true);
              choose("folders");
            },
          },
        ];
      }
      return folders.map((folder, i) => ({
        key: `file:${folder.id}`,
        label: folder.name,
        before: i === 0 ? copy.folders.addTo : undefined,
        run: () => void file(folder, item.ref),
      }));
    },
  };

  // Liked items, with a stand-in for anything liked a moment ago that the server has not answered yet.
  const liked = useMemo(() => {
    const listed = new Set(library.likedItems.map((item) => item.key));
    const early: LibraryItemView[] = [];
    for (const key of library.liked) {
      if (listed.has(key)) continue;
      if (key.startsWith("o:")) {
        const output = props.outputOf(key.slice(2));
        if (output) early.push(itemOfOutput(output));
      } else {
        const asset = props.assets.find((a) => a.id === key.slice(2));
        if (asset) early.push(itemOfAsset(asset));
      }
    }
    return [...early, ...library.likedItems];
  }, [library.liked, library.likedItems, props.outputOf, props.assets]);

  const springTo = (next: RailTab, expand: boolean) => (event: DragEvent) => {
    if (!has(event, REF_DRAG_TYPE) && !has(event, "Files")) return;
    event.preventDefault();
    if ((tab === next && !folded) || springTimer.current) return;
    springTimer.current = setTimeout(() => {
      springTimer.current = null;
      choose(next, expand);
    }, SPRING_LOAD_MS);
  };
  const springCancel = () => {
    if (springTimer.current) clearTimeout(springTimer.current);
    springTimer.current = null;
  };

  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = RAIL_TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? RAIL_TABS[(at + 1) % RAIL_TABS.length]
      : event.key === "ArrowLeft" ? RAIL_TABS[(at + RAIL_TABS.length - 1) % RAIL_TABS.length]
      : event.key === "Home" ? RAIL_TABS[0]
      : event.key === "End" ? RAIL_TABS[RAIL_TABS.length - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    choose(next);
    requestAnimationFrame(() => document.getElementById(`${id}-tab-${next}`)?.focus());
  };

  const loading = !library.ready && (
    <div className="bsr-loading">
      {hasExtras(library) && library.error ? (
        <>
          <p className="bsr-alert" role="alert">
            {copy.loadFailed}
          </p>
          <button type="button" className="bsr-btn" data-variant="soft" onClick={() => library.reload()}>
            {copy.retry}
          </button>
        </>
      ) : (
        <>
          <p className="bsr-sr" role="status">
            {copy.loading}
          </p>
          <SkeletonGrid />
        </>
      )}
    </div>
  );

  return (
    <aside
      ref={root}
      id={props.id}
      className="bsr"
      aria-label={copy.label}
      data-library-rail
      data-studio-assets
      data-library-tab={tab}
      data-open={props.open ? "" : undefined}
      data-collapsed={folded ? "" : undefined}
      data-drop-target={dropActive ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && props.open && !menu) props.onClose();
      }}
      onDragOver={(event) => {
        if (!canCreate || !has(event, "Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropActive(false);
          springCancel();
        }
      }}
      onDrop={(event) => {
        springCancel();
        setDropActive(false);
        if (!canCreate || !event.dataTransfer.files.length) return;
        event.preventDefault();
        props.onFiles(Array.from(event.dataTransfer.files));
        choose("uploads", true);
      }}
    >
      {folded ? (
        <div className="bsr-handle" data-library-handle>
          <button type="button" className="bsr-icon-btn" aria-label={copy.expand} title={copy.expand} aria-expanded={false} onClick={() => fold(false)}>
            <RailIcon name="expand" />
          </button>
          {RAIL_TABS.map((value) => (
            <button
              key={value}
              type="button"
              className="bsr-icon-btn"
              aria-label={copy.tabs[value]}
              title={copy.tabs[value]}
              data-active={value === tab ? "" : undefined}
              onClick={() => choose(value, true)}
              onDragOver={springTo(value === "liked" ? "folders" : value, true)}
              onDragLeave={springCancel}
            >
              <RailIcon name={TAB_ICONS[value]} />
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="bsr-head">
            <div className="bsr-tabs" role="tablist" aria-label={copy.tabsLabel} onKeyDown={tabKeys}>
              {RAIL_TABS.map((value) => (
                <button
                  key={value}
                  id={`${id}-tab-${value}`}
                  type="button"
                  role="tab"
                  className="bsr-tab"
                  aria-selected={tab === value}
                  aria-controls={`${id}-panel`}
                  tabIndex={tab === value ? 0 : -1}
                  data-library-tab-button={value}
                  onClick={() => choose(value)}
                  onDragOver={value === "folders" ? springTo("folders", false) : undefined}
                  onDragLeave={value === "folders" ? springCancel : undefined}
                >
                  {copy.tabs[value]}
                </button>
              ))}
            </div>
            <button type="button" className="bsr-icon-btn bsr-fold" aria-label={copy.collapse} title={copy.collapse} aria-expanded={true} onClick={() => fold(true)}>
              <RailIcon name="collapse" />
            </button>
            <button type="button" className="bsr-icon-btn bsr-sheet-close" aria-label={copy.close} onClick={props.onClose}>
              <RailIcon name="close" />
            </button>
          </div>
          <p className="bsr-status" role="status" aria-live="polite" data-library-status>
            {status}
          </p>
          <div className="bsr-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} data-library-panel={tab}>
            {tab === "uploads" ? (
              <UploadsTab
                kit={kit}
                assets={props.assets}
                notice={props.notice}
                uploading={props.uploading}
                searchId={props.searchId}
                dropActive={dropActive}
                onFiles={props.onFiles}
                onUpdate={props.onUpdate}
                onDelete={props.onDelete}
              />
            ) : !library.ready ? (
              loading
            ) : tab === "folders" ? (
              <FoldersTab
                kit={kit}
                library={library}
                openId={openFolderId}
                onOpen={setOpenFolderId}
                creating={creating}
                onCreating={setCreating}
              />
            ) : liked.length === 0 ? (
              <p className="bsr-empty" data-library-empty="liked">
                {copy.liked.empty}
              </p>
            ) : (
              <ul className="bsr-grid" data-library-liked>
                {liked.map((item) => {
                  const menuKey = `liked:${item.key}`;
                  const items = kit.fileItems(item);
                  return (
                    <Thumb
                      key={item.key}
                      item={item}
                      copy={copy}
                      draggable={canCreate}
                      attachOnPress={attachOnPress}
                      onAttach={props.onAttach}
                      onView={props.onView}
                      actions={[kit.likeAction(item)]}
                      menu={
                        items.length > 0 && (
                          <RailMenu
                            open={menu === menuKey}
                            label={fill(copy.uploads.more, { name: itemName(item, copy) })}
                            items={items}
                            onToggle={(next) => setMenu(next ? menuKey : null)}
                          />
                        )
                      }
                    />
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
