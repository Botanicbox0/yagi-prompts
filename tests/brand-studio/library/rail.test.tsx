import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioAssetView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { LibraryRail } from "@/components/brand-studio/rail";
import { FoldersTab } from "@/components/brand-studio/rail/folders-tab";
import type { RailKit } from "@/components/brand-studio/rail/parts";
import { clock, readRailPrefs, tagsFrom, filterUploads, writeError } from "@/components/brand-studio/rail/text";
import type { LibraryItemView, StudioFolderView, StudioLibrary } from "@/components/brand-studio/seams";

/** docs/BRAND-STUDIO-V3.md §4 — what the rail shows to whom (server-rendered markup, no DOM). */
const ORG = "000000a0-0000-4000-8000-0000000000a0";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copyFor = (locale: "ko" | "en") => getDictionary(locale).studioLibrary;

const asset = (n: number, patch: Partial<StudioAssetView> = {}): StudioAssetView => ({
  id: uuid(n),
  kind: "image",
  role: "product",
  name: `Bottle ${n}`,
  tags: ["spring"],
  url: `https://media.example/st/a-${n}.png`,
  thumbUrl: null,
  width: 800,
  height: 800,
  seconds: null,
  source: "upload",
  createdAt: "2026-11-11T00:00:00Z",
  ...patch,
});
const output = (n: number): StudioOutputView => ({
  id: uuid(n),
  jobId: uuid(9000),
  kind: "image",
  url: `https://media.example/st/o-${n}.png`,
  thumbUrl: `https://media.example/st/o-${n}-thumb.webp`,
  width: 1024,
  height: 1024,
  seconds: null,
  draft: false,
  savedAssetId: null,
  createdAt: "2026-11-11T00:00:00Z",
});
const likedItem = (n: number): LibraryItemView => ({
  key: `o:${uuid(n)}`,
  ref: { outputId: uuid(n) },
  kind: "image",
  url: `https://media.example/st/o-${n}.png`,
  thumbUrl: null,
  name: null,
  width: 10,
  height: 10,
  seconds: null,
  createdAt: "2026-11-11T00:00:00Z",
});
const folder = (n: number, name: string, covers: string[] = [], count = covers.length): StudioFolderView => ({ id: uuid(500 + n), name, count, covers, updatedAt: "2026-11-11T00:00:00Z" });

function stubLibrary(patch: Partial<StudioLibrary> = {}): StudioLibrary {
  return {
    ready: true,
    folders: [],
    liked: new Set(),
    likedItems: [],
    folderItems: () => null,
    openFolder: () => {},
    toggleLike: async () => true,
    createFolder: async () => null,
    renameFolder: async () => true,
    deleteFolder: async () => true,
    addToFolder: async () => true,
    removeFromFolder: async () => true,
    ...patch,
  };
}

type RailProps = Parameters<typeof LibraryRail>[0];
function rail(patch: Partial<RailProps> = {}, locale: "ko" | "en" = "ko") {
  const props: RailProps = {
    id: "library",
    organizationId: ORG,
    locale,
    library: stubLibrary(),
    assets: [],
    outputOf: () => null,
    canCreate: true,
    attachOnPress: true,
    open: false,
    notice: null,
    uploading: [],
    searchId: "library-search",
    onClose() {},
    onAttach() {},
    onView() {},
    onFiles() {},
    onUpdate: async () => ({ ok: true }),
    onDelete: async () => ({ ok: true }),
    copy: copyFor(locale),
    ...patch,
  };
  return renderToStaticMarkup(<LibraryRail {...props} />);
}

describe("library rail", () => {
  it("opens on uploads with three tabs, dragging and uploading for creators, and no filled button", () => {
    const copy = copyFor("ko");
    const html = rail({
      assets: [asset(1), asset(2, { kind: "video", seconds: 6.4, thumbUrl: "https://media.example/st/v.webp" }), asset(3, { kind: "audio", name: "jingle.mp3", seconds: 75 })],
    });
    expect(html).toContain("data-library-rail");
    expect(html).toContain("data-studio-assets");
    expect(html).toContain('data-library-tab="uploads"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    for (const label of [copy.tabs.folders, copy.tabs.liked, copy.tabs.uploads]) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('aria-selected="true" aria-controls');
    expect(html).toContain("data-studio-upload");
    expect(html.match(/draggable="true"/g)).toHaveLength(3);
    expect(html).toContain(`aria-label="Bottle 1 레퍼런스에 추가"`);
    expect(html).toContain(">0:06<");
    expect(html).toContain(">1:15<");
    expect(html).toContain("jingle.mp3");
    expect(html).toContain('id="library-search"');
    expect(html).not.toContain('data-variant="solid"');
  });

  it("lets viewers look without uploading or dragging, and opens a picture on press", () => {
    const copy = copyFor("en");
    const html = rail({ canCreate: false, attachOnPress: false, assets: [asset(1)] }, "en");
    expect(html).not.toContain("data-studio-upload");
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain('aria-label="Open Bottle 1"');
    expect(rail({ canCreate: false, attachOnPress: false }, "en")).toContain(copy.uploads.emptyReadOnly);
  });

  it("says what each empty tab is for", () => {
    const copy = copyFor("ko");
    expect(rail()).toContain(copy.uploads.empty);
    expect(rail({ initialTab: "liked" })).toContain(copy.liked.empty);
    expect(rail({ initialTab: "folders" })).toContain(copy.folders.empty);
  });

  it("waits for the library before the folder and liked tabs, and offers a retry when it failed", () => {
    const copy = copyFor("ko");
    const waiting = rail({ initialTab: "folders", library: stubLibrary({ ready: false }) });
    expect(waiting).toContain("data-library-skeleton");
    expect(waiting).toContain(copy.loading);
    const failed = rail({ initialTab: "liked", library: { ...stubLibrary({ ready: false }), error: true, lastError: null, reload() {} } as StudioLibrary });
    expect(failed).toContain(copy.loadFailed);
    expect(failed).toContain(copy.retry);
  });

  it("lists likes newest first, with a just-liked result before the server has answered, hearts pressed", () => {
    const html = rail({
      initialTab: "liked",
      library: stubLibrary({ liked: new Set([`o:${uuid(7)}`, `o:${uuid(8)}`]), likedItems: [likedItem(8)] }),
      outputOf: (id) => (id === uuid(7) ? output(7) : null),
    });
    const first = html.indexOf(`data-library-item="o:${uuid(7)}"`);
    const second = html.indexOf(`data-library-item="o:${uuid(8)}"`);
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="이미지 좋아요"');
    expect(html).toContain('title="이미지 좋아요 취소"');
  });
});

const kit = (patch: Partial<RailKit> = {}): RailKit => ({
  copy: copyFor("ko"),
  canCreate: true,
  attachOnPress: true,
  onAttach() {},
  onView() {},
  likeAction: (item) => ({ key: "like", label: `like ${item.key}`, icon: "heart", run() {} }),
  fileItems: () => [],
  menu: null,
  setMenu() {},
  say() {},
  ...patch,
});

describe("folders tab", () => {
  const folders = [folder(1, "로고", ["/a.png", "/b.png", "/c.png", "/d.png", "/e.png"], 9), folder(2, "봄 신제품", ["/x.png"]), folder(3, "빈 폴더")];
  const render = (k: RailKit, library: StudioLibrary, openId: string | null = null, creating = false) =>
    renderToStaticMarkup(<FoldersTab kit={k} library={library} openId={openId} onOpen={() => {}} creating={creating} onCreating={() => {}} />);

  it("draws tiles with a mosaic of up to four, the count, and a menu for creators", () => {
    const html = render(kit(), stubLibrary({ folders }));
    expect(html.match(/data-library-folder="/g)).toHaveLength(3);
    expect(html).toContain('data-n="4"');
    expect(html).toContain('data-n="1"');
    expect(html).toContain('data-n="0"');
    expect(html).toContain(">9개<");
    expect(html).toContain('aria-label="로고 폴더 열기"');
    expect(html).toContain('aria-label="로고 폴더 더보기"');
    expect(html).toContain("data-library-new-folder");
  });

  it("gives viewers the folders to open but nothing to change", () => {
    const html = render(kit({ canCreate: false }), stubLibrary({ folders }));
    expect(html).not.toContain("data-library-new-folder");
    expect(html).not.toContain("폴더 더보기");
    expect(render(kit({ canCreate: false }), stubLibrary())).toContain(copyFor("ko").folders.emptyReadOnly);
  });

  it("shows the name field, an open folder's grid with a way back, and its empty line", () => {
    const copy = copyFor("ko");
    expect(render(kit(), stubLibrary({ folders }), null, true)).toContain("data-library-name-form");
    const open = render(kit(), stubLibrary({ folders, folderItems: () => [likedItem(4)] }), folders[0]!.id);
    expect(open).toContain(`data-library-folder-open="${folders[0]!.id}"`);
    expect(open).toContain(copy.folders.back);
    expect(open).toContain(`data-library-item="o:${uuid(4)}"`);
    expect(open).toContain("이미지 폴더에서 빼기");
    expect(render(kit(), stubLibrary({ folders, folderItems: () => [] }), folders[2]!.id)).toContain(copy.folders.emptyFolder);
    expect(render(kit(), stubLibrary({ folders }), folders[2]!.id)).toContain("data-library-skeleton");
  });
});

describe("rail helpers", () => {
  it("formats lengths, tags, search, saved preferences and refusals", () => {
    const copy = copyFor("en");
    expect(clock(6.4)).toBe("0:06");
    expect(clock(75)).toBe("1:15");
    expect(tagsFrom("봄, 신제품 ,  ,봄")).toEqual(["봄", "신제품"]);
    expect(filterUploads([asset(1), asset(2, { role: "logo", tags: ["mark"] })], "MARK", "all").map((a) => a.id)).toEqual([uuid(2)]);
    expect(filterUploads([asset(1), asset(2, { role: "logo" })], "", "product").map((a) => a.id)).toEqual([uuid(1)]);
    expect(readRailPrefs('{"collapsed":true,"tab":"liked"}')).toEqual({ collapsed: true, tab: "liked" });
    expect(readRailPrefs('{"tab":"elsewhere"}')).toEqual({ collapsed: false, tab: "uploads" });
    expect(readRailPrefs("not json")).toBeNull();
    expect(writeError(copy, "asset_limit", "create")).toBe(copy.errors.folderLimit);
    expect(writeError(copy, "asset_limit", "add")).toBe(copy.errors.folderFull);
    expect(writeError(copy, "conflict", "rename")).toBe(copy.errors.conflict);
    expect(writeError(copy, "reference_missing", "add")).toBe(copy.errors.missing);
    expect(writeError(copy, "provider_unavailable", "like")).toBe(copy.errors.failed);
  });

  it("keeps internal names off the screen in both languages", () => {
    for (const locale of ["ko", "en"] as const) {
      const text = JSON.stringify(copyFor(locale));
      expect(text).not.toMatch(/slack|supabase|sunra|webhook|seedream|nano banana|gpt image|morphic|모픽|api/i);
    }
  });
});
