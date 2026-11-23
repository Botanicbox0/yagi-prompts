import { describe, expect, it, vi } from "vitest";
import { formatProjectRequestAlert, notifySlackBrandProjectRequest } from "@/lib/brands/concierge-slack";

const ORG = "a0000000-0000-4000-8000-000000000001";
const PROJECT = "a0000000-0000-4000-8000-000000000003";
const sql = { query: vi.fn(async () => ({ rows: [{ name: "Acme" }] })) } as never;

describe("project request staff alert", () => {
  it("carries the organization, title, track, due date, budget band and canonical admin link, and no reply tag", () => {
    const text = formatProjectRequestAlert({
      organizationName: "Acme",
      title: "봄 신제품 영상",
      track: "studio_film",
      dueOn: "2026-12-20",
      budgetBand: "krw_5m_10m",
      adminUrl: `/admin/brand-rooms/${ORG}?channel=${PROJECT}`,
    });
    for (const part of [
      "Acme",
      "봄 신제품 영상",
      "studio_film",
      "2026-12-20",
      "krw_5m_10m",
      `https://admin.twings.app/admin/brand-rooms/${ORG}?channel=${PROJECT}`,
    ]) {
      expect(text).toContain(part);
    }
    expect(text).not.toContain("[org:");
  });

  it("leaves out an undecided budget and absent fields", () => {
    const text = formatProjectRequestAlert({
      organizationName: "Acme",
      title: "T",
      budgetBand: "undecided",
      adminUrl: "/admin/inquiries",
    });
    expect(text).not.toContain("undecided");
    expect(text).not.toContain("납품 희망일");
  });

  it("is a no-op without config or outside production", async () => {
    const fetcher = vi.fn();
    expect(
      await notifySlackBrandProjectRequest(sql, { organizationId: ORG, projectId: PROJECT, title: "T" }, { env: {}, fetcher: fetcher as never }),
    ).toEqual({ sent: false });
    expect(
      await notifySlackBrandProjectRequest(
        sql,
        { organizationId: ORG, projectId: PROJECT, title: "T" },
        {
          env: {
            VERCEL_ENV: "preview",
            SLACK_BRAND_CONCIERGE_BOT_TOKEN: "xoxb-test-token",
            SLACK_BRAND_CONCIERGE_CHANNEL_ID: "C0123456789",
          },
          fetcher: fetcher as never,
        },
      ),
    ).toEqual({ sent: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts once to the configured production channel and never puts the token in the text", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: "1.2" }), { status: 200 }));
    const out = await notifySlackBrandProjectRequest(
      sql,
      { organizationId: ORG, projectId: PROJECT, title: "T", track: "studio_film" },
      {
        env: {
          VERCEL_ENV: "production",
          SLACK_BRAND_CONCIERGE_BOT_TOKEN: "xoxb-test-token",
          SLACK_BRAND_CONCIERGE_CHANNEL_ID: "C0123456789",
        },
        fetcher: fetcher as never,
      },
    );
    expect(out.sent).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    const body = JSON.parse(String(init.body)) as { channel: string; text: string };
    expect(body.channel).toBe("C0123456789");
    expect(body.text).toContain(`https://admin.twings.app/admin/brand-rooms/${ORG}?channel=${PROJECT}`);
    expect(body.text).not.toContain("xoxb-");
  });
});
