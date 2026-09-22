import { randomUUID } from "node:crypto";
import type { BrandPost, BrandProjectStatus } from "@/lib/brands/workspace/types";
import { BRAND_METRICS_BATCH_LIMIT } from "@/lib/brands/workspace/schemas";
import { OpForm } from "@/components/admin/chrome";
import type { BrandCopy } from "./action-form";
import { formatBrandTimestamp } from "./format";

const METRICS = ["views", "likes", "comments", "shares", "saves"] as const;

/**
 * Studio collection console: one JS-free form for every recorded post of a project.
 *
 * Only a row the administrator chose is read by `brandWorkspace.metricsBatch`: its own save button
 * (`only`) or its ticked box (`select`). No time field exists; the server stamps one measurement
 * time per save. Nothing here collects automatically: the values are typed by a person.
 */
export function CollectionConsole({
  projectId,
  status,
  posts,
  b,
  locale,
}: {
  projectId: string;
  status: BrandProjectStatus;
  posts: BrandPost[];
  b: BrandCopy;
  locale: string;
}) {
  const open = status === "active";
  return (
    <section className="bw-panel" data-collection-console={open ? "open" : "closed"}>
      <h2>{b.collectionTitle}</h2>
      {!open && (
        <p className="bw-note" role="status" data-collection-closed>
          {b.collectionClosed}
        </p>
      )}
      {open && <p className="bw-note">{b.collectionHint}</p>}
      {posts.length === 0 ? (
        <p className="bw-muted">{b.noPosts}</p>
      ) : (
        <OpForm
          op="brandWorkspace.metricsBatch"
          back={`/admin/brand-workspace/${projectId}`}
          className="bw-form"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="requestId" value={randomUUID()} />
          <fieldset disabled={!open} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {/* First submit in tree order on purpose: Enter inside any cell means "save the ticked
                rows", never the first row's own button. With nothing ticked that save is refused. */}
            <button className="bw-button bw-primary" type="submit">
              {b.collectionSaveSelected}
            </button>
            <p className="bw-muted">
              {b.collectionLimit.replace(
                "{count}",
                String(BRAND_METRICS_BATCH_LIMIT),
              )}
            </p>
            <div className="bw-table-wrap">
              <table className="bw-table">
                <thead>
                  <tr>
                    <th>{b.collectionSelect}</th>
                    <th>{b.posts}</th>
                    {METRICS.map((k) => (
                      <th key={k}>{b[k]}</th>
                    ))}
                    <th>{b.source}</th>
                    <th>{b.verification}</th>
                    <th>{b.collectionLastChecked}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post, index) => {
                    const name = `${post.platform} ${index + 1}`;
                    return (
                      <tr key={post.id} data-collection-row={post.id}>
                        <td>
                          <input
                            type="checkbox"
                            name="select"
                            value={post.id}
                            aria-label={`${b.collectionSelect} · ${name}`}
                            style={{ width: 20, height: 20 }}
                          />
                          <input
                            type="hidden"
                            name={`rev:${post.id}`}
                            value={post.metricRevision}
                          />
                        </td>
                        <td>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            referrerPolicy="no-referrer"
                            title={b.external}
                          >
                            {name} ↗
                          </a>
                          <p className="bw-muted" style={{ width: 190, overflowWrap: "anywhere" }}>{post.url}</p>
                        </td>
                        {METRICS.map((k) => (
                          <td key={k}>
                            <input
                              name={`${k}:${post.id}`}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              defaultValue={post[k] ?? ""}
                              placeholder={b.notMeasured}
                              aria-label={`${b[k]} · ${name}`}
                              style={{ minWidth: 92 }}
                            />
                          </td>
                        ))}
                        <td>
                          <select
                            name={`metricsSource:${post.id}`}
                            defaultValue={
                              post.metricsSource === "unavailable"
                                ? "studio_review"
                                : post.metricsSource
                            }
                            aria-label={`${b.source} · ${name}`}
                            style={{ minWidth: 172 }}
                          >
                            <option value="studio_review">
                              {b.sourceLabels.studio_review}
                            </option>
                            <option value="creator_evidence">
                              {b.sourceLabels.creator_evidence}
                            </option>
                          </select>
                        </td>
                        <td>
                          <select
                            name={`verification:${post.id}`}
                            defaultValue={post.verification}
                            aria-label={`${b.verification} · ${name}`}
                            style={{ minWidth: 180 }}
                          >
                            <option value="unverified">
                              {b.verificationLabels.unverified}
                            </option>
                            <option value="manual">
                              {b.verificationLabels.manual}
                            </option>
                          </select>
                        </td>
                        <td style={{ minWidth: 120 }}>
                          {formatBrandTimestamp(post.measuredAt, locale) ??
                            b.notMeasured}
                        </td>
                        <td>
                          <button
                            className="bw-button"
                            type="submit"
                            name="only"
                            value={post.id}
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {b.collectionSaveRow}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>
        </OpForm>
      )}
    </section>
  );
}
