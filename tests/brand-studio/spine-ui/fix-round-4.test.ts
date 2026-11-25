import { describe, expect, it, vi } from "vitest";
import { emptyComposerProject } from "@/lib/brand-studio/compose";
import type { FrameSequence } from "@/lib/brand-studio/editor-v2/frames";
import {
  flushFilmSaveWithCurrentRevision,
  planStaleFilmRecovery,
  reusableLazyCreatePromise,
  type PendingFilmSave,
} from "@/components/brand-studio/video/workspace";
import { exportStartRequest } from "@/components/brand-studio/editor-v2/export-sheet";
import type { ExportRequest } from "@/components/brand-studio/editor-v2/export-job";
import { ORG, id } from "../ui/fixtures";

const P1 = id(0xa1);
const P2 = id(0xa2);
const FILM1 = id(0xb1);
const FILM2 = id(0xb2);

describe("J1 (flag-off parity): stale film recovery runs ONLY with spine active AND code === 'not_found'", () => {
  const legacyHref = `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${FILM1}&tab=edit`;
  const spineHref = `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P1}&film=${FILM1}&tab=edit`;

  it("does nothing without the spine (both not_found and error) and does nothing on temporary errors with the spine", () => {
    // 1. No spine + not_found -> nothing
    expect(
      planStaleFilmRecovery({
        requestedFilmId: FILM1,
        loadedFilmPresent: false,
        spineActive: false,
        errorCode: "not_found",
        href: legacyHref,
      }),
    ).toEqual({ reloadListWithoutFilm: false, nextUrl: null });

    // 2. No spine + error -> nothing
    expect(
      planStaleFilmRecovery({
        requestedFilmId: FILM1,
        loadedFilmPresent: false,
        spineActive: false,
        errorCode: "failed",
        href: legacyHref,
      }),
    ).toEqual({ reloadListWithoutFilm: false, nextUrl: null });

    // 3. Spine + error (500 / network error / missing code) -> nothing (must NOT strip ?film=)
    expect(
      planStaleFilmRecovery({
        requestedFilmId: FILM1,
        loadedFilmPresent: false,
        spineActive: true,
        errorCode: "failed",
        href: spineHref,
      }),
    ).toEqual({ reloadListWithoutFilm: false, nextUrl: null });
    expect(
      planStaleFilmRecovery({
        requestedFilmId: FILM1,
        loadedFilmPresent: false,
        spineActive: true,
        errorCode: null,
        href: spineHref,
      }),
    ).toEqual({ reloadListWithoutFilm: false, nextUrl: null });

    // 4. Spine + not_found -> strip `film` (preserving `project` and other params) and reload list
    expect(
      planStaleFilmRecovery({
        requestedFilmId: FILM1,
        loadedFilmPresent: false,
        spineActive: true,
        errorCode: "not_found",
        href: spineHref,
      }),
    ).toEqual({
      reloadListWithoutFilm: true,
      nextUrl: `/brand/studio/video?organizationId=${ORG}&project=${P1}&tab=edit`,
    });
  });
});

describe("J2 (data loss): flushFilmSaveWithCurrentRevision replaces stale revision and waits for in-flight save", () => {
  const tl = emptyComposerProject("9:16");

  it("replaces stale expectedRevision on pending save with currentRevision at flush time", async () => {
    const sent: PendingFilmSave[] = [];
    const pending: PendingFilmSave = { projectId: FILM1, timeline: tl, title: "Cut A", expectedRevision: 2 };

    const flushed = await flushFilmSaveWithCurrentRevision({
      pending,
      currentRevision: 5,
      inFlight: null,
      send: (save) => {
        sent.push(save);
      },
    });

    expect(flushed.expectedRevision).toBe(5);
    expect(sent).toEqual([{ ...pending, expectedRevision: 5 }]);
  });

  it("waits for an in-flight save of the same film before sending the flush with the updated revision", async () => {
    let settleInFlight: ((rev: number | null) => void) | null = null;
    const inFlightPromise = new Promise<number | null>((resolve) => {
      settleInFlight = resolve;
    });
    const order: string[] = [];
    const sent: PendingFilmSave[] = [];
    const pending: PendingFilmSave = { projectId: FILM1, timeline: tl, expectedRevision: 2 };

    const flushPromise = flushFilmSaveWithCurrentRevision({
      pending,
      currentRevision: 3,
      inFlight: { projectId: FILM1, promise: inFlightPromise },
      send: (save) => {
        order.push(`send:${save.expectedRevision}`);
        sent.push(save);
      },
    });

    // Must not send in parallel while the earlier save is still in flight.
    await Promise.resolve();
    expect(sent).toHaveLength(0);

    // Earlier save settles at revision 4 -> flush now sends with expectedRevision 4.
    order.push("settled:4");
    settleInFlight!(4);
    const flushed = await flushPromise;

    expect(order).toEqual(["settled:4", "send:4"]);
    expect(flushed.expectedRevision).toBe(4);
    expect(sent).toEqual([{ ...pending, expectedRevision: 4 }]);
  });

  it("does not wait on an in-flight save belonging to a different film", async () => {
    const neverSettles = new Promise<number | null>(() => {});
    const send = vi.fn();
    const pending: PendingFilmSave = { projectId: FILM1, timeline: tl, expectedRevision: 1 };

    const flushed = await flushFilmSaveWithCurrentRevision({
      pending,
      currentRevision: 3,
      inFlight: { projectId: FILM2, promise: neverSettles },
      send,
    });

    expect(flushed.expectedRevision).toBe(3);
    expect(send).toHaveBeenCalledWith({ ...pending, expectedRevision: 3 });
  });
});

describe("J3: in-flight lazy film create is ignored after a scope switch under spine, unchanged without spine", () => {
  it("reuses only matching-scope promises under spine, and always reuses without spine", () => {
    const promiseA = Promise.resolve(FILM1);
    const inFlightA = { scopeKey: P1.toLowerCase(), promise: promiseA };

    // Spine active: same scope reuses, different scope ignores so a new create starts in scope B.
    expect(reusableLazyCreatePromise(inFlightA, P1.toLowerCase(), true)).toBe(promiseA);
    expect(reusableLazyCreatePromise(inFlightA, P2.toLowerCase(), true)).toBeNull();
    expect(reusableLazyCreatePromise(inFlightA, "__unfiled__", true)).toBeNull();

    // Without spine: unchanged (always reuses existing in-flight promise).
    const legacy = { scopeKey: "__legacy__", promise: promiseA };
    expect(reusableLazyCreatePromise(legacy, "__legacy__", false)).toBe(promiseA);
    expect(reusableLazyCreatePromise(null, "__legacy__", false)).toBeNull();
  });
});

describe("J5: ExportSheet start request carries brandProjectId when open and equals main's literal object without it", () => {
  it("attaches brandProjectId only when a project is open", () => {
    const sequence: FrameSequence = {
      fps: 24,
      aspect: "9:16",
      clips: [],
      captions: [],
    };
    const base: Omit<ExportRequest, "brandProjectId"> = {
      sequence,
      reframe: {},
      framing: "current",
      extras: null,
      burnCaptions: false,
      captionText: null,
      notify: () => {},
      path: null,
      download: true,
      recordFor: ORG,
    };

    // Without spine / unfiled: exact literal object (same reference, no brandProjectId key).
    const offReq = exportStartRequest(base, undefined);
    expect(offReq).toBe(base);
    expect("brandProjectId" in offReq).toBe(false);

    const unfiledReq = exportStartRequest(base, null);
    expect(unfiledReq).toBe(base);
    expect("brandProjectId" in unfiledReq).toBe(false);

    // With open project: carries brandProjectId captured at start time.
    const onReq = exportStartRequest(base, P1);
    expect(onReq).toEqual({ ...base, brandProjectId: P1 });
    expect(onReq.brandProjectId).toBe(P1);
  });
});
