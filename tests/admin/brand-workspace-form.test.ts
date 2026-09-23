import { describe, expect, it } from "vitest";
import { BRAND_WORKSPACE_OPERATIONS } from "@/lib/admin/brand-workspace-operations";
describe("studio measurement form values", () => {
  const parse = (values: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(values)) form.set(k, v);
    return BRAND_WORKSPACE_OPERATIONS["brandWorkspace.post"].parse(form);
  };
  it("turns an explicitly Korean measurement time into an unambiguous UTC instant", () => {
    const result = parse({
      publishedAt: "2026-09-20T09:30",
      measuredAt: "2026-09-21T10:00",
      views: "0",
      likes: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.publishedAt).toBe("2026-09-20T00:30:00.000Z");
      expect(result.value.measuredAt).toBe("2026-09-21T01:00:00.000Z");
      expect(result.value.views).toBe(0);
      expect(result.value.likes).toBeNull();
    }
  });
  it("refuses invalid calendar dates and timestamp strings without throwing", () => {
    for (const date of [
      "not-a-date",
      "2026-02-31T10:00",
      "2026-09-20T30:00",
      "2026-09-20T09:30Z",
    ])
      expect(parse({ publishedAt: date }).ok).toBe(false);
  });
  describe("collection console batch", () => {
    const P1 = "a0000000-0000-4000-8000-000000000001";
    const P2 = "a0000000-0000-4000-8000-000000000002";
    const table = (extra: Array<[string, string]>) => {
      const form = new FormData();
      form.set("projectId", "b0000000-0000-4000-8000-000000000001");
      form.set("requestId", "c0000000-0000-4000-8000-000000000001");
      for (const [id, views] of [
        [P1, "0"],
        [P2, "250"],
      ] as const) {
        form.set(`rev:${id}`, "2");
        form.set(`verification:${id}`, "manual");
        form.set(`metricsSource:${id}`, "studio_review");
        form.set(`views:${id}`, views);
        for (const k of ["likes", "comments", "shares", "saves"])
          form.set(`${k}:${id}`, "");
      }
      for (const [k, v] of extra) form.append(k, v);
      return form;
    };
    const parseBatch = (form: FormData) =>
      BRAND_WORKSPACE_OPERATIONS["brandWorkspace.metricsBatch"].parse(form);
    it("is registered behind the one guarded admin door", async () => {
      const { ADMIN_OPERATION_NAMES } = await import("@/lib/admin/operations");
      expect(ADMIN_OPERATION_NAMES).toContain("brandWorkspace.metricsBatch");
      expect(ADMIN_OPERATION_NAMES).toContain("brandWorkspace.metrics");
    });
    it("reads only ticked rows, keeps zero apart from blank and never reads a time", () => {
      const result = parseBatch(
        table([
          ["select", P1],
          ["measuredAt", "2020-01-01T00:00"],
        ]),
      );
      if (!result.ok) throw Error(result.detail);
      expect(result.value).toEqual({
        projectId: "b0000000-0000-4000-8000-000000000001",
        requestId: "c0000000-0000-4000-8000-000000000001",
        rows: [
          {
            postId: P1,
            expectedRevision: 2,
            verification: "manual",
            metricsSource: "studio_review",
            // Unticked abbreviated-count box: the zero is an exact observation.
            viewsApproximate: false,
            views: 0,
            likes: null,
            comments: null,
            shares: null,
            saves: null,
          },
        ],
      });
    });
    it("a row's own save button saves that row alone, whatever else is ticked", () => {
      const result = parseBatch(
        table([
          ["select", P1],
          ["only", P2],
        ]),
      );
      if (!result.ok) throw Error(result.detail);
      const rows = result.value.rows as Array<{ postId: string; views: number }>;
      expect(rows.map((r) => [r.postId, r.views])).toEqual([[P2, 250]]);
    });
    it("refuses a save with nothing selected or a selected row whose cells are missing", () => {
      expect(parseBatch(table([])).ok).toBe(false);
      const form = table([["select", P1]]);
      form.delete(`saves:${P1}`);
      expect(parseBatch(form).ok).toBe(false);
    });
  });
  it("does not silently round decimal metrics before schema validation", () => {
    const result = parse({ views: "1.5" });
    if (result.ok) expect(result.value.views).toBe(1.5);
    else throw Error("unexpected parser failure");
  });
});
