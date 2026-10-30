import { describe, expect, it } from "vitest";
import writeExcelFile from "write-excel-file/node";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { shortlistSheet, shortlistStatus } from "@/lib/brands/shortlist/export";
import type { ShortlistCandidate } from "@/lib/brands/shortlist/service";

const base: ShortlistCandidate = {
  id: "1", platform: "instagram", handle: "fixture.one", displayName: "Fixture One", category: "Beauty",
  avatarUrl: "/api/secret-avatar", avatarTone: "#112233", measuredOn: "2026-10-27",
  metrics: { followers: 12000, viewsMedian90d: 3400, reelsEngagementRate: 4.25 }, picked: false, passed: false, confirmed: false,
};
const copy = getDictionary("en").brandWorkspace.shortlist;

describe("shortlist Excel export", () => {
  it("writes one row per candidate, with the choice on screen and exact figures", () => {
    const sheet = shortlistSheet([base, { ...base, id: "2", handle: "fixture.two", displayName: null, category: null, metrics: {}, measuredOn: null }], new Map([["1", "picked"]]), copy);
    expect(sheet).toHaveLength(3);
    const header = sheet[0]!.map(cell => cell?.value);
    const at = (name: string) => header.indexOf(name);
    expect(header.slice(0, 5)).toEqual([copy.exportColumns.name, copy.exportColumns.handle, copy.exportColumns.profile, copy.exportColumns.category, copy.exportColumns.status]);
    const first = sheet[1]!;
    expect(first[0]!.value).toBe("Fixture One");
    expect(first[1]!.value).toBe("@fixture.one");
    expect(first[2]!.value).toBe("https://www.instagram.com/fixture.one/");
    expect(first[4]!.value).toBe(copy.tabs.picked);
    expect(first[at(copy.followers)]!.value).toBe(12000);
    expect(first[at(copy.viewsMedian)]!.value).toBe(3400);
  });
  it("leaves unknown figures empty, never 0", () => {
    const [, row] = shortlistSheet([{ ...base, metrics: {} }], new Map(), copy);
    const header = shortlistSheet([base], new Map(), copy)[0]!.map(cell => cell?.value);
    expect(row![header.indexOf(copy.followers)]).toBeNull();
  });
  it("carries no picture, internal id or recruiting detail", () => {
    const text = JSON.stringify(shortlistSheet([base], new Map(), copy));
    expect(text).not.toContain("secret-avatar");
    expect(text).not.toContain("#112233");
    expect(text).not.toMatch(/brandazine|\bfee\b|\bcost\b/i);
  });
  it("names the booked state over the brand's own mark", () => {
    expect(shortlistStatus({ ...base, confirmed: true }, "picked", copy)).toBe(copy.tabs.confirmed);
    expect(shortlistStatus(base, "passed", copy)).toBe(copy.tabs.passed);
    expect(shortlistStatus(base, "none", copy)).toBe(copy.tabs.open);
  });
  it("produces a real xlsx workbook", async () => {
    const buffer = await writeExcelFile(shortlistSheet([base], new Map(), getDictionary("ko").brandWorkspace.shortlist)).toBuffer();
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });
});
