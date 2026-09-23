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
  useEffect(() => {
    const read = () => {
      const id = tabFromHash(location.hash);
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
  }, []);
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
        {ids.filter((id) => usage || id !== "usage").map((id) => (
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
