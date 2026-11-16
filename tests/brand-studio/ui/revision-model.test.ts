import { describe, expect, it } from "vitest";
import type { StudioJobView } from "@/lib/brand-studio/contracts";
import { chainOf, collapseRevisions, reviseRerunInput, revisionChains, versionBadge, versionOf } from "@/components/brand-studio/revision-model";
import { ORG, asset, id, job, output } from "./fixtures";

/** docs/BRAND-STUDIO-V6-PLAN.md §4 — versions of one clip as data for the wall and the viewer. */
type Revision = NonNullable<StudioJobView["revision"]>;
const clip = (n: number, patch: Partial<StudioJobView> = {}) =>
  job(n, { kind: "video", aspect: "9:16", resolution: "480p", seconds: 5, audio: "native", outputs: [output(n, { kind: "video", jobId: id(0x2000 + n), draft: true })], ...patch });
const ROOT = job(1).id;
const rev = (version: number, baseOutputId: string | null, patch: Partial<Revision> = {}): Revision => ({ rootJobId: ROOT, version, baseOutputId, mode: "edit", added: 0, ...patch });

const v1 = clip(1);
const v2 = clip(2, { kind: "video_remix", prompt: "병을 더 크게", revision: rev(2, output(1).id) });
const v3 = clip(3, { prompt: "카메라를 천천히", references: [{ assetId: asset(1).id }, { assetId: asset(2).id, role: "product", frame: "start" }], revision: rev(3, output(2).id, { mode: "reshoot", added: 1 }) });
const final2 = clip(4, { kind: "video_final", parentOutputId: output(2).id, outputs: [output(4, { kind: "video", jobId: job(4).id })] });
const picture = job(9, { outputs: [output(9)] });
const ids = (jobs: readonly StudioJobView[]) => jobs.map((j) => j.id);

describe("revision chains", () => {
  it("groups clip runs by their root and orders the versions; a final joins the version of its draft", () => {
    const chains = revisionChains([v3, final2, picture, v1, v2]);
    expect([...chains.keys()]).toEqual([ROOT]);
    expect(chains.get(ROOT)!.map((v) => [v.version, ids(v.jobs)])).toEqual([
      [1, [v1.id]],
      [2, [final2.id, v2.id]],
      [3, [v3.id]],
    ]);
    expect(versionOf([v1, v2, final2], final2)).toBe(2);
    expect(versionOf([picture], picture)).toBeNull();
  });

  it("lists ready and in-progress versions for the strip; the 1080p final represents its version", () => {
    const making = clip(5, { status: "running", outputs: [], prompt: "배경을 밤으로", revision: rev(4, output(3).id) });
    const failed = clip(6, { status: "failed", outputs: [], revision: rev(5, output(3).id) });
    const chain = chainOf([failed, making, final2, v3, v2, v1], v3);
    expect(chain.map((v) => [v.version, v.state, v.output?.id ?? null, v.request])).toEqual([
      [1, "ready", output(1).id, null],
      [2, "ready", output(4).id, "병을 더 크게"],
      [3, "ready", output(3).id, "카메라를 천천히"],
      [4, "making", null, "배경을 밤으로"],
    ]);
    expect(chainOf([picture], picture)).toEqual([]);
  });
});

describe("collapsing the wall", () => {
  it("shows the newest version only, keeps newer failures, leaves images and order as they were", () => {
    const failed = clip(6, { status: "failed", outputs: [], revision: rev(4, output(3).id) });
    const jobs = [failed, v3, picture, final2, v2, v1];
    expect(ids(collapseRevisions(jobs))).toEqual([failed.id, v3.id, picture.id]);
    // A version being made is the head: the ready one before it steps back.
    const making = clip(7, { status: "queued", outputs: [], revision: rev(4, output(3).id) });
    expect(ids(collapseRevisions([making, v3, v2, v1]))).toEqual([making.id]);
    // …unless the viewer keeps the one it is showing.
    expect(ids(collapseRevisions([making, v3, v2, v1], v3.id))).toEqual([making.id, v3.id]);
    // The head version keeps its final; a single-version clip comes back untouched (failed final included).
    expect(ids(collapseRevisions([final2, v2, v1]))).toEqual([final2.id, v2.id]);
    const lonely = clip(8, { status: "failed", outputs: [] });
    expect(ids(collapseRevisions([lonely, picture]))).toEqual([lonely.id, picture.id]);
  });

  it("falls back to the previous version when the newest result was deleted", () => {
    const emptied = { ...v3, outputs: [] };
    expect(ids(collapseRevisions([emptied, v2, v1]))).toEqual([emptied.id, v2.id]);
  });

  it("numbers only clips with more than one version", () => {
    const jobs = [v3, v2, v1, picture];
    expect(versionBadge(jobs, v3)).toBe(3);
    expect(versionBadge(jobs, v1)).toBe(1);
    expect(versionBadge([v1], v1)).toBeNull();
    expect(versionBadge(jobs, picture)).toBeNull();
  });
});

describe("retrying a version", () => {
  it("asks for the same change again from the same base with the pictures added for it", () => {
    const request = reviseRerunInput(v3, { organizationId: ORG, requestId: id(0x77) });
    expect(request).toEqual({
      kind: "video_revise",
      organizationId: ORG,
      requestId: id(0x77),
      outputId: output(2).id,
      mode: "reshoot",
      prompt: "카메라를 천천히",
      references: [{ assetId: asset(2).id, role: "product" }],
      marks: [],
      materials: [],
    });
    // The videos read for that request are read again.
    const withMaterial = { ...v3, revision: rev(3, output(2).id, { materials: [{ assetId: asset(5).id }] }) };
    expect(reviseRerunInput(withMaterial, { organizationId: ORG, requestId: id(0x79) })).toMatchObject({ materials: [{ assetId: asset(5).id }] });
    expect(reviseRerunInput(v2, { organizationId: ORG, requestId: id(0x78) })).toMatchObject({ mode: "edit", references: [] });
    // The spots the request pointed at go again with it.
    const marks = [{ time: 1.5, x: 0.2, y: 0.4, label: "병", what: "the bottle" }, { time: 3, x: 0.1, y: 0.1, w: 0.3, h: 0.2 }];
    const marked = { ...v3, prompt: "① 더 크게, ② 선명하게", revision: rev(3, output(2).id, { marks }) };
    expect(reviseRerunInput(marked, { organizationId: ORG, requestId: id(0x81) })).toMatchObject({ prompt: "① 더 크게, ② 선명하게", marks });
    expect(chainOf([marked, v2, v1], marked).map((v) => v.marks)).toEqual([[], [], marks]);
    expect(reviseRerunInput({ ...v3, revision: rev(3, null) }, { organizationId: ORG, requestId: id(0x79) })).toBeNull();
    expect(reviseRerunInput(v1, { organizationId: ORG, requestId: id(0x80) })).toBeNull();
  });
});
