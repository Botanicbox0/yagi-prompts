import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioAssetView } from "@/lib/brand-studio/contracts";
import { findMissingReferences } from "@/lib/brand-studio/enhancer/mentions";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { trayItemFromAsset } from "@/components/brand-studio/refs";
import { VideoStudioWorkspace } from "@/components/brand-studio/video/workspace";
import { asset, studioState } from "../ui/fixtures";
import {
  FULL_CROP,
  buildVideoEditJob,
  checkVideoEditClip,
  clampCropRect,
  clampTrimRange,
  defaultVideoEditDraft,
  detectAtMentionQuery,
  insertAssetMention,
  isFullFrameAndRange,
  videoEditCredits,
} from "@/components/brand-studio/video/workspace-model";

const ORG = "a0000000-0000-4000-8000-00000000000c";

function videoAsset(over: Partial<StudioAssetView> = {}): StudioAssetView {
  return asset(1, {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "video",
    name: "source-clip.mp4",
    width: 1080,
    height: 1920,
    seconds: 8,
    url: "/api/brand-studio/media/st/source.mp4",
    thumbUrl: "/api/brand-studio/media/st/source.webp",
    ...over,
  });
}

function imageAsset(id: string, name = "bottle.png"): StudioAssetView {
  return asset(2, {
    id,
    kind: "image",
    name,
    width: 1024,
    height: 1024,
    seconds: null,
    url: `/api/brand-studio/media/st/${id}.png`,
    thumbUrl: `/api/brand-studio/media/st/${id}.webp`,
  });
}

describe("@ asset mentions in video prompts", () => {
  it("detects active @query tokens before the cursor and closes after whitespace", () => {
    expect(detectAtMentionQuery("@", 1)).toEqual({ active: true, query: "", atIndex: 0 });
    expect(detectAtMentionQuery("테이블 위 @병", 8)).toEqual({ active: true, query: "병", atIndex: 6 });
    expect(detectAtMentionQuery("테이블 위 @이미지 1 ", 13).active).toBe(false);
    expect(detectAtMentionQuery("email@domain.com", 16).active).toBe(false);
  });

  it("inserts numbered @이미지 / @영상 tags compatible with findMissingReferences", () => {
    const first = insertAssetMention("테이블 위의 병을 @보", 12, "@이미지 1");
    expect(first.text).toBe("테이블 위의 병을 @이미지 1 ");
    expect(findMissingReferences(first.text, ["video", "image"])).toEqual([]);
    expect(findMissingReferences(first.text, ["video"])).toEqual([{ kind: "image", number: 1 }]);

    const en = insertAssetMention("Swap bottle with @", 18, "@image 2");
    expect(en.text).toBe("Swap bottle with @image 2 ");
    expect(findMissingReferences(en.text, ["video", "image", "image"])).toEqual([]);
  });
});

describe("trim & crop range math", () => {
  it("clamps segment range to [4s, 30s] and bounds crop box within the frame", () => {
    expect(clampTrimRange(1, 2, 18, 4, 30)).toEqual({ start: 1, end: 5, duration: 4 });
    expect(clampTrimRange(5, 45, 50, 4, 30)).toEqual({ start: 5, end: 35, duration: 30 });
    expect(clampCropRect({ x: 0.85, y: -0.2, w: 0.4, h: 0.1 })).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.2 });
    expect(isFullFrameAndRange({ start: 0, end: 12 }, 12, FULL_CROP, 30)).toBe(true);
    expect(isFullFrameAndRange({ start: 0, end: 30 }, 42, FULL_CROP, 30)).toBe(false);
    expect(isFullFrameAndRange({ start: 0, end: 12 }, 12, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 30)).toBe(false);
  });
});

describe("Seedance-based Video Edit job builder & credits", () => {
  it("validates 4–30s clip duration, dimensions, prompt, and up to 9 reference images", () => {
    expect(checkVideoEditClip(null)).toEqual({ kind: "need_video" });
    expect(checkVideoEditClip(videoAsset({ seconds: 2.5 }))).toEqual({ kind: "too_short", min: 4 });
    expect(checkVideoEditClip(videoAsset({ seconds: 34 }))).toEqual({ kind: "too_long", max: 30 });
    expect(checkVideoEditClip(videoAsset({ width: 200, height: 200 }))).toEqual({ kind: "bad_dimensions", reason: "small" });
    expect(checkVideoEditClip(videoAsset({ seconds: 8 }))).toBeNull();

    const clip = videoAsset({ seconds: 8 });
    const img1 = trayItemFromAsset(imageAsset("22222222-2222-4222-8222-222222222221"));
    const img2 = trayItemFromAsset(imageAsset("22222222-2222-4222-8222-222222222222"));

    const built = buildVideoEditJob({
      video: clip,
      images: [img1, img2],
      draft: {
        ...defaultVideoEditDraft(),
        prompt: "@영상 1 의 병을 @이미지 1 로 바꾸고 배경 조명은 @이미지 2 톤으로 맞춰줘",
        resolution: "720p",
        audio: "ambient",
      },
      ids: { organizationId: ORG, requestId: "req-edit-1" },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    expect(built.input).toMatchObject({
      kind: "video_remix",
      organizationId: ORG,
      model: "seedance-2.5",
      method: "edit",
      resolution: "720p",
      audio: "ambient",
      keep: [],
      references: [
        { assetId: clip.id },
        { assetId: "22222222-2222-4222-8222-222222222221" },
        { assetId: "22222222-2222-4222-8222-222222222222" },
      ],
    });

    // Missing image 3 in tray is caught before hitting the server
    const missing = buildVideoEditJob({
      video: clip,
      images: [img1],
      draft: { ...defaultVideoEditDraft(), prompt: "병을 @이미지 3 으로 교체" },
      ids: { organizationId: ORG, requestId: "req-edit-2" },
    });
    expect(missing).toEqual({ ok: false, problem: { kind: "missing_mentions", mentions: [{ kind: "image", number: 3 }] } });

    // > 9 reference images rejected
    const tenImages = Array.from({ length: 10 }, (_, i) =>
      trayItemFromAsset(imageAsset(`33333333-3333-4333-8333-3333333333${String(i).padStart(2, "0")}`)),
    );
    expect(
      buildVideoEditJob({
        video: clip,
        images: tenImages,
        draft: { ...defaultVideoEditDraft(), prompt: "배경 조명 변경" },
        ids: { organizationId: ORG, requestId: "req-edit-3" },
      }),
    ).toEqual({ ok: false, problem: { kind: "too_many_images", max: 9 } });

    // Credits scale with resolution (480p < 720p < 1080p)
    const c480 = videoEditCredits(clip, "480p");
    const c720 = videoEditCredits(clip, "720p");
    const c1080 = videoEditCredits(clip, "1080p");
    expect(c480).toBeGreaterThan(0);
    expect(c720).toBeGreaterThan(c480);
    expect(c1080).toBeGreaterThan(c720);
  });
});

describe("VideoStudioWorkspace rendering", () => {
  it("renders create, blueprint, and edit panels with loaded StudioState and credit quotes", () => {
    const dict = getDictionary("ko");
    const initial = studioState({
      canCreate: true,
      assets: [videoAsset(), imageAsset("44444444-4444-4444-8444-444444444444")],
    });
    const createHtml = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        locale="ko"
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={dict.studioVideo}
        initialState={initial}
      />,
    );
    expect(createHtml).toContain("Seedance 2.5");
    expect(createHtml).toContain("data-studio-quote");
    expect(createHtml).toContain("크레딧");
    expect(createHtml).not.toMatch(/₩|\d원\b/);

    const editHtml = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        locale="ko"
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={dict.studioVideo}
        initialTab="edit"
        initialState={initial}
      />,
    );
    expect(editHtml).toContain("data-video-edit-panel");
    expect(editHtml).toContain("data-video-edit-submit");
  });
});
