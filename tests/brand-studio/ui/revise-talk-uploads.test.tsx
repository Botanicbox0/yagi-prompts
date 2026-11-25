import { describe, expect, it, vi } from "vitest";
import { STUDIO_LIMITS, STUDIO_REVISE_MATERIALS_MAX, type StudioAssetSaved, type StudioFailure } from "@/lib/brand-studio/contracts";
import { trayItemFromAsset, type TrayItem } from "@/components/brand-studio/refs";
import {
  createTalkFlow,
  initialTalkState,
  talkFilesRefusal,
  uploadForTalk,
  type TalkDeps,
  type TalkState,
} from "@/components/brand-studio/revise-talk-flow";
import { memoryTalkStore } from "@/components/brand-studio/revise-talk-store";
import { uploadNoteLine } from "@/components/brand-studio/revise-talk";
import { fill } from "@/components/brand-studio/copy";
import { asset, copyFor } from "./fixtures";

/**
 * Review of fix C (2026-11-25): attaching to the revise conversation (the "+" or a drop) obeys the "+"
 * button's guards, and an upload that falls short says why with the studio's own upload lines, not always
 * "올릴 수 없는 파일 형식이에요.".
 */

const file = (name: string, type: string, size = 1024) => ({ name, type, size }) as unknown as File;
const saved = (n: number): StudioAssetSaved => ({ ok: true, asset: asset(n) });
const pic = (n: number) => trayItemFromAsset(asset(n));

describe("uploadForTalk: the first reason a file did not come back", () => {
  it("a wrong kind of file is unsupported and never sent", async () => {
    const send = vi.fn(async () => saved(1));
    const out = await uploadForTalk([file("song.mp3", "audio/mpeg")], send);
    expect(out).toEqual({ added: [], failure: { code: "unsupported_file" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("a picture over the size limit is too large and never sent", async () => {
    const send = vi.fn(async () => saved(1));
    const out = await uploadForTalk([file("big.png", "image/png", STUDIO_LIMITS.imageBytesMax + 1)], send);
    expect(out.failure).toEqual({ code: "file_too_large" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a refusal from the server keeps its code and reason (storage, quota, network)", async () => {
    const refusal: StudioFailure = { ok: false, code: "storage_quota_exceeded", reason: "unapproved_quota" as StudioFailure["reason"] };
    const out = await uploadForTalk([file("a.png", "image/png")], async () => refusal);
    expect(out.failure).toEqual({ code: "storage_quota_exceeded", reason: refusal.reason });
    const network = await uploadForTalk([file("a.png", "image/png")], async () => ({ ok: false, code: "failed" }) as StudioFailure);
    expect(network.failure).toEqual({ code: "failed" });
  });

  it("good files come back as attachments; the first failure is the one reported", async () => {
    let n = 0;
    const out = await uploadForTalk([file("a.png", "image/png"), file("x.txt", "text/plain"), file("b.png", "image/png", STUDIO_LIMITS.imageBytesMax + 1), file("c.mp4", "video/mp4")], async () => saved(++n));
    expect(out.added.map((a) => a.key)).toEqual([pic(1).key, pic(2).key]);
    expect(out.failure).toEqual({ code: "unsupported_file" });
  });
});

describe("the conversation's attachment guards (the same as the + button)", () => {
  const state = (patch: Partial<TalkState> = {}): TalkState => ({ ...initialTalkState(), phase: "idle", ...patch });
  it("refuses while uploading or while the studio is busy", () => {
    expect(talkFilesRefusal(state(), true)).toBe("busy");
    for (const phase of ["reading", "slow", "making", "loading"] as const) expect(talkFilesRefusal(state({ phase }), false)).toBe("busy");
    expect(talkFilesRefusal(state(), false)).toBeNull();
  });
  it("refuses with the limit line when the conversation is full", () => {
    const full = Array.from({ length: STUDIO_LIMITS.referencesMax - 1 + STUDIO_REVISE_MATERIALS_MAX }, (_, i) => pic(i + 1));
    expect(talkFilesRefusal(state({ references: full }), false)).toBe("attach_full");
    expect(talkFilesRefusal(state({ references: full.slice(1) }), false)).toBeNull();
  });
  it("refuses when neither a picture nor a clip has room left (nothing could land)", () => {
    const pics = Array.from({ length: STUDIO_LIMITS.referencesMax - 1 }, (_, i) => pic(i + 1));
    const clips = Array.from({ length: STUDIO_REVISE_MATERIALS_MAX }, (_, i) => trayItemFromAsset(asset(50 + i, { kind: "video" })));
    expect(talkFilesRefusal(state({ references: pics, materials: clips }), false)).toBe("attach_full");
    expect(talkFilesRefusal(state({ references: pics, materials: clips.slice(1) }), false)).toBeNull();
  });
});

describe("the upload note on the conversation", () => {
  function flow() {
    const deps: TalkDeps = {
      organizationId: "00000000-0000-4000-8000-000000000001",
      outputId: "00000000-0000-4000-8000-000000000002",
      talk: vi.fn() as unknown as TalkDeps["talk"],
      create: vi.fn() as unknown as TalkDeps["create"],
      store: memoryTalkStore(),
      onChange: () => undefined,
      onCreated: () => undefined,
      decideText: "",
      setTimer: () => 0,
      clearTimer: () => undefined,
    };
    return createTalkFlow(deps);
  }

  it("keeps the failure's code, and a later clean upload clears it", () => {
    const f = flow();
    f.attachUploads({ added: [], failure: { code: "file_too_large" } });
    expect(f.state.uploadNote).toEqual({ code: "file_too_large" });
    f.attachUploads({ added: [pic(1)], failure: null });
    expect(f.state.uploadNote).toBeNull();
    expect(f.state.references.map((r: TrayItem) => r.key)).toEqual([pic(1).key]);
  });

  it("an upload cut off at the limit says so instead of vanishing", () => {
    const f = flow();
    const pics = Array.from({ length: STUDIO_LIMITS.referencesMax - 1 }, (_, i) => pic(i + 1));
    f.attachUploads({ added: pics.slice(0, -1), failure: null });
    expect(f.state.uploadNote).toBeNull();
    f.attachUploads({ added: [pics.at(-1)!, pic(99)], failure: null });
    expect(f.state.references).toHaveLength(STUDIO_LIMITS.referencesMax - 1);
    expect(f.state.uploadNote).toEqual({ code: "attach_full" });
  });

  it("says each case with the studio's own lines", () => {
    const copy = copyFor("ko");
    expect(uploadNoteLine(copy, { code: "file_too_large" })).toBe(copy.errors.file_too_large);
    expect(uploadNoteLine(copy, { code: "unsupported_file" })).toBe(copy.errors.unsupported_file);
    expect(uploadNoteLine(copy, { code: "failed" })).toBe(copy.uploadFailed);
    expect(uploadNoteLine(copy, { code: "attach_full" })).toBe(
      fill(copy.revise.attachFull, { images: STUDIO_LIMITS.referencesMax - 1, videos: STUDIO_REVISE_MATERIALS_MAX }),
    );
  });
});
