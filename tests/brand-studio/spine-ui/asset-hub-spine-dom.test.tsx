import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type {
  BrandProjectFilesScope,
  StudioAssetView,
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectOverview,
  StudioState,
} from "@/lib/brand-studio/contracts";
import type { ApiResult, StudioApi } from "@/components/brand-studio/api";
import { BrandAssetHub, type HubSection } from "@/components/brand-studio/asset-hub";
import { AssetHubSpine } from "@/components/brand-studio/asset-hub-spine";
import type { SpineMutationKind } from "@/components/brand-studio/asset-hub-spine/model";
import { HubTile } from "@/components/brand-studio/asset-hub-tile";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { mountDom } from "@/tests/brands/_dom-harness";
import { ORG, asset, id, studioState } from "../ui/fixtures";

const P1 = id(0x81);
const P1_TITLE = "봄 향수 론칭";

vi.mock("@/components/brand-studio/rail/use-library", () => ({
  useStudioLibrary: () => stubLibrary(),
}));

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

const emptyCounts = (patch: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...patch,
});

function unfiledAsset(n: number, brandProjectId: string | null = null): StudioAssetView {
  return asset(n, {
    name: `미분류 파일 ${n}`,
    role: null,
    brandProjectId,
    thumbUrl: `https://media.example/u${n}-thumb.webp`,
    url: `https://media.example/u${n}.png`,
  });
}

interface DeferredRead<T> {
  id: number;
  afterDelete: boolean;
  settled: boolean;
  scope?: BrandProjectFilesScope;
  cursor?: string | null;
  resolve: () => void;
  fail: (code?: "failed" | "not_found") => void;
  reject: (err?: Error) => void;
  _rawResolve: (value: T) => void;
  _rawReject: (err: unknown) => void;
}

function createManualSpineHarnessApi(initialAssets: readonly StudioAssetView[]) {
  const catalog = [...initialAssets];
  const projectMap = new Map<string, string | null>(initialAssets.map((a) => [a.id, a.brandProjectId ?? null]));
  const deletedIds = new Set<string>();
  let seq = 0;
  let deleteCompletedOnServer = false;

  const overviewReads: DeferredRead<ApiResult<StudioBrandProjectOverview>>[] = [];
  const stateReads: DeferredRead<ApiResult<StudioState>>[] = [];
  const filesReads: DeferredRead<ApiResult<StudioBrandProjectFiles>>[] = [];

  const liveAssets = (): StudioAssetView[] =>
    catalog
      .filter((a) => !deletedIds.has(a.id))
      .map((a) => ({ ...a, brandProjectId: projectMap.get(a.id) ?? null }));

  const snapshotOverview = (): StudioBrandProjectOverview => {
    const alive = liveAssets();
    const p1Count = alive.filter((a) => a.brandProjectId === P1).length;
    const unfiledCount = alive.filter((a) => a.brandProjectId === null).length;
    return {
      ok: true,
      projects: [
        {
          project: { id: P1, title: P1_TITLE, origin: "self", lastActivityAt: "2026-11-26T05:00:00Z" },
          counts: emptyCounts({ upload: p1Count }),
          covers: [],
        },
      ],
      unfiled: {
        counts: emptyCounts({ upload: unfiledCount }),
        covers: [],
      },
      brandMaterials: {
        count: 0,
        byRole: { product: 0, person: 0, logo: 0, style: 0, place: 0 },
        covers: [],
      },
    };
  };

  const snapshotState = (): StudioState => studioState({ assets: liveAssets(), canCreate: true });

  const snapshotFiles = (scope: BrandProjectFilesScope, cursor?: string | null): StudioBrandProjectFiles => {
    const alive = liveAssets();
    const scoped =
      scope.kind === "unfiled"
        ? alive.filter((a) => a.brandProjectId === null)
        : scope.kind === "project"
          ? alive.filter((a) => a.brandProjectId === scope.brandProjectId)
          : [];
    const slice = cursor === "page-2" ? scoped.slice(4) : scoped.slice(0, 4);
    const next = !cursor && scoped.length > 4 ? "page-2" : null;
    return {
      ok: true,
      items: slice.map((a) => ({ type: "asset" as const, id: a.id })),
      assets: slice,
      jobs: [],
      films: [],
      next,
    };
  };

  function makeDeferred<T>(
    list: DeferredRead<T>[],
    snapshot: () => T,
    extra: { scope?: BrandProjectFilesScope; cursor?: string | null } = {},
  ): Promise<T> {
    const captured = snapshot();
    const afterDelete = deleteCompletedOnServer;
    const entrySeq = ++seq;
    let _rawResolve!: (value: T) => void;
    let _rawReject!: (err: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      _rawResolve = resolve;
      _rawReject = reject;
    });
    const entry: DeferredRead<T> = {
      id: entrySeq,
      afterDelete,
      settled: false,
      ...extra,
      resolve: () => {
        if (entry.settled) return;
        entry.settled = true;
        _rawResolve(captured);
      },
      fail: (code = "failed") => {
        if (entry.settled) return;
        entry.settled = true;
        _rawResolve({ ok: false, code } as unknown as T);
      },
      reject: (err = new Error("network")) => {
        if (entry.settled) return;
        entry.settled = true;
        _rawReject(err);
      },
      _rawResolve,
      _rawReject,
    };
    list.push(entry);
    return promise;
  }

  const api = {
    organizationId: ORG,
    loadState: () => makeDeferred<ApiResult<StudioState>>(stateReads, snapshotState),
    poll: vi.fn(async () => ({ ok: true as const, allowance: studioState().allowance, jobs: [] })),
    call: vi.fn(async (operation: string, input: Record<string, unknown>) => {
      if (operation === "asset.delete") {
        const assetId = String(input.assetId ?? "");
        deletedIds.add(assetId);
        deleteCompletedOnServer = true;
        return { ok: true as const };
      }
      if (operation === "asset.update") {
        const assetId = String(input.assetId ?? "");
        const hit = liveAssets().find((a) => a.id === assetId);
        if (!hit) return { ok: false as const, code: "not_found" as const };
        return { ok: true as const, asset: hit };
      }
      return { ok: true as const };
    }) as unknown as StudioApi["call"],
    listBrandProjects: vi.fn(async () => ({ ok: true as const, projects: snapshotOverview().projects.map((g) => g.project) })),
    createBrandProject: vi.fn(),
    moveToBrandProject: vi.fn(async (input) => {
      if (input.preview) {
        return {
          ok: true as const,
          projectId: input.projectId ?? null,
          jobIds: [...(input.jobIds ?? [])],
          assetIds: [...(input.assetIds ?? [])],
          filmIds: [...(input.filmIds ?? [])],
        };
      }
      for (const assetId of input.assetIds ?? []) {
        projectMap.set(assetId, input.projectId ?? null);
      }
      return {
        ok: true as const,
        projectId: input.projectId ?? null,
        jobIds: [...(input.jobIds ?? [])],
        assetIds: [...(input.assetIds ?? [])],
        filmIds: [...(input.filmIds ?? [])],
      };
    }),
    loadBrandProjectOverview: () => makeDeferred<ApiResult<StudioBrandProjectOverview>>(overviewReads, snapshotOverview),
    loadBrandProjectCards: vi.fn(),
    listBrandProjectFiles: (input: { scope: BrandProjectFilesScope; cursor?: string | null }) =>
      makeDeferred<ApiResult<StudioBrandProjectFiles>>(filesReads, () => snapshotFiles(input.scope, input.cursor), {
        scope: input.scope,
        cursor: input.cursor ?? null,
      }),
    upload: vi.fn(async (file: { name: string }) => {
      const nextNum = 90 + catalog.length;
      const uploaded = asset(nextNum, {
        name: file.name,
        role: null,
        brandProjectId: null,
        thumbUrl: `https://media.example/u${nextNum}-thumb.webp`,
        url: `https://media.example/u${nextNum}.png`,
      });
      catalog.unshift(uploaded);
      projectMap.set(uploaded.id, null);
      return { ok: true as const, asset: uploaded, roleCheck: false };
    }),
  } as unknown as StudioApi;

  return {
    api,
    initialOverview: snapshotOverview(),
    initialState: snapshotState(),
    overviewReads,
    stateReads,
    filesReads,
    pendingCounts: () => ({
      overview: overviewReads.filter((r) => !r.settled).length,
      state: stateReads.filter((r) => !r.settled).length,
      files: filesReads.filter((r) => !r.settled).length,
    }),
  };
}

async function resolveRead<T>(read: DeferredRead<T> | undefined, mode: "ok" | "fail" | "reject" = "ok") {
  if (!read) throw new Error("Expected deferred read to exist");
  await act(async () => {
    if (mode === "ok") read.resolve();
    else if (mode === "fail") read.fail("failed");
    else read.reject(new Error("boom"));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function settleAllRemaining(h: ReturnType<typeof createManualSpineHarnessApi>) {
  for (let guard = 0; guard < 12; guard += 1) {
    const nextOverview = h.overviewReads.find((r) => !r.settled);
    const nextState = h.stateReads.find((r) => !r.settled);
    const nextFiles = h.filesReads.find((r) => !r.settled);
    if (!nextOverview && !nextState && !nextFiles) return;
    if (nextOverview) await resolveRead(nextOverview);
    if (nextState) await resolveRead(nextState);
    if (nextFiles) await resolveRead(nextFiles);
  }
  throw new Error("Refresh requests did not stop queuing (possible loop)");
}

async function mountWithSelectSupport(node: Parameters<typeof mountDom>[0]) {
  const dom = await mountDom(node);
  const g = globalThis as unknown as {
    Element?: { prototype: Record<string, unknown> };
    HTMLSelectElement?: { prototype: { childNodes: Array<{ tagName?: string }> } };
  };
  if (g.Element?.prototype && !g.Element.prototype.getAttributeNames) {
    g.Element.prototype.getAttributeNames = function getAttributeNames(this: { attributes?: Record<string, string> }) {
      return Object.keys(this.attributes ?? {});
    };
  }
  const SelectProto = g.HTMLSelectElement?.prototype;
  if (SelectProto && !Object.getOwnPropertyDescriptor(SelectProto, "options")) {
    Object.defineProperty(SelectProto, "options", {
      get() {
        return (this as { childNodes: Array<{ tagName?: string }> }).childNodes.filter(
          (c) => c.tagName === "OPTION",
        );
      },
      configurable: true,
    });
  }
  return dom;
}

describe("Fix round 5 item 1 DOM race: move -> delete on 미분류", () => {
  const prevWidth = (globalThis as Record<string, unknown>).innerWidth;
  const prevHeight = (globalThis as Record<string, unknown>).innerHeight;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = 1440;
    (globalThis as Record<string, unknown>).innerHeight = 900;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = prevWidth;
    (globalThis as Record<string, unknown>).innerHeight = prevHeight;
    vi.restoreAllMocks();
  });

  type WalkOrder =
    | "move-overview-then-state-then-files"
    | "delete-state-before-move-state"
    | "delete-files-first-then-states-then-queued-overview"
    | "move-overview-fails-then-queued-overview"
    | "move-overview-rejects-then-queued-overview";

  it.each<WalkOrder>([
    "move-overview-then-state-then-files",
    "delete-state-before-move-state",
    "delete-files-first-then-states-then-queued-overview",
    "move-overview-fails-then-queued-overview",
    "move-overview-rejects-then-queued-overview",
  ])(
    "walk (%s): page 2 -> bulk move 3 -> delete upload from AssetDialog -> no stale state/missing read/queued read",
    async (order) => {
      const ko = getDictionary("ko");
      const assets = [
        unfiledAsset(1),
        unfiledAsset(2),
        unfiledAsset(3),
        unfiledAsset(4),
        unfiledAsset(5),
        unfiledAsset(6),
      ];
      const u1 = assets[0]!;
      const u2 = assets[1]!;
      const u3 = assets[2]!;
      const u4 = assets[3]!;
      const u5 = assets[4]!;
      const h = createManualSpineHarnessApi(assets);

      const dom = await mountWithSelectSupport(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={ko.brandStudio}
          libraryCopy={ko.studioLibrary}
          initialState={h.initialState}
          injectedLibrary={stubLibrary()}
          api={h.api}
          spine={{
            overview: h.initialOverview,
            canMove: true,
            copy: ko.projectSpine,
            filmMeta: ko.studioVideo.workspace.projects.meta,
          }}
          initialSpine={{ tab: "unfiled" }}
        />,
      );

      try {
        // 1. Initial 미분류 page 1 -> resolves [u1..u4] with next page.
        expect(h.filesReads).toHaveLength(1);
        await resolveRead(h.filesReads[0]);
        expect(dom.query(`[data-asset-hub-card="a:${u1.id}"]`)).not.toBeNull();

        // 2. Load page 2 -> resolves [u5, u6].
        await dom.click("[data-asset-hub-more]");
        expect(h.filesReads).toHaveLength(2);
        await resolveRead(h.filesReads[1]);
        expect(dom.query(`[data-asset-hub-card="a:${u5.id}"]`)).not.toBeNull();

        // 3. Enter selection, select u1 + u2 + u5 (spans page 1 and page 2).
        await dom.click("[data-asset-hub-select]");
        await dom.click(`[data-asset-hub-card="a:${u1.id}"] [data-asset-hub-open]`);
        await dom.click(`[data-asset-hub-card="a:${u2.id}"] [data-asset-hub-open]`);
        await dom.click(`[data-asset-hub-card="a:${u5.id}"] [data-asset-hub-open]`);
        expect(dom.query("[data-asset-hub-selected-count]")?.textContent).toContain("3");

        // 4. Open MoveToProjectDialog, pick P1, submit bulk move -> move triggers overview M, state M, first page M.
        await dom.click("[data-asset-hub-move]");
        const radio = dom.query(`[data-project-move-option="${P1}"] input`);
        if (!radio) throw new Error("Expected P1 radio input");
        radio.checked = true;
        await dom.click(radio);
        await dom.submit("[data-project-move-dialog] form");

        const overviewAfterMoveStart = h.overviewReads.length;
        const stateAfterMoveStart = h.stateReads.length;
        const filesAfterMoveStart = h.filesReads.length;
        expect(overviewAfterMoveStart).toBe(1);
        expect(stateAfterMoveStart).toBe(1);
        expect(filesAfterMoveStart).toBe(3);

        const moveOverview = h.overviewReads[0]!;
        const moveState = h.stateReads[0]!;
        const moveFiles = h.filesReads[2]!;

        // 5. Resolve only first page M so remaining unfiled upload tile (u4) renders while move's overview + state stay pending.
        await resolveRead(moveFiles);
        expect(dom.query(`[data-asset-hub-card="a:${u4.id}"]`)).not.toBeNull();
        expect(moveOverview.settled).toBe(false);
        expect(moveState.settled).toBe(false);

        // 6. Immediately open u4's tile menu -> 수정 (AssetDialog) -> 삭제 -> 삭제 confirm.
        await dom.click(`[data-asset-hub-card="a:${u4.id}"] [aria-haspopup="menu"]`);
        await dom.click("[data-asset-hub-edit]");
        expect(dom.query("[data-library-asset-editor]")).not.toBeNull();

        const buttons1 = dom.queryAll("[data-library-asset-editor] button");
        const deleteOpenBtn = buttons1.find((b) => b.textContent === ko.studioLibrary.uploads.delete);
        if (!deleteOpenBtn) throw new Error("Delete trigger button not found in AssetDialog");
        await dom.click(deleteOpenBtn);

        const buttons2 = dom.queryAll("[data-library-asset-editor] button");
        const confirmBtn = buttons2.find((b) => b.textContent === ko.studioLibrary.uploads.deleteYes);
        if (!confirmBtn) throw new Error("Confirm delete button not found in AssetDialog");
        await dom.click(confirmBtn);

        // Server deleted u4! Now resolve pending reads in each order.
        const filesReadsAfterDeleteCall = h.filesReads.filter((r) => r.afterDelete);
        const stateReadsAfterDeleteCall = h.stateReads.filter((r) => r.afterDelete);
        expect(filesReadsAfterDeleteCall.length).toBeGreaterThanOrEqual(1);
        expect(stateReadsAfterDeleteCall.length).toBeGreaterThanOrEqual(1);

        const deleteFiles = filesReadsAfterDeleteCall[0]!;
        const deleteState = stateReadsAfterDeleteCall[0]!;

        if (order === "move-overview-then-state-then-files") {
          await resolveRead(moveOverview);
          const deleteOverview = h.overviewReads.find((r) => r.afterDelete);
          expect(deleteOverview).toBeDefined();
          await resolveRead(deleteOverview);
          await resolveRead(moveState);
          await resolveRead(deleteState);
          await resolveRead(deleteFiles);
        } else if (order === "delete-state-before-move-state") {
          await resolveRead(deleteState);
          await resolveRead(moveState);
          await resolveRead(deleteFiles);
          await resolveRead(moveOverview);
          const deleteOverview = h.overviewReads.find((r) => r.afterDelete);
          expect(deleteOverview).toBeDefined();
          await resolveRead(deleteOverview);
        } else if (order === "delete-files-first-then-states-then-queued-overview") {
          await resolveRead(deleteFiles);
          await resolveRead(deleteState);
          await resolveRead(moveState);
          await resolveRead(moveOverview);
          const deleteOverview = h.overviewReads.find((r) => r.afterDelete);
          expect(deleteOverview).toBeDefined();
          await resolveRead(deleteOverview);
        } else if (order === "move-overview-fails-then-queued-overview") {
          await resolveRead(moveOverview, "fail");
          const deleteOverview = h.overviewReads.find((r) => r.afterDelete);
          expect(deleteOverview).toBeDefined();
          await resolveRead(deleteFiles);
          await resolveRead(deleteState);
          await resolveRead(moveState);
          await resolveRead(deleteOverview);
        } else if (order === "move-overview-rejects-then-queued-overview") {
          await resolveRead(moveOverview, "reject");
          const deleteOverview = h.overviewReads.find((r) => r.afterDelete);
          expect(deleteOverview).toBeDefined();
          await resolveRead(deleteOverview);
          await resolveRead(deleteState);
          await resolveRead(moveState);
          await resolveRead(deleteFiles);
        }

        await settleAllRemaining(h);

        // Assert: zero pending reads left queued, and post-delete reads occurred for overview, state, first page.
        expect(h.pendingCounts()).toEqual({ overview: 0, state: 0, files: 0 });
        expect(h.overviewReads.filter((r) => r.afterDelete).length).toBeGreaterThanOrEqual(1);
        expect(h.stateReads.filter((r) => r.afterDelete).length).toBeGreaterThanOrEqual(1);
        expect(h.filesReads.filter((r) => r.afterDelete && r.cursor === null).length).toBeGreaterThanOrEqual(1);

        // Deleted file must NOT be in the 미분류 scope list.
        expect(dom.query(`[data-asset-hub-card="a:${u4.id}"]`)).toBeNull();
        expect(dom.query(`[data-asset-hub-card="a:${u3.id}"]`)).not.toBeNull();

        // Check overview tab badge matches server truth (remaining unfiled: u3, u6 -> 2).
        expect(dom.query('[data-asset-hub-tab="unfiled"]')?.textContent).toContain("2");

        // Switch to 모든 파일 ("all") tab: deleted file must NOT be in BrandAssetHub's studio state either!
        await dom.click('[data-asset-hub-tab="all"]');
        expect(dom.query(`[data-asset-hub-card="a:${u4.id}"]`)).toBeNull();
        expect(dom.query(`[data-asset-hub-card="a:${u3.id}"]`)).not.toBeNull();
      } finally {
        await dom.unmount();
      }
    },
  );

  it.each<"files-m-before-d" | "files-d-before-m" | "delete-arrives-with-all-3-pending">([
    "files-m-before-d",
    "files-d-before-m",
    "delete-arrives-with-all-3-pending",
  ])(
    "all-3-pending race (%s): delete signal arrives while move's overview, state AND first page are ALL pending",
    async (order) => {
      const ko = getDictionary("ko");
      const assets = [unfiledAsset(1), unfiledAsset(2), unfiledAsset(3), unfiledAsset(4)];
      const h = createManualSpineHarnessApi(assets);
      const mutRef: { trigger: ((kind: SpineMutationKind) => void) | null } = { trigger: null };

      // Drive real AssetHubSpine + ScopeView directly to trigger a mutationSignal while all 3 move reads are pending.
      const { useState } = await import("react");
      function All3PendingHarness() {
        const [signal, setSignal] = useState<{ seq: number; kind: SpineMutationKind } | null>(null);
        const [notice, setNotice] = useState<string | null>(null);
        const [allView, setAllView] = useState<HubSection>("all");
        const [, setStateTick] = useState(0);
        mutRef.trigger = (kind) => setSignal((cur) => ({ seq: (cur?.seq ?? 0) + 1, kind }));
        return (
          <AssetHubSpine
            organizationId={ORG}
            locale="ko"
            studioCopy={ko.brandStudio}
            libraryCopy={ko.studioLibrary}
            state={h.initialState}
            loadFailed={false}
            notice={notice}
            onRetryLoad={() => {}}
            onNotice={setNotice}
            deliverables={[]}
            canOpenStudio={true}
            api={h.api}
            likedKeys={new Set()}
            spine={{
              overview: h.initialOverview,
              canMove: true,
              copy: ko.projectSpine,
              filmMeta: ko.studioVideo.workspace.projects.meta,
            }}
            allView={allView}
            availableSections={["all", "uploads"]}
            onAllViewChange={setAllView}
            mutationSignal={signal}
            onReloadStudioState={() => {
              void h.api.loadState().then(() => setStateTick((n) => n + 1));
            }}
            renderAllSection={() => null}
            renderScopeTile={(entry, _scopeKey, selectOpts) => (
              <HubTile
                key={entry.key}
                entry={entry}
                copy={ko.studioLibrary}
                editedMark={ko.brandStudio.gallery.editedMark}
                name={entry.label ?? ko.studioLibrary.item[entry.kind]}
                liked={false}
                selecting={selectOpts?.selecting}
                selected={selectOpts?.selected}
                onToggleSelect={selectOpts?.onToggleSelect}
                main={null}
                more={[]}
                moreLabel="more"
                menuOpen={false}
                onMenu={() => {}}
                onOpen={() => {}}
                onLike={() => {}}
                onAction={() => {}}
              />
            )}
            initialTab="unfiled"
          />
        );
      }

      const dom = await mountWithSelectSupport(<All3PendingHarness />);
      try {
        // Resolve initial page 1 of unfiled.
        expect(h.filesReads).toHaveLength(1);
        await resolveRead(h.filesReads[0]);

        // Bulk move u1 via MoveToProjectDialog.
        await dom.click("[data-asset-hub-select]");
        await dom.click(`[data-asset-hub-card="a:${assets[0]!.id}"] [data-asset-hub-open]`);
        await dom.click("[data-asset-hub-move]");
        const radio = dom.query(`[data-project-move-option="${P1}"] input`);
        if (!radio) throw new Error("Expected P1 radio input");
        radio.checked = true;
        await dom.click(radio);
        await dom.submit("[data-project-move-dialog] form");

        // All 3 move reads are now pending simultaneously!
        expect(h.pendingCounts()).toEqual({ overview: 1, state: 1, files: 1 });
        const moveOverview = h.overviewReads[0]!;
        const moveState = h.stateReads[0]!;
        const moveFiles = h.filesReads[1]!;

        // Simulate server delete of u2 + delete trigger arriving while ALL 3 move reads are still pending!
        await act(async () => {
          await h.api.call("asset.delete", { organizationId: ORG, assetId: assets[1]!.id });
          mutRef.trigger?.("delete");
          await Promise.resolve();
          await Promise.resolve();
        });

        if (order === "files-d-before-m") {
          const deleteFiles = h.filesReads.find((r) => r.afterDelete)!;
          await resolveRead(deleteFiles);
          await resolveRead(moveFiles);
        } else if (order === "files-m-before-d") {
          await resolveRead(moveFiles);
          const deleteFiles = h.filesReads.find((r) => r.afterDelete)!;
          await resolveRead(deleteFiles);
        } else {
          // delete-arrives-with-all-3-pending: resolve move's overview last, stale files last!
          await resolveRead(moveState);
          await resolveRead(moveOverview);
          await resolveRead(moveFiles);
        }

        await settleAllRemaining(h);

        expect(h.pendingCounts()).toEqual({ overview: 0, state: 0, files: 0 });
        expect(h.overviewReads.filter((r) => r.afterDelete).length).toBeGreaterThanOrEqual(1);
        expect(h.filesReads.filter((r) => r.afterDelete && r.cursor === null).length).toBeGreaterThanOrEqual(1);
        expect(dom.query(`[data-asset-hub-card="a:${assets[1]!.id}"]`)).toBeNull();
        expect(dom.query(`[data-asset-hub-card="a:${assets[2]!.id}"]`)).not.toBeNull();
        expect(dom.query('[data-asset-hub-tab="unfiled"]')?.textContent).toContain("2");
      } finally {
        await dom.unmount();
      }
    },
  );

  it("completed upload triggers 1 overview read, 1 studio-state read total (from useStudio.upload, no double state reload), and 1 first-page restart (Fix 5-2)", async () => {
    const ko = getDictionary("ko");
    const assets = [unfiledAsset(1), unfiledAsset(2)];
    const h = createManualSpineHarnessApi(assets);
    const dom = await mountWithSelectSupport(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={h.initialState}
        injectedLibrary={stubLibrary()}
        api={h.api}
        spine={{
          overview: h.initialOverview,
          canMove: true,
          copy: ko.projectSpine,
          filmMeta: ko.studioVideo.workspace.projects.meta,
        }}
        initialSpine={{ tab: "unfiled" }}
      />,
    );

    try {
      expect(h.filesReads).toHaveLength(1);
      await resolveRead(h.filesReads[0]);
      expect(h.overviewReads).toHaveLength(0);
      expect(h.stateReads).toHaveLength(0);

      const input = dom.query('input[type="file"]');
      if (!input) throw new Error("Expected file input");
      const file = new File([new Uint8Array(32)], "new-shot.png", { type: "image/png" });
      (input as unknown as { files: File[] }).files = [file];
      await dom.setValue(input, "C:\\fakepath\\new-shot.png");

      expect(h.overviewReads).toHaveLength(1);
      expect(h.stateReads).toHaveLength(1);
      expect(h.filesReads).toHaveLength(2);
      await settleAllRemaining(h);
      expect(h.pendingCounts()).toEqual({ overview: 0, state: 0, files: 0 });
    } finally {
      await dom.unmount();
    }
  });
});
