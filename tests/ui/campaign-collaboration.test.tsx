import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ParticipantDetail } from "@/components/campaigns/participant-detail";
import { InvitationTerms } from "@/components/campaigns/invitation-terms";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { CreatorCampaign } from "@/lib/campaigns/service";
import {
  InvitationForm,
  ParticipantForms,
} from "@/components/campaigns/collaboration-forms";
import type { Participation } from "@/lib/campaigns/collaboration/service";
import {
  campaignCollaborationKo,
  campaignCollaborationEn,
} from "@/messages/campaign-collaboration";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const p: Participation = {
  id: "a",
  campaignId: "c",
  projectId: "p",
  slug: "test",
  title: { ko: "테스트 캠페인", en: "Test campaign" },
  status: "selected",
  role: "creator",
  canWrite: true,
  threadOpen: true,
  postUrl: null,
  messages: [
    {
      id: "m",
      role: "brand",
      body: "<script>unsafe instruction</script>",
      createdAt: "2026-10-16T00:00:00Z",
    },
  ],
  files: [
    {
      id: "f",
      name: "brief.pdf",
      mime: "application/pdf",
      sizeBytes: 2048,
      href: "/api/campaign-collaboration/files/f",
      role: "brand",
      createdAt: "2026-10-16T00:00:00Z",
    },
  ],
};
describe("participant workspace rendering", () => {
  it("renders the complete rich brief and Korea-time deadlines before consent", () => {
    const campaign: CreatorCampaign = {
      id: "c",
      slug: "test",
      status: "recruiting",
      hostName: "Test brand",
      hostKind: "brand",
      hostUrl: null,
      styleSlug: null,
      publishedAt: null,
      title: { ko: "테스트", en: "Test" },
      summary: { ko: "요약", en: "Summary" },
      brief: {
        ko: "## 필수 게시 안내\n**제품**을 설명하세요.",
        en: "## Required post\nShow the **product**.",
      },
      payout: null,
      platforms: ["instagram"],
      deliverable: "reel",
      slots: 30,
      slotsTaken: 1,
      applicationsCloseAt: "2026-10-19T15:00:00Z",
      postDeadlineAt: "2026-10-29T15:00:00Z",
      requirements: { disclosure: true, hashtags: ["광고"], mentions: [] },
    };
    const html = renderToStaticMarkup(
      <InvitationTerms
        campaign={campaign}
        locale="ko"
        dict={getDictionary("ko")}
      />,
    );
    expect(html).toContain("필수 게시 안내");
    expect(html).toContain("<strong");
    expect(html).toContain("제품");
    expect(html).toContain("2026년 10월 20일");
    expect(html).toContain("2026년 10월 30일");
    expect(html).not.toContain("2026년 10월 19일");
  });
  it("escapes message content, shows authenticated files and preserves creator next steps", () => {
    const html = renderToStaticMarkup(
      <ParticipantDetail participation={p} locale="ko" />,
    );
    expect(html).toContain("&lt;script&gt;unsafe instruction&lt;/script&gt;");
    expect(html).not.toContain("<script>unsafe");
    expect(html).toContain('href="/api/campaign-collaboration/files/f"');
    expect(html).toContain('href="/campaigns/test/make"');
    expect(html).toContain('href="/campaigns/mine"');
    expect(html).toContain('name="body"');
    expect(html).toContain('name="file"');
  });
  it("keeps applied state separate from selection and shared content", () => {
    const html = renderToStaticMarkup(
      <ParticipantDetail
        participation={{
          ...p,
          status: "applied",
          threadOpen: false,
          canWrite: false,
          messages: [],
          files: [],
        }}
        locale="ko"
      />,
    );
    expect(html).toContain(campaignCollaborationKo.waiting);
    expect(html).not.toContain('name="body"');
    expect(html).not.toContain("brief.pdf");
  });
  it("shows a read-only brand view without creator actions", () => {
    const html = renderToStaticMarkup(
      <ParticipantDetail
        participation={{ ...p, role: "brand", canWrite: false }}
        locale="en"
      />,
    );
    expect(html).toContain(campaignCollaborationEn.readOnly);
    expect(html).not.toContain('href="/campaigns/test/make"');
    expect(html).not.toContain('name="body"');
  });
  it("identifies the selected participant with an authorized safe profile link", () => {
    const html = renderToStaticMarkup(
      <ParticipantDetail
        participation={{
          ...p,
          role: "brand",
          creatorProfileUrl: "https://instagram.com/selected-person",
        }}
        locale="ko"
      />,
    );
    expect(html).toContain("https://instagram.com/selected-person");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(campaignCollaborationKo.participantProfile);
  });
  it("provides labeled inputs, file restrictions and separate translated feedback", () => {
    const invite = renderToStaticMarkup(
      <InvitationForm locale="en" campaignId="c" />,
    );
    expect(invite).toContain('type="email"');
    expect(invite).toContain('name="campaignId"');
    expect(invite).toContain(campaignCollaborationEn.emailHint);
    const files = renderToStaticMarkup(
      <ParticipantForms locale="ko" applicationId="a" />,
    );
    expect(files).toContain('maxLength="4000"');
    expect(files).toContain(
      'accept="application/pdf,image/png,image/jpeg,image/webp"',
    );
    expect(files).toContain('aria-live="polite"');
    expect(Object.keys(campaignCollaborationKo)).toEqual(
      Object.keys(campaignCollaborationEn),
    );
  });
});
