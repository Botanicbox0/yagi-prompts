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
      const id = location.hash.slice(1);
      if ((ids as readonly string[]).includes(id)) setActive(id);
    };
    read();
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
      <nav className="bw-tabs" aria-label={b.projectTitle}>
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
