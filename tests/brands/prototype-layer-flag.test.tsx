import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/projects/p",
  useSearchParams: () => new URLSearchParams(),
}));

import { brandWorkspacePrototypeLayerOpen } from "@/lib/flags";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { buildProjectPrototypeLayer } from "@/components/brand-workspace/project-prototype-layer";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { BrandProjectDetail } from "@/lib/brands/workspace/types";

const ROOT = process.cwd();

const project: BrandProjectDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  organizationName: "Demo Brand",
  title: "Autumn Lookbook",
  objective: "Create launch visuals",
  audience: "",
  budgetKrw: null,
  budgetTaxBasis: "unspecified",
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null },
  startsOn: null,
  endsOn: null,
  productionMode: "studio",
  status: "active",
  revision: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  role: "editor",
  canComment: true,
  referenceLinks: [],
  contents: [],
  decisions: [],
  messages: [],
  posts: [],
  attachments: [],
  reports: [],
  contracts: [],
  contractUploads: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BRAND_WORKSPACE_PROTOTYPE_LAYER", () => {
  it("is off by default and on only for exactly 'on'", () => {
    expect(brandWorkspacePrototypeLayerOpen({})).toBe(false);
    expect(brandWorkspacePrototypeLayerOpen({ BRAND_WORKSPACE_PROTOTYPE_LAYER: undefined })).toBe(false);
    expect(brandWorkspacePrototypeLayerOpen({ BRAND_WORKSPACE_PROTOTYPE_LAYER: "" })).toBe(false);
    expect(brandWorkspacePrototypeLayerOpen({ BRAND_WORKSPACE_PROTOTYPE_LAYER: "off" })).toBe(false);
    expect(brandWorkspacePrototypeLayerOpen({ BRAND_WORKSPACE_PROTOTYPE_LAYER: "ON" })).toBe(false);
    expect(brandWorkspacePrototypeLayerOpen({ BRAND_WORKSPACE_PROTOTYPE_LAYER: "true" })).toBe(false);
    expect(brandWorkspacePrototypeLayerOpen({ BRAND_WORKSPACE_PROTOTYPE_LAYER: "on" })).toBe(true);
  });

  it("does not statically import prototype client modules into project-detail.tsx", () => {
    const src = readFileSync(join(ROOT, "components/brand-workspace/project-detail.tsx"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/(human-handoff|brief-concierge|aesthetic-engine|review-stage)["']/);
  });

  it("flag off (default): omits all prototype panels and renders sound empty state & real content", async () => {
    vi.stubEnv("BRAND_WORKSPACE_PROTOTYPE_LAYER", "off");
    const b = getDictionary("ko").brandWorkspace;
    const layer = await buildProjectPrototypeLayer({ project, locale: "ko", generativeMediaAllowed: true });
    expect(layer).toBeNull();

    const emptyHtml = renderToStaticMarkup(
      <ProjectDetail project={project} b={b} locale="ko" generativeMediaAllowed prototypeLayer={layer} />,
    );
    expect(emptyHtml).not.toContain("data-handoff");
    expect(emptyHtml).not.toContain("data-brief-intake");
    expect(emptyHtml).not.toContain("data-aesthetic-engine");
    expect(emptyHtml).not.toContain("data-review-stage");
    expect(emptyHtml).not.toContain("data-stakeholder-share-bar");
    expect(emptyHtml).not.toContain("초반 2초 훅");
    expect(emptyHtml).not.toContain("ASAP");
    expect(emptyHtml).toContain(b.noContent);
    expect(emptyHtml).toContain(b.noMessages);

    const withRealContent: BrandProjectDetail = {
      ...project,
      contents: [
        {
          id: "c1",
          slotKey: "main",
          version: 1,
          title: "Real Draft Cut",
          attachmentId: "a1",
          mediaUrl: "/api/brand-workspace/attachments/a1",
          caption: "Hero caption",
          usageRights: "SNS 3m",
          reviewRevision: 0,
          decision: "pending",
          createdAt: "2026-10-02T00:00:00Z",
        },
      ],
      messages: [
        { id: "m1", body: "[00:04.20] Please soften the highlight on the bottle cap", authorRole: "brand", createdAt: "2026-10-02T01:00:00Z" },
      ],
      decisions: [
        { id: "d1", contentVersionId: "c1", decision: "changes_requested", comment: "00:08.50 tighter end card", revision: 1, createdAt: "2026-10-02T02:00:00Z" },
      ],
    };
    const realHtml = renderToStaticMarkup(
      <ProjectDetail project={withRealContent} b={b} locale="ko" generativeMediaAllowed prototypeLayer={layer} />,
    );
    expect(realHtml).toContain('data-content-version="c1"');
    expect(realHtml).toContain("Real Draft Cut");
    expect(realHtml).toContain("Real Draft Cut");
    // S3: Keeps real inline video player and real timecode pins without prototype share links or invented comments.
    expect(realHtml).toContain("data-real-review-player");
    expect(realHtml).toContain("/api/brand-workspace/attachments/a1");
    expect(realHtml).toContain("00:04.20");
    expect(realHtml).toContain("00:08.50");
    expect(realHtml).not.toContain("data-review-stage");
    expect(realHtml).not.toContain("data-stakeholder-share-bar");
    expect(realHtml).not.toContain("초반 2초 훅");
    expect(realHtml).not.toContain("/s/");
  });

  it("flag on: restores all four prototype blocks on eligible brands and still hides AI ones when generativeMediaAllowed=false", async () => {
    vi.stubEnv("BRAND_WORKSPACE_PROTOTYPE_LAYER", "on");
    const b = getDictionary("ko").brandWorkspace;
    const onLayer = await buildProjectPrototypeLayer({ project, locale: "ko", generativeMediaAllowed: true });
    expect(onLayer).not.toBeNull();
    const onHtml = renderToStaticMarkup(
      <ProjectDetail project={project} b={b} locale="ko" generativeMediaAllowed prototypeLayer={onLayer} />,
    );
    expect(onHtml).toContain("data-handoff");
    expect(onHtml).toContain("data-brief-intake");
    expect(onHtml).toContain("data-aesthetic-engine");
    expect(onHtml).toContain("data-review-stage");
    expect(onHtml).toContain("data-stakeholder-share-bar");

    const deniedLayer = await buildProjectPrototypeLayer({ project, locale: "ko", generativeMediaAllowed: false });
    const deniedHtml = renderToStaticMarkup(
      <ProjectDetail project={project} b={b} locale="ko" generativeMediaAllowed={false} prototypeLayer={deniedLayer} />,
    );
    expect(deniedHtml).not.toContain("data-handoff");
    expect(deniedHtml).not.toContain("data-brief-intake");
    expect(deniedHtml).not.toContain("data-aesthetic-engine");
    expect(deniedHtml).toContain("data-review-stage");
  });
});
