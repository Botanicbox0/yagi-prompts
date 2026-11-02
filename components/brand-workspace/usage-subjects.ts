import type { BrandPost, BrandProjectDetail } from "@/lib/brands/workspace/types";
import type { BrandUsageCase, BrandUsageSubject, BrandUsageView } from "@/lib/brands/usage/types";
import { postHandle, postPresentation } from "@/lib/brands/workspace/performance";
import { interpolate } from "@/lib/i18n/format";
import type { BrandCopy } from "./action-form";

/**
 * How a secondary-usage subject is recognized in the brand UI, built from the campaign the page already
 * loaded (no extra DTO fields). Title order for a post: the recorded @handle, the approved content title,
 * the recorded display name, else the localized platform post with a number ("인스타그램 게시물 2") when the
 * campaign has several on that platform. The raw platform post code never becomes text; it stays in `href`.
 */
export type UsageProject = Pick<BrandProjectDetail, "posts" | "contents" | "attachments">;
export interface UsageSubjectDisplay {
  title: string;
  detail: string | null;
  thumb: { src: string; video: boolean } | null;
  href: string | null;
}

const EMPTY: UsageProject = { posts: [], contents: [], attachments: [] };

export function usageSubjects(b: BrandCopy, project: UsageProject | null = null) {
  const u = b.secondaryUsage, p = project ?? EMPTY;
  const platformName = (platform: string) => b.performance.platformNames[platform as BrandPost["platform"]] ?? platform;
  const generic = (platform: string | null, number?: number) => platform === null ? u.subjectsLabel
    : number ? interpolate(u.subjectPostNumbered, { platform: platformName(platform), number }) : interpolate(u.subjectPost, { platform: platformName(platform) });
  // Numbered only where the platform has several posts, in the campaign's own post order.
  const number = new Map<string, number>();
  for (const platform of new Set(p.posts.map((post) => post.platform))) {
    const same = p.posts.filter((post) => post.platform === platform);
    if (same.length > 1) same.forEach((post, i) => number.set(post.id, i + 1));
  }
  const media = (contentVersionId: string | null) => {
    const content = p.contents.find((c) => c.id === contentVersionId);
    const mime = p.attachments.find((a) => a.id === content?.attachmentId)?.mime ?? "";
    return content && /^(image|video)\//.test(mime) ? { src: content.mediaUrl, video: mime.startsWith("video/") } : null;
  };
  const post = (item: BrandPost): UsageSubjectDisplay => {
    const named = postHandle(item) ?? p.contents.find((c) => c.id === item.contentVersionId)?.title ?? postPresentation(item).displayName;
    const linked = item.origin === "external_import" ? u.linkedPost : null;
    const thumbnail = postPresentation(item).thumbnailUrl;
    return {
      title: named ?? generic(item.platform, number.get(item.id)),
      detail: named ? [b.platforms[item.platform], linked].filter(Boolean).join(" · ") : linked,
      thumb: thumbnail ? { src: thumbnail, video: false } : media(item.contentVersionId),
      href: item.url,
    };
  };
  const eligible = (s: BrandUsageView["eligible"][number]): UsageSubjectDisplay => {
    if (s.kind === "post") {
      const item = p.posts.find((x) => x.id === s.id);
      if (item) return post(item);
      return { title: s.label.startsWith("@") ? s.label : generic(s.label), detail: null, thumb: null, href: null };
    }
    const content = p.contents.find((c) => c.id === s.id);
    return {
      title: content?.title ?? s.label,
      detail: content ? `${u.subjectKinds.content_version} · ${interpolate(b.version, { number: content.version })}` : u.subjectKinds.content_version,
      thumb: content ? media(content.id) : null,
      href: null,
    };
  };
  const caseSubject = (s: BrandUsageSubject): UsageSubjectDisplay => {
    const item = s.kind === "post" && s.url ? p.posts.find((x) => x.url === s.url) : undefined;
    if (item) return post(item);
    return { title: s.label ?? generic(s.platform), detail: null, thumb: null, href: s.url };
  };
  /** Quote items and grants carry the case item id: name them as the case names that subject. */
  const itemNames = (c: BrandUsageCase) => new Map(c.subjects.map((s) => [s.itemId, caseSubject(s).title]));
  return { eligible, caseSubject, itemNames, generic };
}
export type UsageSubjects = ReturnType<typeof usageSubjects>;
