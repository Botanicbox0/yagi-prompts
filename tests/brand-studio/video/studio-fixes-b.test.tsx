import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioAssetView, StudioJobView } from "@/lib/brand-studio/contracts";
import {
  buildSeedanceDirectorSystemInstruction,
  compileDirectorPrompt,
  composeDirectorFallbackPrompt,
} from "@/lib/brand-studio/director/compiler";
import { ENV, mockGemini } from "../intel/helpers";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";
import { createStudioApi } from "@/components/brand-studio/api";
import { initialDraft, withMedium } from "@/components/brand-studio/dock-model";
import { RemixPanel } from "@/components/brand-studio/remix-panel";
import { ClipTrimModal } from "@/components/brand-studio/video/clip-trim-modal";
import { VideoProjectBar } from "@/components/brand-studio/video/project-bar";
import { ReversePanel, reverseNoteLines } from "@/components/brand-studio/video/reverse";
import { clipNotice, methodsFor, reverseModel } from "@/components/brand-studio/video/reverse-model";
import { VideoStudioWorkspace } from "@/components/brand-studio/video/workspace";
import { asset, job, studioState } from "../ui/fixtures";

/**
 * Video studio defect fixes (walk 2026-11-24, brief B): D10, D1, D2 (P1) and D11, D13, D16, D14, D12 (P2).
 * Ids refer to the walk's findings list.
 */
const ko = getDictionary("ko");
const ORG = "a0000000-0000-4000-8000-0000000000b2";
const PAGE = `https://brand.twings.app/brand/studio/video?organizationId=${ORG}`;

afterEach(() => vi.unstubAllGlobals());

function libraryVideo(over: Partial<StudioAssetView> = {}): StudioAssetView {
  return asset(7, {
    id: "77777777-7777-4777-8777-777777777777",
    kind: "video",
    name: "reference.mp4",
    width: 1080,
    height: 1920,
    seconds: 8,
    url: "/api/brand-studio/media/st/reference.mp4",
    thumbUrl: "/api/brand-studio/media/st/reference.webp",
    ...over,
  });
}

function workspace(over: Partial<Parameters<typeof VideoStudioWorkspace>[0]> = {}) {
  return (
    <VideoStudioWorkspace
      organizationId={ORG}
      locale="ko"
      copy={ko.brandStudio}
      libraryCopy={ko.studioLibrary}
      videoCopy={ko.studioVideo}
      initialState={studioState({ canCreate: true, assets: [libraryVideo()] })}
      {...over}
    />
  );
}

describe("D10: 참고 영상으로 만들기 (`?start=reverse`) opens the reverse panel on arrival", () => {
  it("opens it for start=reverse, with and without a clip, and keeps it closed on a plain visit", () => {
    expect(renderToStaticMarkup(workspace())).not.toContain("data-studio-reverse-panel");
    expect(renderToStaticMarkup(workspace({ initialCreateMode: "blueprint" }))).toContain("data-studio-reverse-panel");
    expect(
      renderToStaticMarkup(workspace({ initialCreateMode: "blueprint", initialAssetId: libraryVideo().id })),
    ).toContain("data-studio-reverse-panel");
    // `?tab=edit&asset=` is the edit entry, not the reverse panel.
    expect(renderToStaticMarkup(workspace({ initialTab: "edit", initialAssetId: libraryVideo().id }))).not.toContain(
      "data-studio-reverse-panel",
    );
  });
});

type Sent = { url: string; body: string };

/**
 * A fake network: the studio endpoint answers job.create with `jobAnswer` (after `jobGate`, when given), the
 * projects endpoint with a project.
 */
function fakeNetwork(jobAnswer: { status: number; body: unknown }, jobGate?: Promise<void>) {
  const sent: Sent[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    sent.push({ url, body });
    if (jobGate && body.includes('"operation":"job.create"')) await jobGate;
    if (url.startsWith("/api/brand-studio/video-projects")) {
      if (body.includes('"op":"create"')) {
        return new Response(
          JSON.stringify({
            ok: true,
            project: {
              id: "99999999-9999-4999-8999-999999999999",
              title: "새 프로젝트",
              status: "active",
              revision: 1,
              clipCount: 0,
              durationSec: 0,
              timeline: { aspect: "9:16", clips: [] },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, projects: [] }), { status: 200 });
    }
    if (url.startsWith("/api/brand-studio") && body.includes('"operation":"job.create"')) {
      return new Response(JSON.stringify(jobAnswer.body), { status: jobAnswer.status });
    }
    return new Response(JSON.stringify({ ok: true, items: [], folders: [], liked: [] }), { status: 200 });
  });
  const replaceState = vi.fn();
  vi.stubGlobal("fetch", fetchStub);
  vi.stubGlobal("location", { href: PAGE, origin: "https://brand.twings.app", pathname: "/brand/studio/video", search: `?organizationId=${ORG}` });
  vi.stubGlobal("history", { state: null, replaceState, pushState: vi.fn() });
  const created = () => sent.filter((s) => s.url.startsWith("/api/brand-studio/video-projects") && s.body.includes('"op":"create"'));
  const saved = () => sent.filter((s) => s.url.startsWith("/api/brand-studio/video-projects") && s.body.includes('"op":"save"'));
  const runs = () => sent.filter((s) => s.body.includes('"operation":"job.create"'));
  return { sent, created, saved, runs, replaceState };
}

async function mountWorkspace() {
  const { mountDom } = await import("@/tests/brands/_dom-harness");
  const api = createStudioApi({ organizationId: ORG });
  return mountDom(workspace({ api }));
}

const runningJob: StudioJobView = job(1, { kind: "video", status: "queued", model: "seedance-2.5", prompt: "향수병", outputs: [] });

describe("D1: a refused 만들기 creates no project", () => {
  it("an empty prompt (refused in the bar) sends nothing, makes no project and leaves the address alone", async () => {
    const net = fakeNetwork({ status: 201, body: { ok: true, job: runningJob } });
    const dom = await mountWorkspace();
    try {
      await dom.submit("form[data-studio-dock]");
      expect(dom.query("form[data-studio-dock]")?.textContent ?? "").toContain(ko.brandStudio.dock.emptyPrompt);
      expect(net.runs()).toHaveLength(0);
      expect(net.created()).toHaveLength(0);
      expect(net.saved()).toHaveLength(0);
      expect(net.replaceState).not.toHaveBeenCalled();
    } finally {
      await dom.unmount();
    }
  });

  it("a run the server refuses (4xx) leaves no project behind", async () => {
    const net = fakeNetwork({ status: 400, body: { ok: false, code: "invalid" } });
    const dom = await mountWorkspace();
    try {
      await dom.setValue("form[data-studio-dock] textarea", "향수병 위로 빛이 천천히 지나간다");
      await dom.submit("form[data-studio-dock]");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(net.runs()).toHaveLength(1);
      expect(net.created()).toHaveLength(0);
      expect(net.replaceState).not.toHaveBeenCalled();
    } finally {
      await dom.unmount();
    }
  });

  it("an accepted run still makes the project lazily, with the typed words as its first prompt", async () => {
    const net = fakeNetwork({ status: 201, body: { ok: true, job: runningJob } });
    const dom = await mountWorkspace();
    try {
      await dom.setValue("form[data-studio-dock] textarea", "향수병 위로 빛이 천천히 지나간다");
      await dom.submit("form[data-studio-dock]");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(net.runs()).toHaveLength(1);
      expect(net.created()).toHaveLength(1);
      expect(net.created()[0]!.body).toContain("향수병 위로 빛이 천천히 지나간다");
      // The run goes first; the project follows once the run was accepted.
      expect(net.sent.indexOf(net.runs()[0]!)).toBeLessThan(net.sent.indexOf(net.created()[0]!));
      expect(net.replaceState).toHaveBeenCalled();
    } finally {
      await dom.unmount();
    }
  });

  it("does not make a project from an earlier press after 새 프로젝트 was pressed while the run was on its way", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const net = fakeNetwork({ status: 201, body: { ok: true, job: runningJob } }, gate);
    const dom = await mountWorkspace();
    try {
      await dom.setValue("form[data-studio-dock] textarea", "향수병 위로 빛이 천천히 지나간다");
      await dom.submit("form[data-studio-dock]");
      expect(net.runs()).toHaveLength(1);
      await dom.click("[data-video-project-switcher]");
      await dom.click("[data-video-project-new]");
      await act(async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(net.created()).toHaveLength(0);
      expect(net.saved()).toHaveLength(0);
    } finally {
      await dom.unmount();
    }
  });
});

describe("D2: no @Image / @Video token without a matching reference", () => {
  const TOKEN = /@(image|video)\s?\d/i;
  const plain = (seconds: number, audio: "on" | "sfx" | "off") =>
    composeDirectorFallbackPrompt({
      kind: "video",
      profile: "seedance",
      locale: "ko",
      prompt: "향수병 위로 빛이 천천히 지나간다",
      references: [],
      video: { seconds, aspect: "9:16", audio },
    });

  it("the fallback text for a run with zero references names no reference", () => {
    for (const seconds of [4, 5, 8, 15]) {
      for (const audio of ["on", "sfx", "off"] as const) {
        const out = plain(seconds, audio).prompt;
        expect(out).not.toMatch(TOKEN);
        expect(out).toContain("zero plastic/waxy beauty-filter glare");
      }
    }
  });

  it("still binds the skin clause to the first image when one is attached", () => {
    const out = composeDirectorFallbackPrompt({
      kind: "video",
      profile: "seedance",
      locale: "ko",
      prompt: "이미지 1 병을 든다",
      references: [{ index: 1, kind: "image", label: "이미지 1", role: "product" }],
      video: { seconds: 5, aspect: "9:16", audio: "on" },
    }).prompt;
    expect(out).toContain("Natural skin texture faithful to @Image 1");
  });

  it("a model answer that names a reference the run does not have falls back (zero references only)", async () => {
    const run = (references: Parameters<typeof compileDirectorPrompt>[0]["references"], prompt = "향수병 위로 빛이 천천히 지나간다") => {
      const reasons: string[] = [];
      const fetchMock = mockGemini({
        prompt: [
          "Visual style: #181B20 shadow floor, #E6DFD5 linen, #3875C5 accent; motivated window key light. Natural skin texture faithful to @Image 1.",
          "0.0s–5.0s: 18° off-axis medium shot, light glides over the perfume bottle; slow push-in.",
        ].join("\n"),
        notes: "조명을 다듬었어요.",
      });
      return compileDirectorPrompt(
        { kind: "video", profile: "seedance", locale: "ko", prompt, references, video: { seconds: 5, aspect: "9:16", audio: "off" } },
        { fetch: fetchMock as unknown as typeof fetch, env: ENV, onFallback: (r) => reasons.push(r) },
      ).then((result) => ({ result, reasons }));
    };

    const bare = await run([]);
    expect(bare.result.source).toBe("fallback");
    expect(bare.reasons).toContain("unbound_token");
    expect(bare.result.prompt).not.toMatch(TOKEN);

    // With an image attached the same answer is the model's (the token is bound).
    const bound = await run([{ index: 1, kind: "image", label: "이미지 1", role: "product" }], "이미지 1 향수병 위로 빛이 천천히 지나간다");
    expect(bound.result.source).toBe("model");
    expect(bound.reasons).not.toContain("unbound_token");
  });

  it("the director's instruction asks for @Image 1 only when an image is attached (zero references)", () => {
    const base = { intent: "expand" as const, seconds: 5, blueprint: false, audioMode: "on" as const, explicitMusic: false };
    const none = buildSeedanceDirectorSystemInstruction({ ...base, hasImageRefs: false, hasVideoRef: false });
    expect(none).not.toContain("@Image 1");
    const withImage = buildSeedanceDirectorSystemInstruction({ ...base, hasImageRefs: true, hasVideoRef: false });
    expect(withImage).toContain("@Image 1");
  });
});

describe("D11: the reverse panel while the library is loading", () => {
  it("shows only the loading line: no 'no videos', no 'view-only', and the start button waits", () => {
    const r = studioVideoKo.reverse;
    const html = renderToStaticMarkup(
      <ReversePanel organizationId={ORG} locale="ko" copy={ko.brandStudio} video={studioVideoKo} initialOpen />,
    );
    expect(html).toContain(r.loading);
    expect(html).not.toContain(r.pick.empty);
    expect(html).not.toContain(r.run.readOnly);
    // No credits line either: nothing is known about the allowance yet (it read "남은 크레딧 0").
    expect(html).not.toContain("남은 크레딧");
    expect(html).not.toContain(r.run.finalNote);
    expect(html).toMatch(/disabled=""[^>]*data-reverse-start/);
  });
});

describe("D13: the 내 프로젝트 menu", () => {
  const copy = studioVideoKo.workspace.projects;
  const bar = (
    <VideoProjectBar
      canEdit
      projectId={null}
      projectTitle=""
      projectStatus="active"
      savingProject={false}
      projects={[]}
      clipCount={0}
      railHeight="compact"
      solidMp4Cta={false}
      exportingNle={false}
      exportingMp4Ratio={null}
      canSendClipToOtherProject={false}
      copy={copy}
      onSelectProject={() => undefined}
      onStartNewProject={() => undefined}
      onRenameTitle={() => undefined}
      onToggleComplete={() => undefined}
      onDeleteProject={() => undefined}
      onSendClipToProject={() => undefined}
      onSelectLayoutPreset={() => undefined}
      onShareReview={() => undefined}
      onExportNle={() => undefined}
      onExportMp4={() => undefined}
    />
  );

  it("closes on Escape and gives focus back to its button", async () => {
    const { mountDom } = await import("@/tests/brands/_dom-harness");
    const dom = await mountDom(bar);
    try {
      await dom.click("[data-video-project-switcher]");
      expect(Boolean(dom.query("[data-video-project-menu]"))).toBe(true);
      dom.document.body.focus();
      await dom.keyDown("Escape");
      expect(Boolean(dom.query("[data-video-project-menu]"))).toBe(false);
      expect(dom.document.activeElement === dom.query("[data-video-project-switcher]")).toBe(true);
    } finally {
      await dom.unmount();
    }
  });

  it("closes when another control in the bar is pressed", async () => {
    const { mountDom } = await import("@/tests/brands/_dom-harness");
    const dom = await mountDom(bar);
    try {
      await dom.click("[data-video-project-switcher]");
      expect(Boolean(dom.query("[data-video-project-menu]"))).toBe(true);
      const other = dom.query('[data-layout-preset="edit"]');
      await act(async () => {
        window.dispatchEvent({ type: "mousedown", target: other } as unknown as Event);
      });
      expect(Boolean(dom.query("[data-video-project-menu]"))).toBe(false);
      // A press inside the menu's own anchor keeps it open.
      await dom.click("[data-video-project-switcher]");
      await act(async () => {
        window.dispatchEvent({ type: "mousedown", target: dom.query("[data-video-project-menu]") } as unknown as Event);
      });
      expect(Boolean(dom.query("[data-video-project-menu]"))).toBe(true);
    } finally {
      await dom.unmount();
    }
  });
});

describe("D16: greyed recommended choices say why", () => {
  it("shows the existing 'unreadable' line when the clip could not be read, whatever method is on", () => {
    const draft = { ...withMedium(initialDraft(), "video"), method: "reference" as const };
    const html = renderToStaticMarkup(
      <RemixPanel draft={draft} film={{ status: "done", sheet: null }} copy={ko.brandStudio} disabled={false} onChange={() => undefined} />,
    );
    expect(html).toContain(studioVideoKo.remix.unreadable);
    expect(html).toMatch(/disabled=""[^>]*value="blueprint"/);
    // A readable clip has no such line.
    const loading = renderToStaticMarkup(
      <RemixPanel draft={draft} film={{ status: "loading" }} copy={ko.brandStudio} disabled={false} onChange={() => undefined} />,
    );
    expect(loading).not.toContain(studioVideoKo.remix.unreadable);
  });
});

describe("D14: the trim modal's accessible names follow the screen's language", () => {
  const clip = libraryVideo({ seconds: 12 });
  const modal = (locale: "ko" | "en") => {
    const t = locale === "ko" ? studioVideoKo : studioVideoEn;
    return renderToStaticMarkup(
      <ClipTrimModal
        asset={clip}
        copy={t.workspace.trimModal}
        onSkip={() => undefined}
        onApply={() => undefined}
        onUploadTrimmed={async () => null}
        onClose={() => undefined}
      />,
    );
  };

  it("ko: 닫기 / 시작 지점 / 끝 지점, and no English", () => {
    const html = modal("ko");
    expect(html).toContain('aria-label="닫기"');
    expect(html).toContain('data-side="start" aria-label="시작 지점"');
    expect(html).toContain('data-side="end" aria-label="끝 지점"');
    expect(html).toMatch(/<label for="[^"]*-range-start">시작 지점<\/label>/);
    expect(html).toMatch(/<label for="[^"]*-range-end">끝 지점<\/label>/);
    expect(html).not.toMatch(/aria-label="Close"| start"| end"|> ?start<|> ?end</);
  });

  it("en: Close / Start / End", () => {
    const html = modal("en");
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('data-side="start" aria-label="Start"');
    expect(html).toContain('data-side="end" aria-label="End"');
  });
});

describe("D12: a short clip that could not be read", () => {
  const model = reverseModel();
  const short = libraryVideo({ id: "12121212-1212-4121-8121-121212121212", seconds: 2.3 });
  const notes = (readFailed: boolean) => {
    const allowed = methodsFor(model, short, readFailed ? [] : null);
    return reverseNoteLines(studioVideoKo, ko.brandStudio, clipNotice(model, short), model.referenceVideoSeconds, { failed: readFailed, allowed });
  };

  it("does not promise the remake or the edit that the method cards mark unavailable", () => {
    const r = studioVideoKo.reverse;
    expect(clipNotice(model, short)).toBe("editShort");
    expect(methodsFor(model, short, [])).toEqual({ blueprint: false, reference: true, edit: false });
    const failed = notes(true);
    // Neither "the other two ways still work" nor "you can still edit it directly" …
    expect(failed.clip).not.toBe(r.pick.editShort.replace("{n}", "4"));
    expect(failed.read).not.toBe(r.read.failed);
    // … but existing sentences that match the cards: only '참고 영상 붙여 만들기' is left, and why there is no remake.
    expect(failed.clip).toContain(`'${r.method.reference.title}'`);
    expect(failed.read).toBe(studioVideoKo.remix.unreadable);
  });

  it("keeps today's notes while the reading has not failed, and for a long clip whose reading failed", () => {
    const r = studioVideoKo.reverse;
    expect(notes(false)).toEqual({ clip: r.pick.editShort.replace("{n}", "4"), read: null });
    const long = libraryVideo({ seconds: 12 });
    expect(
      reverseNoteLines(studioVideoKo, ko.brandStudio, clipNotice(model, long), model.referenceVideoSeconds, {
        failed: true,
        allowed: methodsFor(model, long, []),
      }),
    ).toEqual({ clip: null, read: r.read.failed });
  });
});
