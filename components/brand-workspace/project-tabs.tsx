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
] as const;
export type ProjectTab = (typeof ids)[number];
/** The tab a URL fragment names (`#review`), or null for any other fragment. */
export function tabFromHash(hash: string): ProjectTab | null {
  const id = hash.replace(/^#/, "");
  return (ids as readonly string[]).includes(id) ? (id as ProjectTab) : null;
}
export function ProjectTabs({
  b,
  children,
  comments = 0,
}: {
  b: BrandCopy;
  children: ReactNode;
  /** Shown on the comments tab so a new thread is visible from any tab. */
  comments?: number;
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
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const labels = [
    b.performance.title,
    b.overview,
    b.review,
    b.conversation,
    b.reports,
    b.files,
    b.managed.contracts,
  ];
  return (
    <div className="bw-project-sections" data-project-tab={active}>
      <nav className="bw-tabs" aria-label={b.projectSections}>
        {ids.map((id, i) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={id === active ? "page" : undefined}
            onClick={() => setActive(id)}
          >
            {labels[i]}
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
