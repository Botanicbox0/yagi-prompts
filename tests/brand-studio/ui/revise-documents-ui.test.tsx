import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioJobView, StudioRevisePlan } from "@/lib/brand-studio/contracts";
import { ReviseFormView, VersionStrip, isOldSlides, noteLine, type ReviseFormViewProps } from "@/components/brand-studio/revise-form";
import { REVISE_DOCUMENTS_MAX, createReviseFlow, initialReviseState, type ReviseState } from "@/components/brand-studio/revise-flow";
import { addToTray, trayItemFromAsset } from "@/components/brand-studio/refs";
import { chainOf, reviseRerunInput } from "@/components/brand-studio/revision-model";
import { Thumb } from "@/components/brand-studio/rail/parts";
import { itemOfAsset } from "@/components/brand-studio/rail/text";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fill } from "@/components/brand-studio/copy";
import { ORG, asset, copyFor, id, job, output } from "./fixtures";

/** docs/BRAND-STUDIO-V6-PLAN.md §4.7 — documents in the revise panel, and nowhere as a reference. */
const noop = () => {};
const copy = copyFor("ko");
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const doc = (n: number, pages?: number) =>
  asset(n, { kind: "document", name: `가이드 ${n}.pdf`, url: `/api/brand-studio/documents/${id(0x3000 + n)}?organizationId=${ORG}`, thumbUrl: null, width: null, height: null, ...(pages ? { pages } : {}) });
const plan = (patch: Partial<StudioRevisePlan> = {}): StudioRevisePlan => ({
  ok: true,
  version: 2,
  methods: { edit: { available: true, estimateKrw: 1500 }, reshoot: { available: true, estimateKrw: 4500 } },
  recommended: "edit",
  reason: null,
  ...patch,
});

function flowWith(documents: boolean) {
  const planCalls: Array<Record<string, unknown>> = [];
  const created: Array<Record<string, unknown>> = [];
  const flow = createReviseFlow({
    organizationId: ORG,
    outputId: output(3).id,
    plan: vi.fn(async (input) => {
      planCalls.push(input as unknown as Record<string, unknown>);
      return plan();
    }),
    create: vi.fn(async (input) => {
      created.push(input as unknown as Record<string, unknown>);
      return { ok: true as const, job: job(9, { kind: "video", status: "queued", outputs: [] }) };
    }),
    onChange: noop,
    ...(documents ? { documents: true } : {}),
  });
  return { flow, planCalls, created };
}

describe("the revise flow with documents", () => {
  it("takes documents only while the server does, up to two, and sends their ids apart from the references", async () => {
    const closed = flowWith(false);
    expect(closed.flow.attach([trayItemFromAsset(doc(1))])).toBe(0);
    expect(closed.flow.state.documents).toEqual([]);

    const { flow, planCalls, created } = flowWith(true);
    await flow.load();
    expect(flow.attach([trayItemFromAsset(doc(1)), trayItemFromAsset(doc(2)), trayItemFromAsset(doc(3)), trayItemFromAsset(asset(4))])).toBe(1);
    expect(flow.state.documents.map((d) => d.assetId)).toEqual([id(0x3001), id(0x3002)]);
    expect(flow.state.references.map((r) => r.assetId)).toEqual([id(0x3004)]);
    expect(REVISE_DOCUMENTS_MAX).toBe(2);
    flow.setPrompt("라벨 색을 가이드대로");
    await flow.submit();
    expect(planCalls[1]).toMatchObject({ materials: 2 });
    expect(created[0]).toMatchObject({ documents: [{ assetId: id(0x3001) }, { assetId: id(0x3002) }], references: [{ assetId: id(0x3004) }] });
    expect(flow.state.documents).toEqual([]);
  });

  it("a document never joins the reference tray", () => {
    expect(addToTray([], trayItemFromAsset(doc(1))).items).toEqual([]);
  });
});

describe("the revise panel with documents", () => {
  const view = (state: Partial<ReviseState>, props: Partial<ReviseFormViewProps> = {}) =>
    renderToStaticMarkup(
      <ReviseFormView state={{ ...initialReviseState(), phase: "ready", ...state }} version={2} copy={copy} locale="ko" recent={[]} uploading={false}
        onPrompt={noop} onReferences={noop} onMaterials={noop} onFiles={noop} resolve={() => null} onPick={noop} onSubmit={noop} onAccept={noop} {...props} />,
    );

  it("shows a document as an icon tile with its name and slide count, and one line on how it is used", () => {
    const html = view({ documents: [trayItemFromAsset(doc(1)), trayItemFromAsset(doc(2, 12))] }, { onDocuments: noop });
    expect(html).toContain(`data-revise-document="1"`);
    expect(html).toContain("가이드 1.pdf");
    expect(html).toContain(fill(copy.revise.slides, { n: 12 }));
    expect(html).not.toContain(fill(copy.revise.slides, { n: 0 }));
    expect(html).toContain(copy.revise.documentNote);
    expect(html).toContain(fill(copy.revise.removeDocument, { n: 2 }));
    expect(html).not.toContain("<img");
  });

  it("offers PDF and PPTX in the file picker and the drop line only while documents are taken", () => {
    const open = view({}, { onDocuments: noop });
    expect(open).toContain(".pdf");
    expect(open).toContain(PPTX);
    expect(open).toContain(copy.revise.dropHintDocuments);
    const closed = view({});
    expect(closed).not.toContain(".pdf");
    expect(closed).not.toContain(copy.revise.dropHintDocuments);
  });

  it("asks for a PDF export instead of an old .ppt, and names the limits with documents", () => {
    expect(isOldSlides({ name: "deck.PPT", type: "" })).toBe(true);
    expect(isOldSlides({ name: "deck.pptx", type: PPTX })).toBe(false);
    expect(isOldSlides({ name: "x", type: "application/vnd.ms-powerpoint" })).toBe(true);
    const state = { ...initialReviseState(), phase: "ready" as const };
    expect(noteLine("old_slides", state, copy)).toBe(copy.revise.oldSlides);
    expect(noteLine("attach_full_documents", state, copy)).toContain("2");
  });

  it("says under a version when attached material could not be read, and sends the documents again with the same request", () => {
    type Revision = NonNullable<StudioJobView["revision"]>;
    const rev = (patch: Partial<Revision>): Revision => ({ rootJobId: job(1).id, version: 2, baseOutputId: output(1).id, mode: "edit", added: 0, ...patch });
    const v1 = job(1, { kind: "video", outputs: [output(1, { kind: "video" })] });
    const v2 = job(2, { kind: "video_remix", prompt: "라벨 색을 가이드대로", outputs: [output(2, { kind: "video" })], revision: rev({ unread: 1, documents: [{ assetId: id(0x3001) }] }) });
    const versions = chainOf([v2, v1], v2);
    const html = renderToStaticMarkup(<VersionStrip versions={versions} selected={2} copy={copy} onSelect={noop} />);
    expect(html).toContain("data-revision-unread");
    expect(html).toContain(fill(copy.revise.unread, { n: 1 }));
    expect(renderToStaticMarkup(<VersionStrip versions={versions} selected={1} copy={copy} onSelect={noop} />)).not.toContain("data-revision-unread");
    expect(reviseRerunInput(v2, { organizationId: ORG, requestId: "r".repeat(8) })).toMatchObject({ documents: [{ assetId: id(0x3001) }] });
  });
});

describe("a document in the library rail", () => {
  it("is an icon tile that opens rather than attaches, with its slide count", () => {
    const library = getDictionary("ko").studioLibrary;
    const item = itemOfAsset(doc(1, 8));
    const html = renderToStaticMarkup(<Thumb item={item} copy={library} draggable attachOnPress onAttach={noop} onView={noop} />);
    expect(html).toContain('data-document=""');
    expect(html).toContain(fill(library.item.slides, { n: 8 }));
    expect(html).toContain(fill(library.item.view, { name: "가이드 1.pdf" }));
    expect(html).not.toContain(fill(library.item.attach, { name: "가이드 1.pdf" }));
  });
});

describe("the upload type of a document", () => {
  it("falls back to the extension when the browser reports an unknown type (Hancom's PDF type on Windows, or none)", async () => {
    const { uploadMime, uploadProblem } = await import("@/components/brand-studio/api");
    expect(uploadMime({ name: "Guide.PDF", type: "application/haansoftpdf" })).toBe("application/pdf");
    expect(uploadMime({ name: "deck.pptx", type: "" })).toBe(PPTX);
    expect(uploadMime({ name: "photo.png", type: "image/png" })).toBe("image/png");
    expect(uploadMime({ name: "notes.txt", type: "text/plain" })).toBe("text/plain");
    expect(uploadProblem({ name: "Guide.pdf", type: "application/haansoftpdf", size: 1000 })).toBeNull();
    expect(uploadProblem({ name: "Guide.pdf", type: "application/haansoftpdf", size: 20_000_001 })).toBe("file_too_large");
  });
});
