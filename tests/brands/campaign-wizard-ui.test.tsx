import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * docs/PLATFORM-2.0.md §16.3–16.4 rendered from the real components: the five wizard steps, the
 * campaign timeline and tabs, the applicants tab (applied shown, preference only, never a selection
 * control), the payment tab, the closed notes while the rollout flags are off, and the redirects
 * from the former participant and payment pages.
 */
const nav = vi.hoisted(() => ({ redirects: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/projects/new",
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => { nav.redirects.push(to); },
  notFound: vi.fn(),
}));
import { CampaignWizard, type WizardFormat } from "@/components/brand-workspace/campaign-wizard";
import { CampaignApplicants, CampaignPayments } from "@/components/brand-workspace/campaign-sections";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { CampaignFields } from "@/components/admin/campaign-fields";
import { campaignBriefLines } from "@/components/admin/campaign-prefill";
import { campaignPrefillFromTerms, termsFromDraft, type WizardDraft } from "@/lib/brands/workspace/campaign-terms";
import BrandParticipants from "@/app/(brand)/brand/projects/[id]/participants/page";
import FundingProject from "@/app/(brand)/brand/projects/[id]/funding/page";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { BrandProjectDetail } from "@/lib/brands/workspace/types";
import type { ProjectApplicantCampaign } from "@/lib/campaigns/collaboration/service";

const dict = getDictionary("ko"), b = dict.brandWorkspace, t = b.wizard;
const org = [{ id: "11111111-1111-4111-8111-111111111111", name: "브랜드" }];
const formats: WizardFormat[] = [
  { slug: "mirror-dance", title: "거울 댄스", source: "yagi", authorHandle: null, poster: null, video: null },
  { slug: "street-cut", title: "스트리트 컷", source: "community", authorHandle: "maker", poster: null, video: null },
];
const draft: WizardDraft = {
  version: 1, step: "review", title: "가을 신제품 캠페인", objective: "신제품 립 컬러를 알린다",
  format: { kind: "template", slug: "mirror-dance", source: "yagi" },
  reward: { model: "hybrid", rewardMinKrw: 100000, rewardMaxKrw: 300000, perThousandViewsKrw: 2000, totalBudgetKrw: 3000000, taxBasis: "excluded", slots: 10 },
  audience: { mode: "criteria", platforms: ["instagram"], minFollowers: 3000, gender: "female", regions: ["서울"] },
  schedule: { applicationsCloseOn: "2099-11-10", postDeadlineOn: "2099-11-24", hashtags: ["신제품"], mentions: ["brand"], disclosure: true, prohibited: "경쟁사 언급 금지" },
};
const wizard = (step: WizardDraft["step"]) => renderToStaticMarkup(<CampaignWizard b={b} locale="ko" organizations={org} formats={formats} initial={{ ...draft, step }} />);

describe("campaign wizard", () => {
  it("lists five steps, marks the current one, and gives the step heading focusable for moves", () => {
    const html = wizard("reward");
    for (const s of Object.values(t.steps)) expect(html).toContain(s);
    expect(html).toContain('data-campaign-wizard="reward"');
    expect(html).toMatch(/<li data-wizard-step-state="current" aria-current="step">/);
    expect(html).toMatch(/<h2 id="wizard-heading" tabindex="-1">/);
    // Earlier steps are buttons (keyboard reachable), later ones are not links to skip ahead.
    expect(html).toMatch(/data-wizard-step-state="done"><button type="button"/);
    expect(html).not.toMatch(/data-wizard-step-state="upcoming"><button/);
  });

  it("shows originals and creator formats as cards in two groups, plus the brand-only request", () => {
    const html = wizard("format");
    expect(html).toContain('data-wizard-formats="yagi"');
    expect(html).toContain('data-wizard-formats="community"');
    expect(html).toContain('data-wizard-format="mirror-dance"');
    expect(html).toContain("@maker");
    expect(html).toContain('data-wizard-format="custom"');
    expect(html).toContain(t.format.originals);
    expect(html).toContain(t.format.creators);
    expect(html).toContain('aspect-ratio:4 / 5');
  });

  it("offers the existing payout models and shows the budget check", () => {
    const html = wizard("reward");
    for (const m of Object.values(t.reward.models)) expect(html).toContain(m);
    expect(html).toContain("data-wizard-budget-check");
  });

  it("keeps the ad label fixed on: checked and disabled, with the reason", () => {
    const html = wizard("schedule");
    expect(html).toContain('data-wizard-disclosure="fixed"');
    const box = html.match(/<input type="checkbox"[^>]*aria-describedby="wizard-disclosure-hint"[^>]*>/)![0];
    expect(box).toContain('checked=""');
    expect(box).toContain('disabled=""');
    expect(html).toContain(t.schedule.disclosureFixed);
  });

  it("summarizes the request and sends it through project.create", () => {
    const html = wizard("review");
    expect(html).toContain("data-wizard-review");
    expect(html).toContain("data-campaign-terms");
    expect(html).toContain("거울 댄스");
    expect(html).toContain(t.review.send);
    expect(html).toContain('action="/api/brand-workspace"');
    expect(html).toContain("경쟁사 언급 금지");
    // Each part has a way back to its step.
    expect(html.match(new RegExp(t.edit, "g"))!.length).toBeGreaterThanOrEqual(4);
  });
});

const project: BrandProjectDetail = {
  id: "22222222-2222-4222-8222-222222222222", organizationId: org[0]!.id, organizationName: "브랜드", title: "가을 신제품 캠페인", objective: "신제품을 알린다",
  audience: "", budgetKrw: 3000000, budgetTaxBasis: "excluded",
  criteria: { platforms: ["instagram"], minFollowers: 3000, maxFollowers: null, primaryMetric: "views", targetValue: null },
  startsOn: null, endsOn: "2099-11-24", productionMode: "creator", status: "requested", revision: 0,
  createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z", role: "owner", canComment: true, referenceLinks: [],
  contents: [], decisions: [], messages: [], posts: [], attachments: [], reports: [], contracts: [], contractUploads: [],
  campaignTerms: termsFromDraft(draft),
};

describe("campaign page", () => {
  it("opens on the timeline with the request in the brief tab", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" applicants={<section id="applicants" />} payments={<section id="payments" />} />);
    expect(html).toContain('data-campaign-timeline="review"');
    expect(html).toMatch(/data-stage="review" data-stage-state="current" aria-current="step"/);
    expect(html).toContain("data-campaign-terms");
    const tabs = [...html.matchAll(/<nav class="bw-tabs"[\s\S]*?<\/nav>/g)][0]![0].match(/href="#([a-z]+)"/g)!.map((h) => h.slice(7, -1));
    expect(tabs).toEqual(["performance", "brief", "review", "applicants", "payments", "reports", "conversation", "contracts"]);
    expect(html).toContain(b.tabs.overview);
    expect(html).toContain(b.tabs.filesConversation);
  });

  it("has no applicants or payment tab for campaign guests and the TWINGS view", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={{ ...project, role: "viewer" }} b={b} locale="ko" />);
    expect(html).not.toContain('href="#applicants"');
    expect(html).not.toContain('href="#payments"');
  });
});

const campaigns: ProjectApplicantCampaign[] = [{
  id: "33333333-3333-4333-8333-333333333333", slug: "autumn", title: { en: "Autumn", ko: "가을" }, status: "recruiting", slots: 5,
  applicants: [
    { id: "a1", status: "applied", handle: "creator.a", platform: "instagram", followers: 4200, followersSource: "self", profileUrl: "https://www.instagram.com/creator.a/", pitch: "카페 리뷰를 올려요", appliedAt: "2026-10-23T00:00:00Z", preferred: true, postUrl: null, views: null, metricsSource: null, invited: true },
    { id: "a2", status: "posted", handle: "creator.b", platform: "tiktok", followers: 9100, followersSource: "self", profileUrl: "https://www.tiktok.com/@creator.b", pitch: "pitch", appliedAt: "2026-10-23T00:00:00Z", preferred: false, postUrl: "https://www.tiktok.com/@creator.b/video/1", views: 12000, metricsSource: "self", invited: false },
  ],
  invited: [
    { id: "i1", handle: "creator.a", platform: "instagram", status: "accepted", invitedAt: "2026-10-22T00:00:00Z" },
    { id: "i2", handle: "pool.waiting", platform: "tiktok", status: "pending", invitedAt: "2026-10-22T00:00:00Z" },
    { id: "i3", handle: null, platform: null, status: "pending", invitedAt: "2026-10-22T00:00:00Z" },
  ],
}];

describe("applicants tab", () => {
  const render = (canPrefer: boolean) => renderToStaticMarkup(<CampaignApplicants view={{ canPrefer, campaigns }} invitations={[]} canInvite={false} b={b} locale="ko" projectId={project.id} />);

  it("marks people invited from the creator pool (docs/PLATFORM-2.0.md §17.3)", () => {
    const html = render(true);
    expect(html).toContain('data-applicant-invited="true"');
    expect((html.match(/data-applicant-invited=/g) ?? []).length).toBe(1);
    expect(html).toContain("data-invited-creators");
    expect(html).toContain('data-invited-state="pending"');
    expect(html).toContain("@pool.waiting");
    expect(html).toContain("초대됨 · 아직 지원 전");
    expect(html).toContain("지금은 풀에 없는 크리에이터");
    const pool = renderToStaticMarkup(<CampaignApplicants view={{ canPrefer: true, campaigns }} invitations={[]} canInvite b={b} locale="ko" projectId={project.id} poolHref="/brand/creators?organizationId=x" />);
    expect(pool).toContain('href="/brand/creators?organizationId=x"');
    expect(render(true)).not.toContain('href="/brand/creators');
  });

  it("shows applied applicants with handle, followers and their source, profile and message", () => {
    const html = render(true);
    expect(html).toContain("@creator.a");
    expect(html).toContain("팔로워 4,200명");
    expect(html).toContain(`(${b.applicants.sources.self})`);
    expect(html).toContain('href="https://www.instagram.com/creator.a/"');
    expect(html).toContain("카페 리뷰를 올려요");
    expect(html).toContain('data-preferred="true"');
  });

  it("offers a preference toggle to writers only, and never a selection control", () => {
    const writer = render(true), reader = render(false);
    expect(writer).toContain('data-applicant-prefer="on"');
    expect(writer).toContain('aria-pressed="true"');
    expect(reader).not.toContain('data-applicant-prefer="');
    for (const html of [writer, reader]) {
      expect(html).not.toMatch(/application\.select|선정하기|Select creator/);
      expect(html.match(/<button/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("shows selected creators' status, post link and views with where they came from", () => {
    const html = render(false);
    expect(html).toContain(b.applicants.states.posted);
    expect(html).toContain('href="https://www.tiktok.com/@creator.b/video/1"');
    expect(html).toContain("조회수 12,000");
    expect(html).toContain('data-metrics-source="self"');
    expect(html).toContain(`href="/brand/projects/${project.id}/participants/a2"`);
  });

  it("explains when it opens while the collaboration rollout is off", () => {
    const html = renderToStaticMarkup(<CampaignApplicants view={null} invitations={[]} canInvite={false} b={b} locale="ko" projectId={project.id} />);
    expect(html).toContain("data-applicants-closed");
    expect(html).toContain(b.applicants.closed);
    expect(html).not.toContain("bw-applicant-list");
  });
});

describe("payment tab", () => {
  it("explains when it opens while the funding rollout is off", () => {
    const html = renderToStaticMarkup(<CampaignPayments view={null} rollout={false} enabled={false} failed={false} b={b} locale="ko" projectId={project.id} />);
    expect(html).toContain('data-campaign-funding="closed"');
    expect(html).toContain(b.payments.closed);
  });

  it("lays quote → accept → pay → receipt out in one tab, and closes actions while payment is not open", () => {
    const view = {
      ready: true as const, canBuy: true, canPropose: true, campaigns: [], proposals: [],
      items: [{ id: "case", status: "quoted", quote: { id: "q", revision: 1, status: "proposed", totalKrw: 1100000, taxBasis: "부가세 포함", termsSummary: "범위", termsRef: "v1", validUntil: "2099-01-01T00:00:00Z" }, quotes: [], payments: [] }],
    } as unknown as Parameters<typeof CampaignPayments>[0]["view"];
    const html = renderToStaticMarkup(<CampaignPayments view={view} rollout enabled={false} failed b={b} locale="ko" projectId={project.id} />);
    for (const s of Object.values(b.payments.steps)) expect(html).toContain(s);
    expect(html).toContain(b.payments.paymentsClosed);
    expect(html).toContain(b.payments.failed);
    expect(html).toContain("1,100,000");
    expect(html).not.toContain(b.payments.accept);
  });
});

describe("former pages", () => {
  beforeEach(() => { nav.redirects.length = 0; });
  const target = async (page: Promise<unknown>) => { await page; return nav.redirects.at(-1) ?? null; };

  it("send the participants page to the applicants tab", async () => {
    expect(await target(BrandParticipants({ params: Promise.resolve({ id: project.id }) }))).toBe(`/brand/projects/${project.id}#applicants`);
  });

  it("send the funding page to the payment tab, keeping only the provider's failure flag", async () => {
    expect(await target(FundingProject({ params: Promise.resolve({ id: project.id }), searchParams: Promise.resolve({}) }))).toBe(`/brand/projects/${project.id}#payments`);
    expect(await target(FundingProject({ params: Promise.resolve({ id: project.id }), searchParams: Promise.resolve({ failed: "1" }) }))).toBe(`/brand/projects/${project.id}?failed=1#payments`);
  });
});

describe("admin campaign form", () => {
  it("starts from the brand request and leaves the English side empty", () => {
    const prefill = campaignPrefillFromTerms({ title: project.title, objective: project.objective, organizationName: "브랜드" }, project.campaignTerms!, campaignBriefLines);
    const html = renderToStaticMarkup(<CampaignFields row={null} prefill={prefill} dict={dict} styleSlugs={[]} />);
    expect(html).toContain('value="mirror-dance"');
    expect(html).toContain('value="브랜드"');
    expect(html).toMatch(/name="slots"[^>]*value="10"/);
    expect(html).toContain('value="2099-11-10T23:59"');
    expect(html).toContain('value="2099-11-24T23:59"');
    expect(html).toContain('value="#신제품"'.replace("#", ""));
    expect(html).toContain("가을 신제품 캠페인");
    expect(html).toContain("성별: 여성");
    expect(html).toContain("하면 안 되는 것: 경쟁사 언급 금지");
    expect(html).toMatch(/name="payoutModel"[^>]*>[\s\S]*?<option value="hybrid" selected=""/);
    expect(html).toMatch(/name="disclosure" checked=""/);
  });
});
