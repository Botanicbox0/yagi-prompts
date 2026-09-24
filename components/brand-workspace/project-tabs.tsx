"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { BrandCopy } from "./action-form";
const ids = [
  "performance",
  "brief",
  "review",
  "conversation",
  "reports",
  "files",
  "contracts",
  "usage",
] as const;
export type ProjectTab = (typeof ids)[number];
/**
 * The tab a URL fragment names (`#review`), or null for any other fragment. A fragment may carry one
 * value after `=` (`#usage=post:<id>` preselects what the inquiry is about); only the name picks the tab.
 */
export function tabFromHash(hash: string): ProjectTab | null {
  const id = hash.replace(/^#/, "").split("=")[0]!;
  return (ids as readonly string[]).includes(id) ? (id as ProjectTab) : null;
}
/**
 * The tab to open for a fragment, given the tabs this viewer actually has. A tab the viewer does not
 * have (`#usage` for a campaign guest) opens the results tab instead of an empty panel. Any other
 * fragment (an in-page anchor, or junk) is not a tab: null, so the open tab stays as it is.
 */
export function tabForViewer(hash: string, available: readonly ProjectTab[]): ProjectTab | null {
  const id = tabFromHash(hash);
  if (id === null) return null;
  return available.includes(id) ? id : "performance";
}
export function ProjectTabs({
  b,
  children,
  comments = 0,
  usage = false,
}: {
  b: BrandCopy;
  children: ReactNode;
  /** Shown on the comments tab so a new thread is visible from any tab. */
  comments?: number;
  /** The secondary-usage tab exists only for brand members, the TWINGS team and the studio (never guests). */
  usage?: boolean;
}) {
  const [active, setActive] = useState<string>("performance");
  const available = ids.filter((id) => usage || id !== "usage");
  useEffect(() => {
    // `#usage` (with or without a value) only opens for viewers who have that tab; others see results.
    const allowed = ids.filter((id) => usage || id !== "usage");
    const read = () => {
      const id = tabForViewer(location.hash, allowed);
      if (id) setActive(id);
      return id;
    };
    // A link like /brand/projects/<id>#review arrives while that section is still hidden, so the
    // browser had nothing to scroll to. Open the tab, then bring its section into view once shown.
    const initial = read();
    if (initial) requestAnimationFrame(() => document.getElementById(initial)?.scrollIntoView({ block: "start" }));
    // A card link with a value (`#usage=post:<id>`) names no element: bring its tab into view ourselves.
    const change = () => {
      const id = read();
      if (id && location.hash.includes("=")) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [usage]);
  const labels: Record<ProjectTab, string> = {
    performance: b.performance.title,
    brief: b.overview,
    review: b.review,
    conversation: b.conversation,
    reports: b.reports,
    files: b.files,
    contracts: b.managed.contracts,
    usage: b.secondaryUsage.tab,
  };
  return (
    <div className="bw-project-sections" data-project-tab={active}>
      <nav className="bw-tabs" aria-label={b.projectSections}>
        {available.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={id === active ? "page" : undefined}
            onClick={() => setActive(id)}
          >
            {labels[id]}
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
