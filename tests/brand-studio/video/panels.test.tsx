import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioState } from "@/lib/brand-studio/contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { initialDraft, withMedium } from "@/components/brand-studio/dock-model";
import { RemixPanel, openReversePanel, videoCopyFor } from "@/components/brand-studio/remix-panel";
import { STUDIO_OPEN_REVERSE } from "@/components/brand-studio/seams";
import { CampaignPath, sendableVideos } from "@/components/brand-studio/video/campaign-path";
import { ReversePanel } from "@/components/brand-studio/video/reverse";
import { VideoStarts } from "@/components/brand-studio/video/starts";
import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";

/** docs/BRAND-STUDIO-V3.md §6 — the bar's remix panel, the start cards, the campaign road and the drawer. */
const ko = getDictionary("ko");
const en = getDictionary("en");
const ORG = "a0000000-0000-4000-8000-00000000000d";
const draft = { ...withMedium(initialDraft(), "video"), method: "blueprint" as const };

afterEach(() => vi.unstubAllGlobals());

describe("the remix panel in the prompt bar", () => {
  it("offers the remake first, in the screen's language, and links to the full panel", () => {
    const html = renderToStaticMarkup(<RemixPanel draft={draft} film={{ status: "done", sheet: null }} copy={ko.brandStudio} disabled={false} onChange={() => undefined} />);
    expect(html.indexOf('data-studio-remix-method="blueprint"')).toBeLessThan(html.indexOf('data-studio-remix-method="reference"'));
    expect(html).toContain(studioVideoKo.remix.blueprint);
    expect(html).toContain(studioVideoKo.remix.unreadable);
    expect(html).toMatch(/disabled=""[^>]*value="blueprint"/);
    expect(html).toContain("data-studio-remix-open-panel");
    expect(videoCopyFor(en.brandStudio)).toBe(studioVideoEn);
    expect(videoCopyFor(ko.brandStudio)).toBe(studioVideoKo);
  });

  it("keeps a readable clip's remake open with its own hint", () => {
    const sheet = { seconds: 6, aspect: "9:16", shots: [], look: { lighting: "", palette: "", texture: "" }, audio: { music: false, speech: false, effects: "" }, summary: "6초" };
    const html = renderToStaticMarkup(<RemixPanel draft={draft} film={{ status: "done", sheet }} copy={ko.brandStudio} disabled={false} onChange={() => undefined} />);
    expect(html).toContain(studioVideoKo.remix.blueprintHint);
    expect(html).not.toMatch(/disabled=""[^>]*value="blueprint"/);
  });

  it("opens the drawer in place on the video screen, and goes there from anywhere else", () => {
    const dispatched: Event[] = [];
    const assign = vi.fn();
    vi.stubGlobal("CustomEvent", class extends Event { detail: unknown; constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail; } });
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => dispatched.push(e), location: { href: `https://brand.twings.app/brand/studio?organizationId=${ORG}`, assign } });
    vi.stubGlobal("document", { querySelector: () => ({}) });
    openReversePanel("asset-1");
    expect(dispatched[0]?.type).toBe(STUDIO_OPEN_REVERSE);
    expect((dispatched[0] as CustomEvent).detail).toEqual({ assetId: "asset-1" });
    vi.stubGlobal("document", { querySelector: () => null });
    openReversePanel("asset-1");
    expect(assign).toHaveBeenCalledWith(`/brand/studio/video?organizationId=${ORG}&start=reverse&asset=asset-1`);
  });
});

describe("the video screen's parts", () => {
  it("starts: three cards, the request one only when the brand may ask", () => {
    const html = renderToStaticMarkup(<VideoStarts t={studioVideoKo} requestHref="/brand/studio/video?view=request" />);
    expect(html.match(/data-studio-video-start=/g)).toHaveLength(3);
    expect(html).toContain('href="/brand/studio/video?view=request"');
    expect(renderToStaticMarkup(<VideoStarts t={studioVideoKo} requestHref={null} />).match(/data-studio-video-start=/g)).toHaveLength(2);
  });

  it("campaign road: five steps ending in the send action; sends finished videos before drafts", () => {
    const html = renderToStaticMarkup(<CampaignPath organizationId={ORG} locale="ko" copy={ko.brandStudio} video={studioVideoKo} canSend />);
    expect(html).toContain(studioVideoKo.path.action);
    for (const step of studioVideoKo.path.steps) expect(html).toContain(step.title.replace(/·/g, "·"));
    const out = (id: string, draft: boolean, createdAt: string) => ({ id, jobId: "j", kind: "video" as const, url: "/v", thumbUrl: null, width: 1, height: 1, seconds: 5, draft, savedAssetId: null, createdAt });
    const job = (outputs: ReturnType<typeof out>[], status = "succeeded") => ({ status, outputs }) as unknown as StudioState["jobs"][number];
    const videos = sendableVideos({ jobs: [job([out("d", true, "2026-11-11T03:00:00Z")]), job([out("f1", false, "2026-11-10T00:00:00Z")]), job([out("f2", false, "2026-11-11T01:00:00Z")]), job([out("x", false, "2026-11-12T00:00:00Z")], "failed")] });
    expect(videos.map((v) => v.id)).toEqual(["f2", "f1", "d"]);
  });

  it("drawer: closed by default, opened by the address, with its five steps once a clip is picked", () => {
    expect(renderToStaticMarkup(<ReversePanel organizationId={ORG} locale="ko" copy={ko.brandStudio} video={studioVideoKo} />)).not.toContain("data-studio-reverse-panel");
    const open = renderToStaticMarkup(<ReversePanel organizationId={ORG} locale="ko" copy={ko.brandStudio} video={studioVideoKo} initialOpen />);
    expect(open).toContain("data-studio-reverse-panel");
    expect(open).toContain('data-reverse-step="video"');
    expect(open).toContain('data-reverse-step="run"');
    expect(open).toContain(studioVideoKo.reverse.run.draft);
    // Nothing is chosen yet, so the start button waits.
    expect(open).toMatch(/disabled=""[^>]*data-reverse-start/);
  });
});
