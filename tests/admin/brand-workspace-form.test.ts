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
  it("does not silently round decimal metrics before schema validation", () => {
    const result = parse({ views: "1.5" });
    if (result.ok) expect(result.value.views).toBe(1.5);
    else throw Error("unexpected parser failure");
  });
});
