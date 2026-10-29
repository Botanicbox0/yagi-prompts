import type { ReactNode } from "react";
import { ConfirmCheck, OpForm } from "@/components/admin/chrome";
import { StudioForm } from "./studio-form";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { StudioShortlistView } from "@/lib/brands/shortlist/service";
import { shortlistCount, shortlistDay } from "@/lib/brands/shortlist/format";

/**
 * The studio's side of the creator shortlist (docs/BRAND-SHORTLIST.md): import a candidate file,
 * share or hide candidates, remove one, and see which ones the client marked. The campaign ID shown
 * here is what the import worker sends as `projectId`.
 */
export function ShortlistAdmin({ projectId, view, back, copy, locale, brandHost = false, notice }: {
  projectId: string;
  view: StudioShortlistView | null;
  back: string;
  copy: Dictionary["brandWorkspace"]["shortlistAdmin"];
  locale: string;
  /** On brand.twings.app the forms post to the brand host's studio door; `/admin/do` everywhere else. */
  brandHost?: boolean;
  /** The last action's outcome, where the page has no banner of its own (the brand host). */
  notice?: ReactNode;
}) {
  const list = view?.candidates ?? [];
  const shared = list.filter((c) => c.shared).length;
  const picked = list.filter((c) => c.picked).length;
  const hidden = list.length - shared;
  const hiddenIds = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const Form = brandHost ? StudioForm : OpForm;
  return (
    <section id="shortlist-admin" className="bw-panel" data-shortlist-admin={list.length}>
      <h2>{copy.title}</h2>
      {notice}
      <p className="bw-muted">{copy.hint}</p>
      <p>
        {copy.projectId}: <code data-shortlist-project-id>{projectId}</code>
      </p>
      <Form op="brandWorkspace.shortlistImport" back={back} className="bw-form">
        {hiddenIds("projectId", projectId)}
        <label>
          {copy.file}
          <input type="file" name="file" accept="application/json,.json" required />
        </label>
        <button className="bw-button bw-primary" type="submit">{copy.import}</button>
      </Form>
      {list.length === 0 ? (
        <p className="bw-note">{copy.none}</p>
      ) : (
        <>
          <div className="bw-row">
            <p data-shortlist-summary>{interpolate(copy.summary, { total: list.length, shared, hidden, picked })}</p>
            {hidden > 0 && (
              <Form op="brandWorkspace.shortlistShare" back={back}>
                {hiddenIds("projectId", projectId)}
                {hiddenIds("shared", "true")}
                <button className="bw-button bw-primary" type="submit" data-shortlist-share-all>{copy.shareAll}</button>
              </Form>
            )}
            {shared > 0 && (
              <Form op="brandWorkspace.shortlistShare" back={back}>
                {hiddenIds("projectId", projectId)}
                {hiddenIds("shared", "false")}
                <button className="bw-button" type="submit">{copy.hideAll}</button>
              </Form>
            )}
          </div>
          <div className="bw-table-scroll">
            <table className="bw-shortlist-admin-table">
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} data-shortlist-admin-candidate={c.handle}>
                    <td>
                      <strong>{c.displayName ?? c.handle}</strong>{" "}
                      <a href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noopener noreferrer">@{c.handle}</a>
                    </td>
                    <td>{shortlistCount(c.metrics.followers, locale)}</td>
                    <td>
                      <span className="bw-status" data-state={c.shared ? "active" : "requested"}>{c.shared ? copy.states.shared : copy.states.hidden}</span>
                      {c.picked && <> <span className="bw-shortlist-badge">{copy.states.picked}</span></>}
                    </td>
                    <td className="bw-muted">{c.measuredOn ? interpolate(copy.updated, { date: shortlistDay(c.measuredOn, locale) }) : null}</td>
                    <td>
                      <div className="bw-row">
                        <Form op="brandWorkspace.shortlistShare" back={back}>
                          {hiddenIds("projectId", projectId)}
                          {hiddenIds("candidateId", c.id)}
                          {hiddenIds("shared", String(!c.shared))}
                          <button className="bw-button" type="submit">{c.shared ? copy.hide : copy.share}</button>
                        </Form>
                        <details>
                          <summary>{copy.remove}</summary>
                          <Form op="brandWorkspace.shortlistRemove" back={back}>
                            {hiddenIds("projectId", projectId)}
                            {hiddenIds("candidateId", c.id)}
                            <ConfirmCheck label={copy.removeConfirm} />
                            <button className="bw-button bw-danger" type="submit">{copy.remove}</button>
                          </Form>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
