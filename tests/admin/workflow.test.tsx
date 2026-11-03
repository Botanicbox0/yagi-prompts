import { describe, expect, it, vi } from "vitest";
import { prerender } from "react-dom/static";
import {
  campaignWorkCounts,
  ADMIN_NAV_GROUPS,
  ADMIN_NAV_PATHS,
} from "@/lib/admin/workflow";
import { adminNextActions } from "@/lib/admin/queues";
import { campaignWorkflow } from "@/lib/admin/campaign-workflow";
import type { ApplicationRow, CampaignRow } from "@/lib/campaigns/repo";
import type { CampaignProductionAdmin } from "@/lib/campaigns/production-admin";
import { CampaignWorkflow } from "@/components/admin/campaign-workflow";
import { getDictionary } from "@/lib/i18n/dictionaries";
vi.mock("@/lib/routing/request-surface", () => ({
  requestSurface: async () => ({ admin: true }),
  publicHref: (path: string) => `https://twings.app${path}`,
}));
import { AdminShell } from "@/components/admin/chrome";

const campaign: CampaignRow = {
  id: "campaign",
  slug: "campaign",
  status: "draft",
  hostName: "Brand",
  hostKind: "brand",
  hostUrl: null,
  media: null,
  styleSlug: null,
  platforms: ["instagram"],
  deliverable: "reel",
  requirements: { hashtags: [], mentions: [], disclosure: true },
  budgetCents: null,
  createdAt: null,
  publishedAt: null,
  title: { en: "Campaign", ko: "캠페인" },
  summary: { en: "Brief", ko: "안내" },
  brief: null,
  applicationsCloseAt: "2026-11-01",
  postDeadlineAt: "2026-11-10",
  slots: 2,
  payout: {
    model: "flat",
    flatCents: 10000,
    perThousandViewsCents: 0,
    minCents: 0,
    maxCents: null,
    holdDays: 7,
    currency: "KRW",
  },
};
const application = (status: ApplicationRow["status"]) =>
  ({ status }) as ApplicationRow;
const production: CampaignProductionAdmin = {
  ready: true,
  open: true,
  config: {
    contractId: "contract",
    templateId: "template",
    enabled: true,
    revision: 1,
    referenceAttachmentIds: [],
  },
  formats: [
    {
      contractId: "contract",
      templateId: "template",
      projectId: "project",
      title: "Format",
      titleKo: "포맷",
      contractTitle: "Contract",
      projectTitle: "Project",
    },
  ],
  references: [],
  jobs: [],
};

describe("admin task queues", () => {
  it("counts applications and posted links separately, and only offers nonempty queues", () => {
    const work = campaignWorkCounts([
      {
        applied: 2,
        selected: 3,
        posted: 4,
        verified: 5,
        paid: 6,
        slotsTaken: 18,
      },
    ]);
    expect(work).toEqual({ applicants: 2, posts: 4 });
    const actions = adminNextActions({
      ...work,
      payouts: 0,
      studio: 1,
      inquiries: 0,
      feedback: 0,
      templates: 0,
    });
    // docs/ADMIN.md §2.2: a brand waiting on a reply ranks above the campaign checks.
    expect(actions.map((a) => [a.key, a.count])).toEqual([
      ["studio", 1],
      ["posts", 4],
      ["applicants", 2],
    ]);
    expect(actions.every((a) => a.href.startsWith("/admin/"))).toBe(true);
  });
  it("does not invent tasks for empty sources", () => {
    expect(
      adminNextActions({
        posts: 0,
        applicants: 0,
        payouts: 0,
        studio: 0,
        inquiries: 0,
        feedback: 0,
        templates: 0,
      }),
    ).toEqual([]);
  });
  it.each(["ko", "en"] as const)(
    "exposes every menu route once, with its name and group, in %s",
    async (locale) => {
      const dict = getDictionary(locale);
      const { prelude } = await prerender(
        <AdminShell dict={dict.admin} locale={locale} active="campaigns">
          <p>Content</p>
        </AdminShell>,
      );
      const html = await new Response(prelude).text();
      const keys = ADMIN_NAV_GROUPS.flatMap((group) => [...group.items]);
      expect(new Set(keys).size).toBe(Object.keys(ADMIN_NAV_PATHS).length);
      for (const key of keys) {
        expect(html).toContain(`href="${ADMIN_NAV_PATHS[key]}"`);
        // React escapes ampersands in English names.
        expect(html).toContain(dict.adminConsole.nav[key].replaceAll("&", "&amp;"));
      }
      for (const group of ADMIN_NAV_GROUPS) {
        expect(html).toContain(dict.adminConsole.groups[group.key].replaceAll("&", "&amp;"));
      }
      // Contests is reachable from the menu now; the old product's screens are not (docs/ADMIN.md §2.1).
      expect(html).toContain('href="/admin/contests"');
      expect(html).not.toContain('href="/admin/playbooks"');
      expect(html).not.toContain('href="/admin/policy"');
      expect(html).toContain(`href="#main"`);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    },
  );
});

describe("campaign workflow uses recorded facts", () => {
  it("does not infer production or payments from a reward rule and selected participant", () => {
    const stages = campaignWorkflow(campaign, [application("selected")], null);
    expect(stages.find((s) => s.key === "production")?.state).toBe("blocked");
    expect(stages.find((s) => s.key === "reward")?.state).toBe("done");
    expect(stages.find((s) => s.key === "payments")?.state).toBe("waiting");
  });
  it("keeps post review and pending applicants actionable despite prior completed participants", () => {
    const stages = campaignWorkflow(
      campaign,
      [application("paid"), application("posted"), application("applied")],
      production,
    );
    expect(stages.find((s) => s.key === "posts")?.state).toBe("active");
    expect(stages.find((s) => s.key === "participants")?.state).toBe("active");
    expect(stages.find((s) => s.key === "payments")?.state).toBe("active");
  });
  it("does not mark all payments complete while a selected or rejected participant remains", () => {
    for (const status of ["selected", "rejected", "verified"] as const) {
      expect(
        campaignWorkflow(
          campaign,
          [application("paid"), application(status)],
          production,
        ).find((s) => s.key === "payments")?.state,
      ).not.toBe("done");
    }
    expect(
      campaignWorkflow(
        campaign,
        [application("paid"), application("declined")],
        production,
      ).find((s) => s.key === "payments")?.state,
    ).toBe("done");
  });
  it("blocks production when disabled, unavailable, not rolled out or the configured template has no matching contract", () => {
    for (const data of [
      { ...production, ready: false },
      { ...production, open: false },
      { ...production, config: { ...production.config!, enabled: false } },
      { ...production, formats: [] },
    ]) {
      expect(
        campaignWorkflow(campaign, [], data).find((s) => s.key === "production")
          ?.state,
      ).toBe("blocked");
    }
  });
  it("links workflow checks to the existing sections, with localized state text", async () => {
    const stages = campaignWorkflow(
      { ...campaign, payout: null },
      [],
      production,
    );
    const { prelude } = await prerender(
      <CampaignWorkflow
        stages={stages}
        copy={getDictionary("ko").adminWorkflow}
      />,
    );
    const html = await new Response(prelude).text();
    expect(html).toContain("data-campaign-stepper");
    expect(html).toContain('data-campaign-stage="reward" data-state="blocked"');
    for (const anchor of [
      "campaign-editor",
      "campaign-production",
      "campaign-applicants",
      "campaign-posts",
      "campaign-payments",
    ])
      expect(html).toContain(`href="#${anchor}"`);
    expect(html).toContain(getDictionary("ko").adminWorkflow.states.blocked);
  });
});
