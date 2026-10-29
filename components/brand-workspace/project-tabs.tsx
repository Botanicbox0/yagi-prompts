"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { BrandCopy } from "./action-form";
/**
 * On brand.twings.app the white tab pill glides to the chosen tab (View Transitions; the page itself
 * swaps instantly). Without the API, with reduced motion, or in /admin, the tab just switches.
 */
function switchTab(update: () => void) {
  const glide = typeof document !== "undefined" && "startViewTransition" in document
    && document.documentElement.hasAttribute("data-brand-workspace")
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!glide) return update();
  document.startViewTransition(() => flushSync(update));
}
/**
 * One campaign, one screen (docs/PLATFORM-2.0.md §16.4). The tab ids are also the section ids, so
 * every existing link (`#review`, `#reports`, `#performance`) keeps working. Two sections share a
 * tab with another: files sit with the conversation, secondary usage with the contracts.
 */
const ids = [
  "performance",
  "brief",
  "shortlist",
  "review",
  "applicants",
  "payments",
  "reports",
  "conversation",
  "contracts",
] as const;
export type ProjectTab = (typeof ids)[number];
/** Sections that live inside another tab, by their own fragment. */
const within: Record<string, ProjectTab> = { files: "conversation", usage: "contracts" };
/**
 * The tab a URL fragment names (`#review`, or `#files` → its tab), or null for any other fragment. A
 * fragment may carry one value after `=` (`#usage=post:<id>` preselects what the inquiry is about);
 * only the name picks the tab.
 */
export function tabFromHash(hash: string): ProjectTab | null {
  const id = hash.replace(/^#/, "").split("=")[0]!;
  if (Object.hasOwn(within, id)) return within[id]!;
  return (ids as readonly string[]).includes(id) ? (id as ProjectTab) : null;
}
/**
 * The tab to open for a fragment, given the tabs this viewer actually has. A tab or section the viewer
 * does not have (`#usage` for a campaign guest, `#payments` for a guest) opens the overview instead of
 * an empty panel. Any other fragment (an in-page anchor, or junk) is not a tab: null, so the open tab
 * stays as it is.
 */
export function tabForViewer(hash: string, available: readonly ProjectTab[], usage = true): ProjectTab | null {
  const id = tabFromHash(hash);
  if (id === null) return null;
  if (!usage && hash.replace(/^#/, "").split("=")[0] === "usage") return "performance";
  return available.includes(id) ? id : "performance";
}
export function ProjectTabs({
  b,
  children,
  comments = 0,
  pendingReviews = 0,
  usage = false,
  campaign = false,
  shortlist = 0,
}: {
  b: BrandCopy;
  children: ReactNode;
  /** Total conversation messages; never an unread count. */
  comments?: number;
  pendingReviews?: number;
  /** The secondary-usage section exists only for brand members, the TWINGS team and the studio (never guests). */
  usage?: boolean;
  /** Applicants and payment: brand members only, on the customer's page (never guests, never the admin view). */
  campaign?: boolean;
  /** Shared shortlist candidates (docs/BRAND-SHORTLIST.md); the tab exists only when there is at least one. */
  shortlist?: number;
}) {
  const navigation = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string>("performance");
  const has = (id: ProjectTab) => (campaign || (id !== "applicants" && id !== "payments")) && (shortlist > 0 || id !== "shortlist");
  const available = ids.filter(has);
  useEffect(() => {
    const allowed = ids.filter((id) => (campaign || (id !== "applicants" && id !== "payments")) && (shortlist > 0 || id !== "shortlist"));
    const read = () => {
      const id = tabForViewer(location.hash, allowed, usage);
      if (id) {
        setActive(id);
        requestAnimationFrame(() => navigation.current?.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
      }
      return id;
    };
    // The section the fragment names: the tab itself, or a section inside it (`#files`, `#usage`).
    const target = (id: ProjectTab) => {
      const name = location.hash.replace(/^#/, "").split("=")[0]!;
      return Object.hasOwn(within, name) && within[name] === id ? name : id;
    };
    // A link like /brand/projects/<id>#review arrives while that section is still hidden, so the
    // browser had nothing to scroll to. Open the tab, then bring its section into view once shown.
    const initial = read();
    if (initial) requestAnimationFrame(() => document.getElementById(target(initial))?.scrollIntoView({ block: "start" }));
    // A card link with a value (`#usage=post:<id>`) names no element: bring its section into view ourselves.
    const change = () => {
      const id = read();
      if (id && location.hash.includes("=")) requestAnimationFrame(() => document.getElementById(target(id))?.scrollIntoView({ block: "start" }));
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [usage, campaign, shortlist]);
  const labels: Record<ProjectTab, string> = {
    performance: b.tabs.overview,
    brief: b.tabs.brief,
    shortlist: b.tabs.shortlist,
    review: b.review,
    applicants: b.tabs.applicants,
    payments: b.tabs.payments,
    reports: b.reports,
    conversation: b.tabs.filesConversation,
    contracts: usage ? b.tabs.contractsUsage : b.managed.contracts,
  };
  return (
    <div className="bw-project-sections" data-project-tab={active}>
      <nav ref={navigation} className="bw-tabs" aria-label={b.projectSections}>
        {available.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={id === active ? "page" : undefined}
            onClick={(event) => { const tab = event.currentTarget; if (id !== active) switchTab(() => setActive(id)); tab.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
          >
            {id === active && <span className="bw-tab-indicator" aria-hidden="true" />}
            {labels[id]}
            {id === "review" && pendingReviews > 0 && <span className="bw-tab-count" data-review-count={pendingReviews}>{pendingReviews}</span>}
            {id === "shortlist" && <span className="bw-tab-count" data-shortlist-count={shortlist}>{shortlist}</span>}
            {id === "conversation" && comments > 0 && (
              <span className="bw-tab-count" data-comment-count={comments}>{comments}</span>
            )}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}
