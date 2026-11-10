import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { STUDIO_ASSET_ROLES, STUDIO_LIMITS, StudioReferenceSchema } from "@/lib/brand-studio/contracts";
import { Tray } from "@/components/brand-studio/tray";
import { buildJob, initialDraft, withMedium } from "@/components/brand-studio/dock-model";
import { problemLine } from "@/components/brand-studio/use-dock";
import {
  REF_DRAG_TYPE,
  acceptsDrag,
  addToTray,
  decodeRefDrag,
  encodeRefDrag,
  toReferences,
  trayFromReferences,
  trayItemFromAsset,
  trayItemFromOutput,
  trayLabels,
  withStartFrame,
} from "@/components/brand-studio/refs";
import { ORG, asset, copyFor, output } from "./fixtures";

/** docs/BRAND-STUDIO-V2.md §5.2 — the reference tray. */
const pic = (n: number) => trayItemFromAsset(asset(n));
const film = (n: number) => trayItemFromAsset(asset(n, { kind: "video", thumbUrl: null }));
const sound = (n: number) => trayItemFromAsset(asset(n, { kind: "audio", thumbUrl: null }));

describe("tray numbering", () => {
  it.each([
    ["ko", ["이미지 1", "영상 1", "이미지 2", "오디오 1"]],
    ["en", ["Image 1", "Video 1", "Image 2", "Audio 1"]],
  ] as const)("numbers each kind in tray order (%s)", (locale, expected) => {
    expect(trayLabels([pic(1), film(2), pic(3), sound(4)], copyFor(locale))).toEqual(expected);
  });

  it("adds a source once, stops at the run limit and can put a start frame first", () => {
    let items = addToTray([], pic(1)).items;
    expect(addToTray(items, pic(1)).items).toHaveLength(1);
    for (let n = 2; n <= STUDIO_LIMITS.referencesMax; n++) items = addToTray(items, pic(n)).items;
    expect(addToTray(items, pic(99))).toMatchObject({ full: true });
    const result = trayItemFromOutput(output(1), "Result");
    const framed = withStartFrame([{ ...pic(1), frame: "start" }, pic(2)], result);
    expect(framed[0]).toMatchObject({ key: result.key, frame: "start" });
    expect(framed.filter((i) => i.frame === "start")).toHaveLength(1);
  });
});

describe("chip popover", () => {
  const render = (medium: "image" | "video", locale: "ko" | "en" = "ko") => {
    const items = [pic(1), film(2)];
    const copy = copyFor(locale);
    return renderToStaticMarkup(
      <Tray items={items} labels={trayLabels(items, copy)} medium={medium} copy={copy} dropActive={false} uploading={[]} initialOpen={items[0]!.key}
        onUpdate={() => {}} onRemove={() => {}} onBrowse={() => {}} />,
    );
  };

  it("opens as a labelled dialog with role, take and leave-out fields and a remove action", () => {
    const copy = copyFor("ko");
    const html = render("image");
    expect(html).toContain(`role="dialog" aria-label="이미지 1 설정"`);
    expect(html).toContain('aria-expanded="true"');
    for (const role of STUDIO_ASSET_ROLES) expect(html).toContain(`>${copy.roles[role]}</option>`);
    expect(html).toContain(copy.tray.use);
    expect(html).toContain(copy.tray.avoid);
    expect(html).toContain(copy.tray.remove);
    expect(html).not.toContain("data-studio-frame");
  });

  it("asks a picture in a video run whether it opens or closes the shot", () => {
    const copy = copyFor("en");
    const html = render("video", "en");
    expect(html).toContain("data-studio-frame");
    expect(html).toContain(copy.tray.frameStart);
    expect(html).toContain(copy.tray.frameEnd);
  });

  it("shows the drop target state", () => {
    const copy = copyFor("ko");
    const html = renderToStaticMarkup(<Tray items={[]} labels={[]} medium="image" copy={copy} dropActive uploading={[]} onUpdate={() => {}} onRemove={() => {}} onBrowse={() => {}} />);
    expect(html).toContain("data-drop-target");
    expect(html).toContain(copy.tray.drop);
  });
});

describe("references and mentions", () => {
  it("sends notes and roles in the contract shape, a frame only for pictures in a video run", () => {
    const items = [{ ...pic(1), role: "product" as const, use: " 병 모양 ", avoid: "", frame: "start" as const }, film(2)];
    const asImage = toReferences(items, "image");
    const asVideo = toReferences(items, "video");
    expect(asImage[0]).toEqual({ assetId: asset(1).id, role: "product", use: "병 모양" });
    expect(asVideo[0]).toMatchObject({ frame: "start" });
    expect(asVideo[1]).toEqual({ assetId: asset(2).id });
    for (const ref of [...asImage, ...asVideo]) expect(StudioReferenceSchema.safeParse(ref).success).toBe(true);
  });

  it("blocks a prompt that names a reference the tray does not have, in the customer's words", () => {
    const ids = { organizationId: ORG, requestId: "press-0001" };
    const missing = buildJob({ ...initialDraft(), prompt: "이미지 2의 병을 대리석 위에" }, [pic(1)], ids);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.problem.kind).toBe("missing");
      expect(problemLine(missing.problem, copyFor("ko"))).toContain("이미지 2");
    }
    const english = buildJob({ ...withMedium(initialDraft(), "video"), prompt: "follow video 1 closely" }, [pic(1)], ids);
    expect(!english.ok && problemLine(english.problem, copyFor("en"))).toContain("Video 1");
    expect(buildJob({ ...initialDraft(), prompt: "이미지 1의 병, 2장" }, [pic(1)], ids).ok).toBe(true);
  });

  it("rebuilds a tray from a run's references and skips what was deleted", () => {
    const kept = asset(1);
    const items = trayFromReferences(
      [{ assetId: kept.id, role: "logo" }, { assetId: asset(9).id }, { outputId: output(1).id, frame: "end" }],
      { asset: (id) => (id === kept.id ? kept : null), output: (id) => (id === output(1).id ? output(1) : null) },
      "Result",
    );
    expect(items.map((i) => i.key)).toEqual([`a:${kept.id}`, `o:${output(1).id}`]);
    expect(items[0]!.role).toBe("logo");
    expect(items[1]!.frame).toBe("end");
  });
});

describe("typed drag payload", () => {
  it("round-trips a studio reference and rejects anything else", () => {
    expect(REF_DRAG_TYPE).toBe("application/x-twings-studio-ref");
    const source = { assetId: asset(1).id };
    expect(decodeRefDrag(encodeRefDrag(source))).toEqual(source);
    expect(decodeRefDrag(encodeRefDrag({ outputId: output(1).id }))).toEqual({ outputId: output(1).id });
    for (const bad of [null, "", "nope", '{"assetId":"x"}', JSON.stringify({ assetId: asset(1).id, outputId: output(1).id })]) expect(decodeRefDrag(bad)).toBeNull();
    expect(acceptsDrag([REF_DRAG_TYPE])).toBe(true);
    expect(acceptsDrag(["Files"])).toBe(true);
    expect(acceptsDrag(["text/plain"])).toBe(false);
  });
});
