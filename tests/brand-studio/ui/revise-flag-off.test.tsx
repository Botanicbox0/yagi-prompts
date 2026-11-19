import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioJobView, StudioOutputView, StudioRevisePlan } from "@/lib/brand-studio/contracts";
import { Viewer, type ViewerActions } from "@/components/brand-studio/viewer";
import type { ReviseSupport } from "@/components/brand-studio/revise-form";
import { ORG, copyFor, id, job, output } from "./fixtures";

/**
 * Flag `BRAND_STUDIO_REVISE_V2` off: the viewer's clip panel must be byte for byte what it was before the
 * revise conversation (revise-talk.tsx) was added. The fixture was written by running this same file
 * against origin/main (`WRITE_FLAG_OFF_FIXTURE=1`, commit noted in the fixture's first line); here the same
 * renders are compared with it.
 */
const FIXTURE = join(process.cwd(), "tests", "brand-studio", "ui", "__fixtures__", "revise-flag-off.html");
const noop = () => {};
const ko = copyFor("ko");
const en = copyFor("en");
const clip = (n: number, patch: Partial<StudioJobView> = {}, out: Partial<StudioOutputView> = {}) =>
  job(n, {
    kind: "video",
    aspect: "9:16",
    resolution: "draft",
    seconds: 5,
    audio: "native",
    estimateKrw: 3000,
    outputs: [output(n, { kind: "video", jobId: id(0x2000 + n), width: 720, height: 1280, draft: true, ...out })],
    ...patch,
  });
const plan = (): StudioRevisePlan => ({ ok: true, version: 2, methods: { edit: { available: true, estimateKrw: 1500 }, reshoot: { available: true, estimateKrw: 4500 } }, recommended: "edit", reason: null });
const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };
const support = (jobs: StudioJobView[]): ReviseSupport => ({
  organizationId: ORG,
  jobs,
  recent: [],
  resolve: () => null,
  upload: async () => [],
  plan: async () => plan(),
  create: async () => ({ ok: true, job: jobs[0]! }),
});

function renders(): string {
  const root = clip(1);
  const v2 = clip(2, { prompt: "배경을 바다로", revision: { rootJobId: root.id, version: 2, baseOutputId: root.outputs[0]!.id, mode: "edit", added: 0 } }, { draft: false });
  const plain = clip(3, {}, { draft: false });
  const view = (opened: StudioJobView, jobs: StudioJobView[], locale: "ko" | "en") =>
    renderToStaticMarkup(
      <Viewer items={[{ type: "output", output: opened.outputs[0]!, job: opened }]} index={0} copy={locale === "ko" ? ko : en} locale={locale} canCreate canGenerate busy={null} notice={null}
        revise={support(jobs)} parentOf={() => null} onIndex={noop} onClose={noop} actions={actions} />,
    );
  return [view(root, [root], "ko"), view(v2, [root, v2], "ko"), view(plain, [plain], "en")].join("\n<!-- next -->\n");
}

describe("flag off: the clip panel exactly as before", () => {
  it("renders byte for byte what origin/main rendered", () => {
    const html = renders();
    if (process.env.WRITE_FLAG_OFF_FIXTURE === "1") {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `<!-- written from ${process.env.FLAG_OFF_BASE ?? "unknown"} -->\n${html}`);
      return;
    }
    expect(existsSync(FIXTURE)).toBe(true);
    const kept = readFileSync(FIXTURE, "utf8").replace(/^<!--[^\n]*-->\n/, "");
    expect(html).toBe(kept);
    expect(html).not.toContain("data-revise-talk");
  });
});
