import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioJobView } from "@/lib/brand-studio/contracts";
import { Wall, deleteConfirmLine, wallSelectable, type WallProps } from "@/components/brand-studio/gallery/wall";
import {
  EMPTY_SELECTION,
  bulkActions,
  failedKey,
  pruneSelection,
  resultKey,
  selectRange,
  selectedTargets,
  toggleSelection,
} from "@/components/brand-studio/gallery/selection";
import { downloadName } from "@/components/brand-studio/gallery/download";
import { initialStore, studioReducer } from "@/components/brand-studio/store";
import { fill } from "@/components/brand-studio/copy";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { copyFor, id, job, output, studioState } from "./fixtures";

/**
 * docs/BRAND-STUDIO-V6-PLAN.md §7 row B — selecting several tiles, the action bar, and removing runs that
 * ended with no result. The rule for a clip with versions: a tile is the version on screen and nothing else.
 */
const NOW = new Date("2026-11-11T03:00:00Z");
const library: StudioLibrary = {
  ready: true,
  folders: [],
  liked: new Set<string>(),
  likedItems: [],
  folderItems: () => null,
  openFolder: () => {},
  toggleLike: async () => true,
  createFolder: async () => null,
  renameFolder: async () => true,
  deleteFolder: async () => true,
  addToFolder: async () => true,
  removeFromFolder: async () => true,
};
function wall(patch: Partial<WallProps> = {}) {
  const props: WallProps = {
    mode: "image",
    jobs: [],
    copy: copyFor("ko"),
    locale: "ko",
    canGenerate: true,
    canEdit: true,
    canStop: true,
    canRemove: true,
    library,
    now: NOW,
    parentOf: () => null,
    onAction: () => {},
    onRetry: () => {},
    onCancel: () => {},
    onRemove: async () => true,
    onNotice: () => {},
    ...patch,
  };
  return renderToStaticMarkup(<Wall {...props} />);
}

const pictures = job(1, { outputs: [output(1), output(2), output(3)] });
const broken = job(2, { status: "failed", errorCode: "failed", outputs: [] });
const waiting = job(3, { status: "running", outputs: [] });
const K = (n: number) => resultKey(output(n).id);

describe("selection as data", () => {
  const order = [K(1), K(2), K(3), failedKey(broken.id)];

  it("toggles one tile per press and remembers where a range starts", () => {
    const one = toggleSelection(EMPTY_SELECTION, K(2));
    expect([...one.keys]).toEqual([K(2)]);
    expect(one.anchor).toBe(K(2));
    const none = toggleSelection(one, K(2));
    expect(none.keys.size).toBe(0);
  });

  it("selects everything between the last pressed tile and a Shift+click, in screen order, either direction", () => {
    const down = selectRange(toggleSelection(EMPTY_SELECTION, K(1)), order, failedKey(broken.id));
    expect([...down.keys]).toEqual(order);
    const up = selectRange(toggleSelection(EMPTY_SELECTION, K(3)), order, K(1));
    expect([...up.keys].sort()).toEqual([K(1), K(2), K(3)].sort());
    // A range adds to what was selected, and the starting tile stays the start.
    const more = selectRange(toggleSelection(toggleSelection(EMPTY_SELECTION, failedKey(broken.id)), K(1)), order, K(2));
    expect(more.keys.size).toBe(3);
    expect(more.anchor).toBe(K(1));
    // No starting tile on the wall: a plain press.
    expect([...selectRange(EMPTY_SELECTION, order, K(2)).keys]).toEqual([K(2)]);
    expect([...selectRange({ keys: new Set(), anchor: "o:gone" }, order, K(2)).keys]).toEqual([K(2)]);
  });

  it("forgets tiles that left the wall", () => {
    const picked = selectRange(toggleSelection(EMPTY_SELECTION, K(1)), order, K(3));
    const left = pruneSelection(picked, [K(2), K(3)]);
    expect([...left.keys]).toEqual([K(2), K(3)]);
    expect(left.anchor).toBeNull();
    expect(pruneSelection(left, [K(2), K(3)])).toBe(left);
  });

  it("offers each action only for what it applies to and what the member may do", () => {
    const tiles = wallSelectable([pictures, broken], () => null, true);
    const both = selectedTargets(tiles, { keys: new Set([K(1), failedKey(broken.id)]), anchor: null });
    expect(both.items.map((i) => i.output.id)).toEqual([output(1).id]);
    expect(both.failed.map((j) => j.id)).toEqual([broken.id]);
    const full = { canGenerate: true, canEdit: true, canRemove: true };
    expect(bulkActions(both, full)).toEqual(["reference", "folder", "download", "delete"]);
    expect(bulkActions(both, { canGenerate: false, canEdit: false, canRemove: false })).toEqual(["download"]);
    expect(bulkActions(both, { ...full, canGenerate: false })).toEqual(["folder", "download", "delete"]);
    const failedOnly = selectedTargets(tiles, { keys: new Set([failedKey(broken.id)]), anchor: null });
    expect(bulkActions(failedOnly, full)).toEqual(["delete"]);
    expect(bulkActions(failedOnly, { ...full, canRemove: false })).toEqual([]);
  });
});

describe("the wall with checkboxes", () => {
  it("puts a checkbox on every result and failed tile, never on a place still being made", () => {
    const g = copyFor("ko").gallery;
    const html = wall({ jobs: [waiting, broken, pictures] });
    expect(html.match(/role="checkbox"/g)).toHaveLength(4);
    expect(html.match(/role="checkbox" aria-checked="false"/g)).toHaveLength(4);
    expect(html).toContain(`aria-label="${fill(g.selectTile, { n: 1 })}"`);
    expect(html).toContain(`aria-label="${g.selectFailed}"`);
    expect(html).not.toContain("data-studio-selection-bar");
    const pending = html.match(/<div class="bs-tile" data-state="pending"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(pending).not.toContain('role="checkbox"');
    expect(wallSelectable([waiting, broken, pictures], () => null, true).map((t) => t.key)).toEqual([failedKey(broken.id), K(1), K(2), K(3)]);
  });

  it("gives a failed tile a remove button, only where runs can be removed", () => {
    const g = copyFor("ko").gallery;
    const html = wall({ jobs: [broken] });
    expect(html).toMatch(new RegExp(`data-studio-remove[^>]*aria-label="${g.removeFailed}"|aria-label="${g.removeFailed}"[^>]*data-studio-remove`));
    // Before the server can remove a run (or for a viewer) the tile is as it was: no checkbox, no button.
    for (const closed of [wall({ jobs: [broken], canRemove: false }), wall({ jobs: [broken], canRemove: true, onRemove: undefined })]) {
      expect(closed).not.toContain("data-studio-remove");
      expect(closed).not.toContain('role="checkbox"');
      expect(closed).toContain(copyFor("ko").board.retry);
    }
    expect(wallSelectable([broken, pictures], () => null, false).map((t) => t.key)).toEqual([K(1), K(2), K(3)]);
  });

  it("shows a floating bar with the count and the four actions once something is selected", () => {
    const copy = copyFor("ko");
    const g = copy.gallery;
    const html = wall({ jobs: [broken, pictures], initialSelection: [K(1), K(3), failedKey(broken.id)] });
    expect(html.match(/role="checkbox" aria-checked="true"/g)).toHaveLength(3);
    expect(html.match(/data-selected=""/g)).toHaveLength(3);
    expect(html).toContain('data-selecting=""');
    const bar = html.match(/<div[^>]*data-studio-selection-bar[\s\S]*$/)?.[0] ?? "";
    expect(bar).toContain('role="toolbar"');
    expect(bar).toContain(fill(g.selected, { n: 3 }));
    expect([...bar.matchAll(/data-bulk="([a-z]+)"/g)].map((m) => m[1])).toEqual(["reference", "folder", "download", "delete"]);
    expect(bar).toContain(g.reference);
    expect(bar).toContain(g.folder);
    expect(bar).toContain(g.menu.download);
    expect(bar).toContain(g.menu.delete);
    expect(bar).toContain(`aria-label="${g.clearSelection}"`);
    // A viewer may still download what they picked; nothing else.
    const viewer = wall({ jobs: [pictures], canGenerate: false, canEdit: false, canRemove: false, initialSelection: [K(2)] });
    expect([...viewer.matchAll(/data-bulk="([a-z]+)"/g)].map((m) => m[1])).toEqual(["download"]);
    // A selection that is no longer on the wall is no selection.
    expect(wall({ jobs: [pictures], initialSelection: ["o:gone"] })).not.toContain("data-studio-selection-bar");
  });
});

describe("a clip with versions is one tile: the version on screen", () => {
  const clip = (n: number, patch: Partial<StudioJobView> = {}) =>
    job(n, { kind: "video", aspect: "9:16", resolution: "480p", seconds: 5, audio: "native", outputs: [output(n, { kind: "video", jobId: id(0x2000 + n), draft: true })], ...patch });
  const ROOT = job(1).id;
  const rev = (version: number, base: string) => ({ rootJobId: ROOT, version, baseOutputId: base, mode: "edit" as const, added: 0 });
  const v1 = clip(1);
  const v2 = clip(2, { kind: "video_remix", prompt: "병을 더 크게", revision: rev(2, output(1).id) });
  const v3 = clip(3, { kind: "video_remix", prompt: "배경을 밤으로", revision: rev(3, output(2).id) });
  const failedV4 = clip(4, { kind: "video_remix", status: "failed", errorCode: "failed", outputs: [], prompt: "더 밝게", revision: rev(4, output(3).id) });
  const chain = [failedV4, v3, v2, v1];

  it("selects only the shown version; the versions behind it are not in the selection", () => {
    const tiles = wallSelectable(chain, () => null, true);
    expect(tiles.map((t) => t.key)).toEqual([failedKey(failedV4.id), K(3)]);
    const all = selectedTargets(tiles, { keys: new Set(tiles.map((t) => t.key)), anchor: null });
    expect(all.items.map((i) => i.output.id)).toEqual([output(3).id]);
    expect(all.failed.map((j) => j.id)).toEqual([failedV4.id]);
    const html = wall({ mode: "video", jobs: chain });
    expect(html.match(/role="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain(output(2).url);
  });

  it("says that earlier versions stay when a selected tile has them, and only then", () => {
    const g = copyFor("ko").gallery;
    const tiles = wallSelectable([...chain, job(9, { outputs: [output(9)] })], () => null, true);
    const versioned = selectedTargets(tiles, { keys: new Set([K(3), K(9)]), anchor: null });
    expect(deleteConfirmLine(versioned, [...chain], copyFor("ko"))).toBe(`${fill(g.bulkDeleteConfirm, { n: 2 })} ${g.bulkDeleteVersions}`);
    const plain = selectedTargets(tiles, { keys: new Set([K(9)]), anchor: null });
    expect(deleteConfirmLine(plain, [...chain], copyFor("ko"))).toBe(fill(g.bulkDeleteConfirm, { n: 1 }));
  });

  it("brings the version before back when the shown one is deleted, and drops a removed failed run", () => {
    let store = initialStore(studioState({ jobs: chain }));
    // Deleting the v3 tile deletes that one result (output.delete); v2 and v1 are untouched.
    store = studioReducer(store, { type: "outputRemoved", outputId: output(3).id });
    store = studioReducer(store, { type: "jobRemoved", jobId: failedV4.id });
    const jobs = store.state!.jobs;
    expect(jobs.map((j) => j.id)).toEqual([v3.id, v2.id, v1.id]);
    expect(jobs.find((j) => j.id === v2.id)!.outputs).toHaveLength(1);
    expect(jobs.find((j) => j.id === v1.id)!.outputs).toHaveLength(1);
    expect(wallSelectable(jobs, () => null, true).map((t) => t.key)).toEqual([K(2)]);
    expect(wall({ mode: "video", jobs })).toContain('data-revision-badge="2"');
  });
});

describe("downloading several", () => {
  it("names each file after its result and its type", () => {
    expect(downloadName(output(1), "image/png")).toBe(`twings-${output(1).id.slice(0, 8)}.png`);
    expect(downloadName(output(2, { kind: "video", url: "https://media.example/st/out-2.mp4" }), "")).toBe(`twings-${output(2).id.slice(0, 8)}.mp4`);
    expect(downloadName(output(3, { url: "https://media.example/st/out-3" }), "image/webp")).toBe(`twings-${output(3).id.slice(0, 8)}.webp`);
    expect(downloadName(output(4, { url: "https://media.example/st/out-4" }), "")).toBe(`twings-${output(4).id.slice(0, 8)}.png`);
  });
});
