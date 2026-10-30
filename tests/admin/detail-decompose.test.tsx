import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("admin detail screen decomposition and unwired operation coverage", () => {
  it("decomposes /admin/campaigns/[id] with AdminSectionNav and folds the campaign.update editor", () => {
    const src = read("app", "(admin)", "admin", "campaigns", "[id]", "page.tsx");
    expect(src).toContain("AdminSectionNav");
    expect(src).toContain('id="applications"');
    expect(src).toContain('id="posts"');
    expect(src).toContain("AdminFold");
    // Active applicant and post review queues appear before the folded campaign.update editor
    expect(src.indexOf('id="applications"')).toBeLessThan(
      src.indexOf('op="campaign.update"'),
    );
    expect(src.indexOf('id="posts"')).toBeLessThan(
      src.indexOf('op="campaign.update"'),
    );
  });

  it("surfaces contest entry moderation (#entries) before folded contest.update and contest.create forms on /admin/contests", () => {
    const src = read("app", "(admin)", "admin", "contests", "page.tsx");
    expect(src).toContain('id="entries"');
    expect(src).toContain("AdminFold");
    expect(src.indexOf('id="entries"')).toBeLessThan(
      src.indexOf('op="contest.update"'),
    );
  });

  it("hides client-only HumanHandoff widget when ProjectDetail is rendered in studio mode and adds section navigation to /admin/brand-workspace/[id]", () => {
    const detail = read("components", "brand-workspace", "project-detail.tsx");
    expect(detail).toMatch(/!studio\s*&&\s*\(?\s*<HumanHandoff/);

    const studioPage = read(
      "app",
      "(admin)",
      "admin",
      "brand-workspace",
      "[id]",
      "page.tsx",
    );
    expect(studioPage).toContain("AdminSectionNav");
    expect(studioPage).toContain("AdminFold");
  });

  it("wires brandWorkspace.settings on the studio organization page and campaignCollaboration.revoke in collaboration admin", () => {
    const orgPage = read(
      "app",
      "(admin)",
      "admin",
      "brand-workspace",
      "organizations",
      "[id]",
      "page.tsx",
    );
    expect(orgPage).toContain('op="brandWorkspace.settings"');

    const collabAdmin = read(
      "components",
      "campaigns",
      "collaboration-admin.tsx",
    );
    expect(collabAdmin).toContain('op="campaignCollaboration.revoke"');
  });
});
