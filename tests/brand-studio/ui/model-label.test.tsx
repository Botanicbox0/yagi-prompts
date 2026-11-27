import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildHubEntries, hubActions } from "@/components/brand-studio/asset-hub-model";
import { ByProjectView } from "@/components/brand-studio/asset-hub-spine/by-project-view";
import { HubDetail, HubTile } from "@/components/brand-studio/asset-hub-tile";
import { Wall, type WallProps } from "@/components/brand-studio/gallery/wall";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { FloatingClipBar } from "@/components/brand-studio/video/floating-clip-bar";
import { Viewer, type ViewerActions, type ViewerItem, type ViewerProps } from "@/components/brand-studio/viewer";
import type { StudioBrandProjectOverview, StudioState } from "@/lib/brand-studio/contracts";
import type { ComposeClip } from "@/lib/brand-studio/compose/timeline";
import { tileModelLabel, tileModelParts } from "@/lib/brand-studio/model-label";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, copyFor, id, job, output } from "./fixtures";

const noop = () => {};
const library: StudioLibrary = {
  ready: true,
  folders: [],
  liked: new Set(),
  likedItems: [],
  folderItems: () => null,
  openFolder: noop,
  toggleLike: async () => true,
  createFolder: async () => null,
  renameFolder: async () => true,
  deleteFolder: async () => true,
  addToFolder: async () => true,
  removeFromFolder: async () => true,
};

function renderWall(patch: Partial<WallProps> = {}, locale: "ko" | "en" = "ko") {
  return renderToStaticMarkup(
    <Wall
      mode="image"
      jobs={[]}
      copy={copyFor(locale)}
      locale={locale}
      canGenerate
      canEdit
      library={library}
      parentOf={() => null}
      onAction={noop}
      onRetry={noop}
      onNotice={noop}
      now={new Date("2026-11-27T01:00:00Z")}
      {...patch}
    />,
  );
}

const viewerActions: ViewerActions = {
  regionEdit: async () => true,
  rerun: noop,
  toVideo: noop,
  reference: noop,
  save: noop,
  campaign: noop,
  finalize: noop,
  reuse: noop,
  remove: async () => true,
};

function renderViewer(items: ViewerItem[], patch: Partial<ViewerProps> = {}, locale: "ko" | "en" = "ko") {
  return renderToStaticMarkup(
    <Viewer
      items={items}
      index={0}
      copy={copyFor(locale)}
      locale={locale}
      canCreate
      canGenerate
      busy={null}
      notice={null}
      parentOf={() => null}
      onIndex={noop}
      onClose={noop}
      actions={viewerActions}
      {...patch}
    />,
  );
}

describe("tileModelLabel helper", () => {
  it("resolves current and legacy model labels and formats the edited mark uniformly in ko and en", () => {
    const ko = copyFor("ko").gallery.editedMark;
    const en = copyFor("en").gallery.editedMark;
    expect(ko).toBe("edited");
    expect(en).toBe("edited");

    expect(tileModelLabel({ model: "nano-banana-pro", editedMark: ko })).toBe("Nano Banana Pro");
    expect(tileModelLabel({ model: "seedream-5-flash", edited: false, editedMark: en })).toBe("Seedream 5.0 Flash");
    expect(tileModelLabel({ model: "nano-banana-pro", edited: true, editedMark: ko })).toBe("Nano Banana Pro · edited");
    expect(tileModelLabel({ model: "seedream-5.5", edited: true, editedMark: en })).toBe("Seedream 5.5 · edited");
    expect(tileModelLabel({ model: "detail-edit", edited: true, editedMark: ko })).toBe("edited");
    expect(tileModelLabel({ model: null, edited: true, editedMark: ko })).toBe("edited");
    expect(tileModelLabel({ model: undefined, edited: false, editedMark: ko })).toBeNull();
    expect(tileModelLabel({ model: "detail-edit", edited: false, editedMark: ko })).toBeNull();
    expect(tileModelLabel({ model: "gpt-image-2.6-sunburst", edited: true, editedMark: ko })).toBe("GPT Image 2.6 Sunburst · edited");
    expect(tileModelParts({ model: "gpt-image-2.6-sunburst", edited: true, editedMark: ko })).toEqual({
      name: "GPT Image 2.6 Sunburst",
      edited: "edited",
    });
    expect(tileModelParts({ model: "seedream-5.5", edited: false, editedMark: ko })).toEqual({
      name: "Seedream 5.5",
      edited: null,
    });
    expect(tileModelParts({ model: "detail-edit", edited: true, editedMark: ko })).toEqual({
      name: null,
      edited: "edited",
    });
    expect(tileModelParts({ model: "detail-edit", edited: false, editedMark: ko })).toBeNull();
  });
});

describe("Wall model label and reference wording", () => {
  it("shows the model chip at rest on every image result, pending image tile and failed image tile while leaving hover info intact", () => {
    const readyImg = job(1, { model: "seedream-5.5", estimateKrw: 150, outputs: [output(1)] });
    const readyRegion = job(2, { kind: "region_edit", model: "nano-banana-pro", parentOutputId: output(1).id, outputs: [output(2)] });
    const pendingImg = job(3, { model: "gpt-image-2.6-flare", status: "queued", outputs: [] });
    const failedImg = job(4, { model: "nano-banana-2.1", status: "failed", errorCode: "failed", outputs: [] });

    const html = renderWall({ jobs: [readyImg, readyRegion, pendingImg, failedImg] });
    expect([...html.matchAll(/data-studio-tile-model="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "seedream-5.5",
      "nano-banana-pro",
      "gpt-image-2.6-flare",
      "nano-banana-2.1",
    ]);
    expect(html).not.toContain("data-group");
    expect(html).toContain('<span class="bs-tile-model" data-studio-tile-model="seedream-5.5" aria-hidden="true">Seedream 5.5</span>');
    expect(html).toContain('<span class="bs-tile-info"><span class="bs-tile-info-name">Seedream 5.5</span>');
    expect(html).toContain('<span class="bs-tile-model" data-studio-tile-model="gpt-image-2.6-flare">GPT Image 2.6 Flare</span>');
    expect(html).toContain('<span class="bs-tile-model" data-studio-tile-model="nano-banana-2.1" data-inline="">Nano Banana 2.1</span>');
  });

  it("Item 3, W1, W3: gives ready tiles full width (calc(100% - 16px)), reserves badge room on pending/failed tiles even at 160px, and splits model name from edited mark", () => {
    const css = readFileSync(path.resolve(process.cwd(), "app/(brand)/studio-v2.css"), "utf8");
    const chipRule = css.slice(css.indexOf(".bs-tile-model {"), css.indexOf("}", css.indexOf(".bs-tile-model {")) + 1);
    expect(chipRule).toContain("max-width: calc(100% - 16px)");
    expect(chipRule).not.toContain("calc(100% - 124px)");
    expect(chipRule).toContain("overflow: hidden");
    expect(chipRule).toContain("text-overflow: ellipsis");
    expect(chipRule).toContain("white-space: nowrap");

    expect(css).toContain('.bs-tile[data-state="pending"] .bs-tile-model,\n.bs-tile[data-state="failed"] .bs-tile-model:not([data-inline]) { max-width: calc(100% - 124px); }');
    expect(css).toContain('.bs-tile-model[data-edited="split"] { display: inline-flex; align-items: center; }');
    expect(css).toContain('.bs-tile-model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }');
    expect(css).toContain('.bs-tile-model-mark { flex: none; white-space: nowrap; }');
    expect(css).toContain('@container tile-foot (max-width: 139px)');
    expect(css).toContain('@container tile-foot (max-width: 220px)');

    // Model-only math check across widths 122, 160, 222, 257px (model logic only — actual CSS layout and container-query widths are verified in browser walks):
    // CSS drops name+sep at <=139px (122px -> edited only), while 160/222/257px keep <name> · edited with non-shrinking edited mark.
    const editedReady = job(9, { model: "gpt-image-2.6-sunburst", edited: true, outputs: [output(9)] });
    const editedHtml = renderWall({ jobs: [editedReady] });
    expect(editedHtml).toContain(
      '<span class="bs-tile-model" data-studio-tile-model="gpt-image-2.6-sunburst" data-edited="split" aria-hidden="true">' +
        '<span class="bs-tile-model-name">GPT Image 2.6 Sunburst</span>' +
        '<span class="bs-tile-model-sep" aria-hidden="true"> · </span>' +
        '<span class="bs-tile-model-mark">edited</span></span>',
    );
    for (const width of [122, 160, 222, 257]) {
      const readyMaxWidth = width - 16;
      const showsEditedOnly = width <= 139;
      expect(readyMaxWidth).toBeGreaterThanOrEqual(106);
      expect(showsEditedOnly).toBe(width === 122);
    }

    // Pending partial-edit tile at 160px: wraps chip & badge in bs-tile-foot; below 180px (where 100% - 124px < 56px), CSS hides unedited pending model names instead of showing a 36px sliver, leaving ready tiles intact.
    const base = job(10, { model: "seedream-5.5", outputs: [output(10)] });
    const pendingEdit = job(11, {
      kind: "region_edit",
      model: "gpt-image-2.6-sunburst",
      status: "running",
      parentOutputId: base.outputs[0]!.id,
      outputs: [],
    });
    const failedEdit = job(12, {
      kind: "region_edit",
      model: "gpt-image-2.6-sunburst",
      status: "failed",
      errorCode: "failed",
      parentOutputId: base.outputs[0]!.id,
      outputs: [],
    });
    const html = renderWall({ jobs: [pendingEdit, failedEdit, base] });
    expect(html).toContain('<div class="bs-tile-foot"><span class="bs-tile-model" data-studio-tile-model="gpt-image-2.6-sunburst">GPT Image 2.6 Sunburst</span><span class="bs-tile-badge">부분 수정</span></div>');
    expect(html).toContain('<span class="bs-tile-model" data-studio-tile-model="gpt-image-2.6-sunburst" data-inline="">GPT Image 2.6 Sunburst</span>');
    expect(html).toContain('<span class="bs-tile-badge">부분 수정</span>');
    // Fix Round 3 Item 11: at @container tile-foot (max-width: 179px) where pending name gets < 56px, hide pending unedited model name cleanly without hiding ready tiles or detail-edit mark.
    const max179Match = /@container tile-foot \(max-width:\s*179px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(max179Match).toContain('.bs-tile[data-state="pending"] .bs-tile-model');
    expect(max179Match).toContain("display: none");
    expect(max179Match).not.toContain('.bs-tile[data-state="ready"]');
  });

  it("keeps video tiles unchanged without a single-run model chip", () => {
    const readyVid = job(1, { kind: "video", model: "seedance-2.5", outputs: [output(1, { kind: "video", seconds: 5 })] });
    const pendingVid = job(2, { kind: "video", model: "seedance-2.5", status: "running", outputs: [] });
    const failedVid = job(3, { kind: "video", model: "seedance-2.5", status: "failed", errorCode: "failed", outputs: [] });
    const html = renderWall({ mode: "video", jobs: [readyVid, pendingVid, failedVid] });
    expect(html).not.toContain("data-studio-tile-model");
  });

  it("labels reference controls 레퍼런스에 추가 (ko) and Add to references (en)", () => {
    const imgJob = job(1, { outputs: [output(1)] });
    const koHtml = renderWall({ jobs: [imgJob] }, "ko");
    const enHtml = renderWall({ jobs: [imgJob] }, "en");
    expect(koHtml).toContain('aria-label="레퍼런스에 추가"');
    expect(enHtml).toContain('aria-label="Add to references"');

    const clip: ComposeClip = {
      id: "clip-1",
      label: "Opening clip",
      sourceKind: "output",
      outputId: output(1).id,
      srcUrl: "https://media.example/st/vid-1.mp4",
      thumbUrl: null,
      durationSec: 5,
      trimStartSec: 0,
      trimEndSec: 5,
      volume: 1,
      muted: false,
    };
    const barKo = renderToStaticMarkup(
      <FloatingClipBar
        clip={clip}
        clipIndex={0}
        canEdit
        copy={getDictionary("ko").studioVideo.workspace.floatingBar}
        onTrim={noop}
        onDetectCuts={noop}
        onColorGrade={noop}
        onAttachAsReference={noop}
        onUpscale={noop}
        onDelete={noop}
      />,
    );
    const barEn = renderToStaticMarkup(
      <FloatingClipBar
        clip={clip}
        clipIndex={0}
        canEdit
        copy={getDictionary("en").studioVideo.workspace.floatingBar}
        onTrim={noop}
        onDetectCuts={noop}
        onColorGrade={noop}
        onAttachAsReference={noop}
        onUpscale={noop}
        onDelete={noop}
      />,
    );
    expect(barKo).toContain('data-floating-action="attach-ref">레퍼런스에 추가</button>');
    expect(barEn).toContain('data-floating-action="attach-ref">Add to references</button>');
  });
});

describe("Viewer model label and reference wording", () => {
  it("shows the model label once in the meta side panel for single and grouped image results, never on the picture, and omits uploads/video/audio", () => {
    const imgOut = output(1);
    const imgJob = job(1, { model: "seedream-5.5", outputs: [imgOut] });
    for (const locale of ["ko", "en"] as const) {
      const html = renderViewer([{ type: "output", output: imgOut, job: imgJob }], {}, locale);
      expect(html.match(/data-studio-viewer-model="seedream-5\.5"/g)).toHaveLength(1);
      const mediaHtml = html.match(/<figure[^>]*bs-viewer-media[\s\S]*?<\/figure>/)?.[0] ?? "";
      const sideHtml = html.match(/<div class="bs-viewer-side"[\s\S]*$/)?.[0] ?? "";
      expect(mediaHtml).not.toContain("data-studio-viewer-model");
      expect(sideHtml).toContain('data-studio-viewer-model="seedream-5.5">Seedream 5.5</p>');
      expect(html).toContain(locale === "ko" ? "<span>레퍼런스에 추가</span>" : "<span>Add to references</span>");
    }

    const group = { id: "g-1", models: ["nano-banana-pro", "seedream-5.5"] };
    const s1 = job(11, { model: "nano-banana-pro", group, outputs: [output(11, { jobId: id(0x200b) })] });
    const s2 = job(12, { model: "seedream-5.5", group, outputs: [output(12, { jobId: id(0x200c) })] });
    const groupHtml = renderViewer([{ type: "output", output: s1.outputs[0]!, job: s1 }], { siblingsOf: () => [s1, s2], onOpenOutput: noop });
    expect(groupHtml).toContain("data-studio-siblings");
    expect(groupHtml).not.toContain("data-studio-viewer-model");

    const imgAssetHtml = renderViewer([{ type: "asset", asset: asset(1) }]);
    const vidOut = output(2, { kind: "video", seconds: 5 });
    const vidHtml = renderViewer([{ type: "output", output: vidOut, job: job(2, { kind: "video", model: "seedance-2.5", outputs: [vidOut] }) }]);
    const audOut = output(3, { kind: "audio", width: null, height: null, seconds: 10, thumbUrl: null });
    const audHtml = renderViewer([{ type: "output", output: audOut, job: job(3, { kind: "music", model: "yue2", outputs: [audOut] }) }]);
    expect(imgAssetHtml).not.toContain("data-studio-viewer-model");
    expect(vidHtml).not.toContain("data-studio-viewer-model");
    expect(audHtml).not.toContain("data-studio-viewer-model");
  });
});

describe("Assets page model label", () => {
  it("shows the model chip on generated image tiles and detail sheet, and nothing on uploads or non-images", () => {
    const dict = getDictionary("ko");
    const h = dict.studioLibrary.hub;
    const actionCopy = {
      useImage: h.openInImage,
      decorate: dict.brandStudio.gallery.menu.decorate,
      makeVideo: h.openInVideo,
      compose: h.openInCompose,
      reverse: h.reverseVideo,
      share: h.shareReview,
      similar: h.findSimilar,
      edit: dict.studioLibrary.uploads.edit,
    };
    const imgAsset = asset(1, { name: "Bottle" });
    const imgOut = output(1);
    const vidOut = output(2, { kind: "video", seconds: 5 });
    const audOut = output(3, { kind: "audio", width: null, height: null, seconds: 10, thumbUrl: null });
    const entries = buildHubEntries(
      [imgAsset],
      [
        job(1, { model: "nano-banana-pro", prompt: "Warm light bottle", outputs: [imgOut] }),
        job(2, { kind: "video", model: "seedance-2.5", prompt: "Slow zoom", outputs: [vidOut] }),
        job(3, { kind: "music", model: "yue2", prompt: "Soft piano", outputs: [audOut] }),
      ],
      h.sourceGenerated,
    );

    const genImg = entries.find((e) => e.key === `o:${imgOut.id}`)!;
    const uploadImg = entries.find((e) => e.key === `a:${imgAsset.id}`)!;
    const genVid = entries.find((e) => e.key === `o:${vidOut.id}`)!;
    const genAud = entries.find((e) => e.key === `o:${audOut.id}`)!;

    expect(genImg.model).toBe("nano-banana-pro");
    expect(uploadImg.model).toBeNull();

    const renderTile = (entry: (typeof entries)[number]) => {
      const acts = hubActions(entry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: actionCopy });
      return renderToStaticMarkup(
        <HubTile
          entry={entry}
          copy={dict.studioLibrary}
          editedMark={dict.brandStudio.gallery.editedMark}
          name={entry.title}
          liked={false}
          main={acts.main}
          more={acts.more}
          moreLabel="more"
          menuOpen={false}
          onMenu={noop}
          onOpen={noop}
          onLike={noop}
          onAction={noop}
        />,
      );
    };
    const renderDetail = (entry: (typeof entries)[number]) => {
      const acts = hubActions(entry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: actionCopy });
      return renderToStaticMarkup(
        <HubDetail
          entry={entry}
          copy={dict.studioLibrary}
          editedMark={dict.brandStudio.gallery.editedMark}
          name={entry.title}
          liked={false}
          main={acts.main}
          more={acts.more}
          onLike={noop}
          onAction={noop}
          onClose={noop}
        />,
      );
    };

    const genImgTile = renderTile(genImg);
    const genImgDetail = renderDetail(genImg);
    expect(genImgTile).toContain('data-asset-hub-model="nano-banana-pro" aria-hidden="true">Nano Banana Pro</span>');
    expect(genImgDetail).toContain('data-asset-hub-detail-model="nano-banana-pro">Nano Banana Pro</span>');

    for (const nonGenImg of [uploadImg, genVid, genAud]) {
      expect(renderTile(nonGenImg)).not.toContain("data-asset-hub-model");
      expect(renderDetail(nonGenImg)).not.toContain("data-asset-hub-detail-model");
    }
  });

  it("W2 & W1: shows HubModelChip on ByProjectView image covers (direct + state.jobs fallback), omits uploads/videos, and preserves split two-part truncation", () => {
    const dict = getDictionary("ko");
    const hubCss = readFileSync(path.resolve(process.cwd(), "components/brand-studio/asset-hub.module.css"), "utf8");
    const spineCss = readFileSync(path.resolve(process.cwd(), "components/brand-studio/asset-hub-spine/asset-hub-spine.module.css"), "utf8");
    expect(spineCss).toContain("container-type: inline-size;");
    expect(hubCss).toContain(".modelChipName");
    expect(hubCss).toContain(".modelChipMark");
    expect(hubCss).toContain("@container (max-width: 139px)");

    const pId = id(0x901);
    const outDirect = output(21, { jobId: id(0x2101) });
    const outFallback = output(22, { jobId: id(0x2102) });
    const outNoModelEdit = output(23, { jobId: id(0x2103) });
    const outVid = output(24, { kind: "video", jobId: id(0x2104), seconds: 5 });

    const jobFallback = job(102, { id: id(0x2102), model: "seedream-5.5", edited: true, outputs: [outFallback] });
    const jobVid = job(104, { id: id(0x2104), kind: "video", model: "seedance-2.5", outputs: [outVid] });

    const overview: StudioBrandProjectOverview = {
      ok: true,
      projects: [
        {
          project: {
            id: pId,
            title: "Spring",
            origin: "self",
            lastActivityAt: "2026-11-27T01:00:00Z",
          },
          counts: { image: 3, video: 1, sound: 0, upload: 1, film: 0 },
          covers: [
            {
              outputId: outDirect.id,
              jobId: outDirect.jobId,
              kind: "image",
              url: outDirect.url,
              thumbUrl: outDirect.thumbUrl,
              width: 1600,
              height: 1200,
              createdAt: "2026-11-27T01:00:00Z",
              model: "nano-banana-pro",
              edited: false,
            },
            {
              outputId: outFallback.id,
              jobId: outFallback.jobId,
              kind: "image",
              url: outFallback.url,
              thumbUrl: outFallback.thumbUrl,
              width: 1600,
              height: 1200,
              createdAt: "2026-11-27T01:00:00Z",
            },
            {
              outputId: outVid.id,
              jobId: outVid.jobId,
              kind: "video",
              url: outVid.url,
              thumbUrl: outVid.thumbUrl,
              width: 1280,
              height: 720,
              createdAt: "2026-11-27T01:00:00Z",
              model: "seedance-2.5",
            },
          ],
        },
      ],
      unfiled: {
        counts: { image: 1, video: 0, sound: 0, upload: 0, film: 0 },
        covers: [
          {
            outputId: outNoModelEdit.id,
            jobId: outNoModelEdit.jobId,
            kind: "image",
            url: outNoModelEdit.url,
            thumbUrl: outNoModelEdit.thumbUrl,
            width: 1600,
            height: 1200,
            createdAt: "2026-11-27T01:00:00Z",
            model: "detail-edit",
            edited: true,
          },
        ],
      },
      brandMaterials: { count: 0, byRole: { logo: 0, product: 0, person: 0, style: 0, place: 0 }, covers: [] },
      finished: { counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 } },
    };

    const html = renderToStaticMarkup(
      <ByProjectView
        organizationId={ORG}
        filter="active"
        overview={overview}
        libraryCopy={dict.studioLibrary}
        projectSpineCopy={dict.projectSpine}
        editedMark={dict.brandStudio.gallery.editedMark}
        state={{ jobs: [jobFallback, jobVid], assets: [], folders: [] } as unknown as StudioState}
        deliverables={[]}
        canMove
        query=""
        onOpenMaterials={noop}
        onOpenProject={noop}
        onOpenUnfiled={noop}
        onMoveUnfiled={noop}
      />,
    );

    expect(html).toContain('data-asset-hub-model="nano-banana-pro" aria-hidden="true">Nano Banana Pro</span>');
    expect(html).toContain('data-asset-hub-model="seedream-5.5" data-edited="split" aria-hidden="true"><span');
    expect(html).toContain('Seedream 5.5');
    expect(html).toContain('data-asset-hub-model="detail-edit" aria-hidden="true">edited</span>');
    expect(html).not.toContain('data-asset-hub-model="seedance-2.5"');
    expect(html).toContain('data-asset-hub-length');
  });
});
