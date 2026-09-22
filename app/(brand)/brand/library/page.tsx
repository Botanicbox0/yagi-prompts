import { brandContext } from "@/components/brand-workspace/context";
import { loadBrandWorkspace } from "@/lib/brands/workspace/service";
import { WorkspacePreview } from "@/components/brand-workspace/preview";
export default async function ContentLibrary() {
  const { sql, viewer, b } = await brandContext();
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const w = await loadBrandWorkspace({ sql }, viewer, {
      includeAllContent: true,
    }),
    contents = w.projects.flatMap((p) =>
      (p.overview?.contents ?? []).map((c) => ({ p, c })),
    );
  return (
    <div data-brand-library>
      <div className="bw-heading">
        <div>
          <h1>{b.managed.library}</h1>
          <p>{b.managed.libraryHint}</p>
        </div>
      </div>
      {contents.length ? (
        <div className="bw-content-grid">
          {contents.map(({ p, c }) => (
            <a
              className="bw-content-card"
              key={c.id}
              href={`/brand/projects/${p.id}#review`}
            >
              <WorkspacePreview content={c} b={b} title={p.organizationName} />
              <div>
                <span className="bw-status" data-state={c.decision}>
                  {b.decisionStates[c.decision]}
                </span>
                <h3>{c.title}</h3>
                <p>{p.title}</p>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="bw-empty">{b.managed.libraryEmpty}</p>
      )}
    </div>
  );
}
