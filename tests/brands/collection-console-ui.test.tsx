import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CollectionConsole } from "@/components/brand-workspace/collection-console";
import { BRAND_WORKSPACE_OPERATIONS } from "@/lib/admin/brand-workspace-operations";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { BrandPost } from "@/lib/brands/workspace/types";

import { UNKNOWN_POST_PRESENTATION } from "@/lib/brands/workspace/performance";
const P1 = "a0000000-0000-4000-8000-000000000001";
const P2 = "a0000000-0000-4000-8000-000000000002";
const post = (id: string, changes: Partial<BrandPost> = {}): BrandPost => ({
  id, origin: "approved_content", contentVersionId: "v1", url: `https://www.instagram.com/p/${id.slice(-4)}/`, platform: "instagram",
  publishedAt: "2026-09-20T00:00:00Z", metricRevision: 0, verification: "unverified", metricsSource: "unavailable",
  measuredAt: null, views: null, viewsApproximate: false, likes: null, comments: null, shares: null, saves: null, createdAt: "2026-09-20T00:00:00Z", presentation: UNKNOWN_POST_PRESENTATION, ...changes,
});
const posts = [post(P1), post(P2, { metricRevision: 3, verification: "manual", metricsSource: "creator_evidence", measuredAt: "2026-09-21T01:00:00Z", views: 0, likes: 12 })];

describe("studio collection console", () => {
  for (const locale of ["ko", "en"] as const) {
    const b = getDictionary(locale).brandWorkspace;
    const render = (status: "active" | "completed" | "cancelled" | "requested") =>
      renderToStaticMarkup(<CollectionConsole projectId="b0000000-0000-4000-8000-000000000001" status={status} posts={posts} b={b} locale={locale} />);

    it(`${locale}: one form, server-side time only, zero kept apart from blank, safe external links`, () => {
      const html = render("active");
      expect(html).toContain('data-collection-console="open"');
      expect(html.match(/<form/g)).toHaveLength(1);
      expect(html).toContain('value="brandWorkspace.metricsBatch"');
      expect(html).not.toMatch(/name="measuredAt|datetime-local/);
      expect(html).toContain(b.collectionHint);
      expect(html).toMatch(new RegExp(`name="views:${P2}"[^>]*value="0"`));
      expect(html).toMatch(new RegExp(`name="views:${P1}"[^>]*value=""`));
      expect(html).toMatch(new RegExp(`name="rev:${P2}"[^>]*value="3"`));
      expect(html).toContain('rel="noopener noreferrer nofollow"');
      expect(html).toContain('target="_blank"');
      // No row claims a source nobody has: there is no automatic/API option to pick.
      expect(html).not.toMatch(/value="(?:api|automatic|unavailable)"/);
      expect(html).not.toContain("<fieldset disabled");
    });

    it(`${locale}: Enter in any cell means "save ticked rows", never the first row's own button`, () => {
      const html = render("active");
      const firstSubmit = html.indexOf('type="submit"');
      expect(html.slice(firstSubmit - 200, firstSubmit + 200)).not.toContain('name="only"');
      expect(html.indexOf('name="only"')).toBeGreaterThan(firstSubmit);
    });

    for (const status of ["completed", "cancelled", "requested"] as const) {
      it(`${locale}: ${status} campaign explains the freeze and disables every control`, () => {
        const html = render(status);
        expect(html).toContain('data-collection-console="closed"');
        expect(html).toContain(b.collectionClosed);
        expect(html).toContain("<fieldset disabled");
        expect(html).not.toContain(b.collectionHint);
      });
    }
  }

  it("posts field names the registered operation actually reads", () => {
    const b = getDictionary("ko").brandWorkspace;
    const html = renderToStaticMarkup(<CollectionConsole projectId="b0000000-0000-4000-8000-000000000001" status="active" posts={posts} b={b} locale="ko" />);
    const form = new FormData();
    form.set("projectId", "b0000000-0000-4000-8000-000000000001");
    form.set("requestId", "c0000000-0000-4000-8000-000000000001");
    for (const match of html.matchAll(/<(?:input|select)[^>]*name="([a-zA-Z]+:[0-9a-f-]{36})"(?:[^>]*value="([^"]*)")?/g)) form.set(match[1]!, match[2] ?? "studio_review");
    form.set("only", P2);
    const parsed = BRAND_WORKSPACE_OPERATIONS["brandWorkspace.metricsBatch"].parse(form);
    if (!parsed.ok) throw Error(parsed.detail);
    expect(parsed.value.rows).toEqual([expect.objectContaining({ postId: P2, expectedRevision: 3, views: 0, likes: 12, comments: null })]);
  });

  for (const locale of ['ko', 'en'] as const) {
    it(`${locale}: a completed exception uses its fixed request and offers only one combined save`, () => {
      const b = getDictionary(locale).brandWorkspace;
      const request = 'c0000000-0000-4000-8000-000000000099';
      const render = (status: 'completed' | 'cancelled') => renderToStaticMarkup(<CollectionConsole projectId="b0000000-0000-4000-8000-000000000001" status={status} posts={posts} b={b} locale={locale} completedRequestId={request} />);
      const html = render('completed');
      expect(html).not.toContain('<fieldset disabled');
      expect(html).toContain(b.collectionOnceHint);
      expect(html).toContain(b.collectionSaveOnce);
      expect(html).toContain(`name="requestId" value="${request}"`);
      expect(html).not.toContain('name="only"');
      expect(render('cancelled')).toContain('<fieldset disabled');
      expect(render('cancelled')).not.toContain(b.collectionOnceHint);
    });
  }
});
