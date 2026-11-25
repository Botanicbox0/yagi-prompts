import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioBrandProject, StudioJobCreate } from "@/lib/brand-studio/contracts";
import { emptyComposerProject } from "@/lib/brand-studio/compose";
import {
  resolveVideoPageSpine,
  resolveVideoStudioAddress,
  type OpenProject,
  type StudioSpineProps,
} from "@/lib/brand-studio/open-project";
import {
  clearPressIds,
  resolvePressIds,
  singlePressFingerprint,
  type PressCache,
} from "@/components/brand-studio/use-dock";
import { createStudioApi } from "@/components/brand-studio/api";
import {
  SendToVideoDialog,
  sendDialogCreateBody,
  sendDialogFilmsInScope,
  soundSendCopy,
} from "@/components/brand-studio/sound/send-dialog";
import { resolveSoundRequestId, clearSoundRequestId } from "@/components/brand-studio/sound/sound-studio";
import { sequencePostProdInput } from "@/components/brand-studio/video/sequence-rail";
import {
  planFilmWinsSync,
  planScopeSwitchFilmReset,
  planStaleFilmRecovery,
  readVideoFilmIdFromUrl,
  scopedLazyRequestId,
  selectReverseApi,
  shouldAdoptCreatedFilm,
  videoFilmCreateBody,
  videoRenderReserveBody,
} from "@/components/brand-studio/video/workspace";
import { ProjectSpineProvider } from "@/components/brand-studio/project-chip";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, id } from "../ui/fixtures";

const P1 = id(0xd1);
const P2 = id(0xd2);
const FILM1 = id(0xe1);
const FILM_OLD = id(0xe2);
const GONE = id(0xef);

const sampleProject = (pid: string, title = "봄 향수 론칭"): StudioBrandProject => ({
  id: pid,
  title,
  origin: "self",
  lastActivityAt: "2026-11-25T10:00:00.000Z",
});

const draft = (prompt: string): StudioJobCreate => ({
  kind: "image",
  organizationId: ORG,
  requestId: "probe-0",
  model: "seedream-5.5",
  prompt,
  enhance: true,
  references: [],
  aspect: "4:5",
  resolution: "2K",
  count: 1,
});

describe("G0 (cost path): exact old single-slot behaviour without spine, one slot per scope with spine", () => {
  type Step =
    | { kind: "press"; prompt: string; count: number }
    | { kind: "succeed" }
    | { kind: "reset" };

  // Reference implementation of the exact OLD single-slot logic on `main`.
  function runOldSingleSlot(steps: readonly Step[]): Array<string[] | null> {
    const press: { current: { fingerprint: string; ids: string[] } | null } = { current: null };
    let seq = 0;
    const makeId = () => `id_${++seq}`;
    const out: Array<string[] | null> = [];
    for (const step of steps) {
      if (step.kind === "succeed" || step.kind === "reset") {
        press.current = null;
        out.push(null);
        continue;
      }
      const inputs = Array.from({ length: step.count }, (_, i) => draft(`${step.prompt}#${i}`));
      const fp = JSON.stringify(inputs.map((inp) => ({ ...inp, requestId: null })));
      if (press.current?.fingerprint !== fp || press.current.ids.length !== step.count) {
        press.current = { fingerprint: fp, ids: Array.from({ length: step.count }, () => makeId()) };
      }
      out.push([...press.current.ids]);
    }
    return out;
  }

  function runNewWithoutSpine(steps: readonly Step[]): Array<string[] | null> {
    const cache: PressCache = new Map();
    let seq = 0;
    const makeId = () => `id_${++seq}`;
    const out: Array<string[] | null> = [];
    for (const step of steps) {
      if (step.kind === "succeed") {
        clearPressIds(cache, undefined);
        out.push(null);
        continue;
      }
      if (step.kind === "reset") {
        cache.clear();
        out.push(null);
        continue;
      }
      const inputs = Array.from({ length: step.count }, (_, i) => draft(`${step.prompt}#${i}`));
      const fp = singlePressFingerprint(inputs as unknown as readonly Record<string, unknown>[], undefined);
      const ids = resolvePressIds(cache, fp, step.count, makeId, undefined);
      out.push([...ids]);
    }
    return out;
  }

  it("matches the old single-slot reference implementation row-for-row without the spine", () => {
    const sequences: Step[][] = [
      // Retry same draft after lost answer -> same id; then succeed -> fresh id.
      [
        { kind: "press", prompt: "bottle", count: 1 },
        { kind: "press", prompt: "bottle", count: 1 },
        { kind: "succeed" },
        { kind: "press", prompt: "bottle", count: 1 },
      ],
      // Different draft overwrites the single slot -> going back to first draft gets NEW id!
      [
        { kind: "press", prompt: "bottle A", count: 1 },
        { kind: "press", prompt: "bottle B", count: 1 },
        { kind: "press", prompt: "bottle A", count: 1 },
      ],
      // Different count replaces the single slot; reset clears it.
      [
        { kind: "press", prompt: "multi", count: 1 },
        { kind: "press", prompt: "multi", count: 2 },
        { kind: "press", prompt: "multi", count: 2 },
        { kind: "reset" },
        { kind: "press", prompt: "multi", count: 2 },
      ],
    ];
    for (const steps of sequences) {
      expect(runNewWithoutSpine(steps)).toEqual(runOldSingleSlot(steps));
    }
  });

  it("keeps one slot per scope under the spine: A1 -> B1 -> A1 reuses A1, but A1 -> A2 -> A1 gets NEW ids", () => {
    const cache: PressCache = new Map();
    let seq = 0;
    const makeId = () => `sp_${++seq}`;

    const fpA1 = singlePressFingerprint([draft("draft-1") as unknown as Record<string, unknown>], P1);
    const fpA2 = singlePressFingerprint([draft("draft-2") as unknown as Record<string, unknown>], P1);
    const fpB1 = singlePressFingerprint([draft("draft-1") as unknown as Record<string, unknown>], P2);

    // 1. A-draft1 (lost) -> B-draft1 -> A-draft1 reuses A's exact ids.
    const idsA1 = resolvePressIds(cache, fpA1, 1, makeId, P1);
    const idsB1 = resolvePressIds(cache, fpB1, 1, makeId, P2);
    expect(idsA1).toEqual(["sp_1"]);
    expect(idsB1).toEqual(["sp_2"]);
    expect(resolvePressIds(cache, fpA1, 1, makeId, P1)).toEqual(["sp_1"]);

    // 2. A-draft1 (lost) -> A-draft2 -> A-draft1 gets NEW ids (same replace-on-different-draft rule inside scope A).
    const idsA2 = resolvePressIds(cache, fpA2, 1, makeId, P1);
    expect(idsA2).toEqual(["sp_3"]);
    const idsA1Again = resolvePressIds(cache, fpA1, 1, makeId, P1);
    expect(idsA1Again).toEqual(["sp_4"]);
    // Scope B's slot was NOT touched by edits inside scope A.
    expect(resolvePressIds(cache, fpB1, 1, makeId, P2)).toEqual(["sp_2"]);
  });

  it("applies exact single-slot semantics to sound studio and video scopedLazyRequestId", () => {
    // Sound studio without spine: single content-independent slot reused until cleared, identical to old `draftRequest.current ??= newRequestId()`.
    const sndCache: PressCache = new Map();
    let sSeq = 0;
    const makeSound = () => `m_${++sSeq}`;

    expect(resolveSoundRequestId(sndCache, undefined, makeSound)).toBe("m_1");
    expect(resolveSoundRequestId(sndCache, undefined, makeSound)).toBe("m_1");
    clearSoundRequestId(sndCache, undefined);
    expect(resolveSoundRequestId(sndCache, undefined, makeSound)).toBe("m_2");

    // Sound studio with spine: 1 content-independent slot per scope; A -> B -> A reuses A's id until cleared.
    const sndSpine: PressCache = new Map();
    expect(resolveSoundRequestId(sndSpine, P1, makeSound)).toBe("m_3");
    expect(resolveSoundRequestId(sndSpine, P2, makeSound)).toBe("m_4");
    expect(resolveSoundRequestId(sndSpine, P1, makeSound)).toBe("m_3");
    clearSoundRequestId(sndSpine, P1);
    expect(resolveSoundRequestId(sndSpine, P1, makeSound)).toBe("m_5");
    expect(resolveSoundRequestId(sndSpine, P2, makeSound)).toBe("m_4");

    // Video lazyRequestId without spine: single slot; with spine: 1 slot per scope.
    const vCache = new Map<string, string>();
    let vSeq = 0;
    const makeVp = () => `vp_${++vSeq}`;
    expect(scopedLazyRequestId(vCache, undefined, makeVp)).toBe("vp_1");
    expect(scopedLazyRequestId(vCache, undefined, makeVp)).toBe("vp_1");
    expect(scopedLazyRequestId(vCache, P1, makeVp)).toBe("vp_2");
    expect(scopedLazyRequestId(vCache, P2, makeVp)).toBe("vp_3");
    expect(scopedLazyRequestId(vCache, P1, makeVp)).toBe("vp_2");
  });
});

describe("G1 & G2: stale ?film= recovery, DB-error guard, and films beyond first 100", () => {
  const pathname = "/brand/studio/video";

  it("handles in-list film, beyond-100 lookup found, not_found -> gone, and list/lookup errors -> none", () => {
    // 1. In first-100 list -> redirect.
    expect(
      resolveVideoStudioAddress({
        pathname,
        searchParams: [["project", FILM1], ["tab", "edit"]],
        projectIds: [P1],
        filmIds: [FILM1],
      }),
    ).toEqual({
      kind: "redirect_film",
      filmId: FILM1,
      href: `/brand/studio/video?film=${FILM1}&tab=edit`,
    });

    // 2. Not in first-100 list, but single-id lookup found it -> redirect.
    expect(
      resolveVideoStudioAddress({
        pathname,
        searchParams: [["organizationId", ORG], ["project", FILM_OLD], ["tab", "edit"]],
        projectIds: [P1],
        filmIds: [FILM1],
        filmLookup: "found",
      }),
    ).toEqual({
      kind: "redirect_film",
      filmId: FILM_OLD,
      href: `/brand/studio/video?organizationId=${ORG}&film=${FILM_OLD}&tab=edit`,
    });

    // 3. Not in list and lookup answered not_found -> gone.
    expect(
      resolveVideoStudioAddress({
        pathname,
        searchParams: [["project", GONE]],
        projectIds: [P1],
        filmIds: [FILM1],
        filmLookup: "not_found",
      }),
    ).toEqual({ kind: "gone" });

    // 4. Lookup threw -> none (never gone on DB error).
    expect(
      resolveVideoStudioAddress({
        pathname,
        searchParams: [["project", FILM_OLD]],
        projectIds: [P1],
        filmIds: [FILM1],
        filmLookup: "error",
      }),
    ).toEqual({ kind: "none" });

    // 5. Film list load itself threw -> none (never redirect or gone on DB error).
    expect(
      resolveVideoStudioAddress({
        pathname,
        searchParams: [["project", GONE]],
        projectIds: [P1],
        filmIds: [],
        filmListFailed: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("clears gone notice when DB list/lookup failed so an error never shows 'project is gone' or rewrites cookie", () => {
    const baseSpine: StudioSpineProps = {
      projects: [sampleProject(P1)],
      open: { kind: "unfiled" },
      canCreate: true,
      notice: "gone",
      noticeSource: "address",
    };
    const resolved = resolveVideoPageSpine({
      spine: baseSpine,
      decision: { kind: "none" },
      openedFilm: null,
      hadQueryProject: true,
    });
    expect(resolved.notice).toBeNull();
    expect(resolved.noticeSource).toBeNull();
  });

  it("strips stale ?film= from address (keeping other params) when client film load cannot open it", () => {
    expect(
      planStaleFilmRecovery({
        requestedFilmId: FILM_OLD,
        loadedFilmPresent: false,
        spineActive: true,
        errorCode: "not_found",
        href: `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P1}&film=${FILM_OLD}&tab=edit`,
      }),
    ).toEqual({
      reloadListWithoutFilm: true,
      nextUrl: `/brand/studio/video?organizationId=${ORG}&project=${P1}&tab=edit`,
    });

    expect(
      planStaleFilmRecovery({
        requestedFilmId: FILM1,
        loadedFilmPresent: true,
        spineActive: true,
        errorCode: "not_found",
        href: `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&film=${FILM1}`,
      }),
    ).toEqual({
      reloadListWithoutFilm: false,
      nextUrl: null,
    });
  });
});

describe("G3: flush pending timeline save on chip switch, and do not adopt late create from old scope", () => {
  const tl = emptyComposerProject("9:16");

  it("flushes pending debounced save before resetting when switching away from active film's scope", () => {
    const pending = { projectId: FILM1, timeline: tl, title: "Draft cut", expectedRevision: 3 };
    const plan = planScopeSwitchFilmReset({
      activeFilmId: FILM1,
      activeFilmBrandProjectId: P1,
      nextScope: { kind: "project", id: P2 },
      pendingSave: pending,
    });
    expect(plan).toEqual({ reset: true, flush: pending });

    // Switching to same scope does not flush or reset.
    expect(
      planScopeSwitchFilmReset({
        activeFilmId: FILM1,
        activeFilmBrandProjectId: P1,
        nextScope: { kind: "project", id: P1 },
        pendingSave: pending,
      }),
    ).toEqual({ reset: false, flush: null });
  });

  it("refuses to adopt a lazy-created film whose create answer arrived after switching to another scope", () => {
    const openA: OpenProject = { kind: "project", id: P1 };
    const openB: OpenProject = { kind: "project", id: P2 };
    expect(shouldAdoptCreatedFilm({ createdBrandProjectId: P1, sentScope: openA, currentScope: openB })).toBe(false);
    expect(shouldAdoptCreatedFilm({ createdBrandProjectId: P1, sentScope: openA, currentScope: openA })).toBe(true);
    expect(shouldAdoptCreatedFilm({ createdBrandProjectId: undefined, sentScope: undefined, currentScope: undefined })).toBe(true);
  });
});

describe("G4: SendToVideoDialog 편집본 nouns, scope filter, and brandProjectId on film create", () => {
  it.each(["ko", "en"] as const)("replaces every '프로젝트'/'project' string in SendToVideoDialog copy (%s)", (locale) => {
    const dict = getDictionary(locale);
    const swapped = soundSendCopy(dict.studioSound.send, dict.projectSpine);
    if (locale === "ko") {
      expect(swapped.pickTitle).toBe("어느 영상 편집본에 넣을까요?");
      expect(swapped.newProject).toBe("새 편집본을 만들어 넣기");
      expect(swapped.noProjects).toBe("아직 영상 편집본이 없어요.");
      expect(swapped.loading).toBe("편집본을 불러오는 중이에요.");
      expect(swapped.sfxFull).toBe("편집본 하나에 효과음은 24개까지 넣을 수 있어요.");
      for (const [k, v] of Object.entries(swapped)) {
        expect(v, k).not.toContain("프로젝트");
      }
    } else {
      expect(swapped.pickTitle).toBe("Add to which video edit?");
      expect(swapped.newProject).toBe("Add to a new edit");
      expect(swapped.noProjects).toBe("No video edits yet.");
      expect(swapped.loading).toBe("Loading edits");
      expect(swapped.sfxFull).toBe("An edit can hold up to 24 sound effects.");
      for (const [k, v] of Object.entries(swapped)) {
        expect(v, k).not.toMatch(/\bprojects?\b/i);
      }
    }
    expect(swapped.cancel).toBe(dict.studioSound.send.cancel);
    expect(swapped.failed).toBe(dict.studioSound.send.failed);
  });

  it("filters films to open scope and attaches brandProjectId only when open (exact old body without spine)", () => {
    const f1 = { id: FILM1, brandProjectId: P1 };
    const f2 = { id: FILM_OLD, brandProjectId: P2 };
    expect(sendDialogFilmsInScope([f1, f2], undefined)).toEqual([f1, f2]);
    expect(sendDialogFilmsInScope([f1, f2], { kind: "project", id: P1 })).toEqual([f1]);

    // Without spine / unfiled: exact old literal object.
    expect(sendDialogCreateBody({ organizationId: ORG, requestId: "req_1", title: "BGM 1", brandProjectId: null })).toEqual({
      op: "create",
      organizationId: ORG,
      requestId: "req_1",
      title: "BGM 1",
    });
    expect("brandProjectId" in sendDialogCreateBody({ organizationId: ORG, requestId: "req_1", title: "BGM 1", brandProjectId: null })).toBe(false);

    // With open project: carries brandProjectId.
    expect(sendDialogCreateBody({ organizationId: ORG, requestId: "req_2", title: "BGM 1", brandProjectId: P1 })).toEqual({
      op: "create",
      organizationId: ORG,
      requestId: "req_2",
      title: "BGM 1",
      brandProjectId: P1,
    });

    // SSR markup of SendToVideoDialog under spine shows 편집본 copy.
    const dict = getDictionary("ko");
    const spine: StudioSpineProps = {
      projects: [sampleProject(P1)],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    const html = renderToStaticMarkup(
      <ProjectSpineProvider organizationId={ORG} locale="ko" copy={dict.projectSpine} initial={spine}>
        <SendToVideoDialog
          organizationId={ORG}
          target={{ kind: "bgm", track: { assetId: id(1), label: "Intro", seconds: 12, srcUrl: "/a.mp3" } }}
          copy={dict.studioSound}
          videoHref={`/brand/studio/video?organizationId=${ORG}`}
          onClose={() => {}}
          onDone={() => {}}
          onNotice={() => {}}
        />
      </ProjectSpineProvider>,
    );
    expect(html).toContain("어느 영상 편집본에 넣을까요?");
    expect(html).toContain("새 편집본을 만들어 넣기");
    expect(html).not.toContain("프로젝트");
  });
});

describe("G5 & G6: film-wins address rewrite, exact flag-off payloads, reverseApi identity, mount URL read", () => {
  it("rewrites ?project= to the winning scope (or removes it for 미분류) after film wins", () => {
    // ?project=P1&film=FILM1 where FILM1 belongs to P2 -> rewrites project=P2 keeping film=FILM1.
    expect(
      planFilmWinsSync({
        spineActive: true,
        initialFilm: { brandProjectId: P2 },
        open: { kind: "project", id: P2 },
        href: `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P1}&film=${FILM1}`,
      }),
    ).toEqual({
      writeCookie: { kind: "project", id: P2 },
      nextUrl: `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P2}&film=${FILM1}`,
    });

    // Film belongs to 미분류 -> removes project param, keeps film param.
    expect(
      planFilmWinsSync({
        spineActive: true,
        initialFilm: { brandProjectId: null },
        open: { kind: "unfiled" },
        href: `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P1}&film=${FILM1}`,
      }),
    ).toEqual({
      writeCookie: { kind: "unfiled" },
      nextUrl: `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&film=${FILM1}`,
    });
  });

  it("preserves exact literal bodies without spine, exact reverseApi reference when no project is open, and reads film vs project on mount", () => {
    const timeline = emptyComposerProject("9:16");
    // Exact literal equality for film create without spine.
    expect(
      videoFilmCreateBody({
        organizationId: ORG,
        requestId: "vp_exact",
        firstPrompt: "perfume shot",
        locale: "ko",
        timeline,
        brandProjectId: null,
      }),
    ).toEqual({
      op: "create",
      organizationId: ORG,
      requestId: "vp_exact",
      firstPrompt: "perfume shot",
      locale: "ko",
      aspect: "9:16",
      timeline,
    });

    // Exact literal equality for render.reserve without spine vs with spine.
    expect(videoRenderReserveBody({ organizationId: ORG, requestId: "mp4_1", durationSec: 12.5, brandProjectId: null })).toEqual({
      organizationId: ORG,
      requestId: "mp4_1",
      durationSec: 12.5,
    });
    expect(videoRenderReserveBody({ organizationId: ORG, requestId: "mp4_1", durationSec: 12.5, brandProjectId: P1 })).toEqual({
      organizationId: ORG,
      requestId: "mp4_1",
      durationSec: 12.5,
      brandProjectId: P1,
    });

    // Exact literal equality for sequence rail post-prod bodies without spine.
    const musicBody = { organizationId: ORG, requestId: "mus_1", prompt: "calm", durationSec: 10 };
    const sfxBody = { organizationId: ORG, requestId: "sfx_1", text: "whoosh", durationSec: 3 };
    const upBody = { organizationId: ORG, requestId: "ups_1", assetId: id(5), targetResolution: "1080p" };
    expect(sequencePostProdInput(musicBody, undefined)).toEqual(musicBody);
    expect(sequencePostProdInput(sfxBody, null)).toEqual(sfxBody);
    expect(sequencePostProdInput(upBody, null)).toEqual(upBody);

    // ReversePanel receives the EXACT same clientApi reference when no project is open.
    const clientApi = createStudioApi({ organizationId: ORG });
    expect(selectReverseApi(clientApi, null)).toBe(clientApi);
    expect(selectReverseApi(clientApi, undefined)).toBe(clientApi);
    expect(selectReverseApi(clientApi, P1)).not.toBe(clientApi);

    // Mount URL read: `film` under spine, `project` without spine.
    const href = `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P1}&film=${FILM1}`;
    expect(readVideoFilmIdFromUrl(href, true)).toBe(FILM1);
    expect(readVideoFilmIdFromUrl(href, false)).toBe(P1);
    expect(readVideoFilmIdFromUrl(`https://brand.twings.app/brand/studio/video?project=${P1}`, true)).toBeNull();
  });
});
