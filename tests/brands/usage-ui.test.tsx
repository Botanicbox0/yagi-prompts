import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { SecondaryUsage } from "@/components/brand-workspace/secondary-usage";
import { tabFromHash } from "@/components/brand-workspace/project-tabs";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { loadBrandProject } from "@/lib/brands/workspace/service";
import * as s from "@/lib/brands/workspace/service";
import { interpolate } from "@/lib/i18n/format";
import * as u from "@/lib/brands/usage/service";
import { usageFixture, type UsageFixture } from "@/tests/helpers/brand-usage";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/** The brand's "2차 활용" tab rendered from the real service projection. Fixture values only. */
let f: UsageFixture;
beforeEach(async () => { f = await usageFixture(); });
afterEach(async () => { await f.db.close(); });

describe.each(["ko", "en"] as const)("secondary usage tab in %s", (locale) => {
  const b = getDictionary(locale).brandWorkspace, c = b.secondaryUsage;
  it("offers the inquiry form and a card CTA to writers, with every scope field optional", async () => {
    const view = (await u.loadBrandUsage({ sql: f.sql }, f.editor, f.projectId))!;
    const project = (await loadBrandProject({ sql: f.sql }, f.editor, f.projectId))!;
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale={locale} usage={view} />);
    expect(html).toContain('data-usage-tab');
    expect(html).toContain(`href="#usage"`);
    expect(html).toContain(`data-usage-cta="post:${f.postId}"`);
    expect(html).toContain(`value="post:${f.postId}"`);
    expect(html).toContain(c.intents.know_cost);
    expect(html).toContain(c.hints.undecided);
    expect(html).toContain(c.notice);
    // Only the intent is required; hints, duration, timing and budget are not.
    expect(html).not.toMatch(/name="(hints|durationHint|timingText|budgetKrw)"[^>]*required/);
    expect(tabFromHash(`#usage=post:${f.postId}`)).toBe("usage");
  });
  it("hides the tab when there is no usage view (campaign guests)", async () => {
    const project = (await loadBrandProject({ sql: f.sql }, f.editor, f.projectId))!;
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale={locale} usage={null} />);
    expect(html).not.toContain('data-usage-tab');
    expect(html).not.toContain('href="#usage"');
    expect(html).not.toContain('data-usage-cta');
  });
  it("shows the final quote and its terms to the owner, never the creator amount or evidence", async () => {
    const { caseId } = await f.quoted(777000);
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: true }, f.owner, f.projectId))!;
    const html = renderToStaticMarkup(<SecondaryUsage view={view} projectId={f.projectId} b={b} locale={locale} />);
    expect(html).toContain(`data-usage-case="${caseId}"`);
    expect(html).toContain('data-usage-state="quoted"');
    expect(html).toContain("777,000");
    expect(html).toContain(c.quote.acceptConfirm);
    expect(html).toContain(c.availability.confirmed);
    expect(html).toContain(c.exclusions.no_new_likeness_generation);
    expect(html).toContain('data-usage-contract');
    expect(html).not.toMatch(/fixture<|evidence|compensation/i);
  });
  it("a viewer reads the quote without accept/pay controls and is told who can act", async () => {
    await f.quoted(5000);
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: true }, f.viewer, f.projectId))!;
    const html = renderToStaticMarkup(<SecondaryUsage view={view} projectId={f.projectId} b={b} locale={locale} />);
    expect(html).toContain('data-usage-viewer');
    expect(html).toContain(c.quote.buyerOnly);
    expect(html).not.toContain(c.quote.acceptConfirm);
    expect(html).not.toContain('data-usage-inquiry');
  });
  it("with payments closed the owner sees the quote and a plain next step instead of accept", async () => {
    await f.quoted(5000);
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: false }, f.owner, f.projectId))!;
    const html = renderToStaticMarkup(<SecondaryUsage view={view} projectId={f.projectId} b={b} locale={locale} />);
    expect(html).toContain(c.quote.paymentsClosed);
    expect(html).not.toContain(c.quote.acceptConfirm);
  });
  // Browser review: every post read "인스타그램 게시물 게시물" and the form was a tall checklist.
  const plain = (html: string) => html.replace(/\s(href|src|value|data-[\w-]+)="[^"]*"/g, "");
  const platform = getDictionary(locale).brandWorkspace.performance.platformNames.instagram;
  it("names posts recognizably in a compact picker: never a doubled noun, raw post code or number without need", async () => {
    await s.importBrandExternalPosts({ sql: f.sql }, f.studio, { projectId: f.projectId, requestId: randomUUID(), posts: [{ url: "https://www.instagram.com/p/FIXTURE8/", publishedAt: null }] });
    const view = (await u.loadBrandUsage({ sql: f.sql }, f.editor, f.projectId))!;
    const project = (await loadBrandProject({ sql: f.sql }, f.editor, f.projectId))!;
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale={locale} usage={view} />);
    const usage = html.slice(html.indexOf("data-usage-tab"));
    expect(usage).not.toContain(b.platforms.instagram + (locale === "ko" ? " 게시물" : " post"));
    expect(plain(usage)).not.toMatch(/FIXTURE[89]/);
    expect(usage).toContain(interpolate(c.subjectPostNumbered, { platform, number: 1 }));
    expect(usage).toContain(interpolate(c.subjectPostNumbered, { platform, number: 2 }));
    // Each imported post can be opened to tell them apart; the link is not the checkbox label.
    expect(usage).toContain('href="https://www.instagram.com/p/FIXTURE8/"');
    expect(usage).toMatch(/<\/label><a href="https:\/\/www\.instagram\.com\/p\/FIXTURE9\/"[^>]*>/);
    expect(usage.match(/name="subject"/g)).toHaveLength(2);
    expect(usage).toContain('class="bw-usage-subjects"');
    // Optional plans are folded (closed) but still inside the form, so they are still submitted.
    expect(usage).toMatch(/<details class="bw-usage-optional" data-usage-optional="true"><summary>/);
    expect(usage).toContain(c.plansSummary);
    expect(usage.indexOf(c.plansSummary)).toBeLessThan(usage.indexOf('name="hints"'));
    expect(usage.indexOf('name="budgetKrw"')).toBeLessThan(usage.indexOf("</form>"));
  });
  it("uses the approved content title and its picture for a post made from that content", async () => {
    const project = (await loadBrandProject({ sql: f.sql }, f.editor, f.projectId))!;
    const view = (await u.loadBrandUsage({ sql: f.sql }, f.editor, f.projectId))!;
    const contentId = randomUUID(), attachmentId = randomUUID();
    const withContent = {
      ...project,
      attachments: [...project.attachments, { id: attachmentId, name: "c.jpg", mime: "image/jpeg", sizeBytes: 1, createdAt: project.updatedAt }],
      contents: [{ id: contentId, slotKey: "a", version: 1, title: "Fixture creative 1", attachmentId, mediaUrl: "/fixture-media/1", caption: "", usageRights: "", reviewRevision: 0, decision: "approved" as const, createdAt: project.updatedAt }],
      posts: project.posts.map((p) => ({ ...p, contentVersionId: contentId })),
    };
    const html = renderToStaticMarkup(<SecondaryUsage view={view} projectId={f.projectId} b={b} locale={locale} project={withContent} />);
    expect(html).toContain("<strong>Fixture creative 1</strong>");
    expect(html).toContain(`<small>${b.platforms.instagram} · ${c.linkedPost}</small>`);
    expect(html).toContain('src="/fixture-media/1"');
  });
  it("names a submitted case and its quote by the same recognizable subject, with a post link", async () => {
    await f.quoted(5000);
    const view = (await u.loadBrandUsage({ sql: f.sql, paymentsOpen: true }, f.owner, f.projectId))!;
    const project = (await loadBrandProject({ sql: f.sql }, f.owner, f.projectId))!;
    const html = renderToStaticMarkup(<SecondaryUsage view={view} projectId={f.projectId} b={b} locale={locale} project={project} />);
    const name = interpolate(c.subjectPost, { platform });
    expect(html).toContain(`<h3>${name}</h3>`);
    expect(html).toContain(`<dd>${name} · ${c.subjectKinds.original_post}</dd>`);
    expect(html).toContain(`aria-label="${b.performance.openPost}: ${name}"`);
    expect(html).not.toContain(b.platforms.instagram + (locale === "ko" ? " 게시물" : " post"));
  });
  it("a cost-only inquiry reads as received, with unknown hints shown as undecided", async () => {
    await u.submitUsageInquiry({ sql: f.sql }, f.editor, { projectId: f.projectId, requestId: randomUUID(), subjects: [{ kind: "post", id: f.postId }], intent: "know_cost" });
    const view = (await u.loadBrandUsage({ sql: f.sql }, f.editor, f.projectId))!;
    const html = renderToStaticMarkup(<SecondaryUsage view={view} projectId={f.projectId} b={b} locale={locale} />);
    expect(html).toContain(c.states.submitted);
    expect(html).toContain(c.hintsNone);
    expect(html).toContain(c.linkedPost);
  });
});
