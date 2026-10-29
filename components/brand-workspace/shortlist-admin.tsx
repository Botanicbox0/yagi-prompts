import { ConfirmCheck, OpForm } from "@/components/admin/chrome";
import { StudioForm } from "./studio-form";
import { ShortlistTriage, type TriageDoor } from "./shortlist-triage";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { StudioShortlistView } from "@/lib/brands/shortlist/service";
import { ADMIN_ACTION_PATH, BACK_FIELD, OP_FIELD } from "@/lib/admin/form";
import { BRAND_STUDIO_ACTION_PATH, STUDIO_REQUEST_HEADER } from "@/lib/admin/brand-host-studio";

/** Candidates created in the last day and still waiting carry the "new" mark. */
const NEW_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * The studio's side of the creator shortlist (docs/BRAND-SHORTLIST.md): import a candidate file, sort
 * candidates into waiting / shared / excluded (ShortlistTriage), keep the campaign's criteria, and see
 * which ones the client marked. The campaign ID shown here is what the import worker sends as
 * `projectId`. On the brand host, import and removal are not offered.
 */
export function ShortlistAdmin({ projectId, view, back, copy, locale, brandHost = false }: {
  projectId: string;
  view: StudioShortlistView | null;
  back: string;
  copy: Dictionary["brandWorkspace"]["shortlistAdmin"];
  locale: string;
  /** On brand.twings.app the forms post to the brand host's studio door; `/admin/do` everywhere else. */
  brandHost?: boolean;
}) {
  const list = view?.candidates ?? [];
  const shared = list.filter((c) => c.state === "shared").length;
  const excluded = list.filter((c) => c.state === "excluded").length;
  const picked = list.filter((c) => c.picked).length;
  const hidden = list.length - shared - excluded;
  const hiddenIds = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const Form = brandHost ? StudioForm : OpForm;
  const door: TriageDoor = {
    path: brandHost ? BRAND_STUDIO_ACTION_PATH : ADMIN_ACTION_PATH,
    headers: brandHost ? { [STUDIO_REQUEST_HEADER]: "1" } : {},
    opField: OP_FIELD,
    backField: BACK_FIELD,
    back,
    triageOp: "brandWorkspace.shortlistTriage",
    criteriaOp: "brandWorkspace.shortlistCriteria",
  };
  return (
    <section id="shortlist-admin" className="bw-panel" data-shortlist-admin={list.length}>
      <h2>{copy.title}</h2>
      <p className="bw-muted">{copy.hint}</p>
      <p>
        {copy.projectId}: <code data-shortlist-project-id>{projectId}</code>
      </p>
      {/* File import and removal are not on the brand host's studio door (lib/admin/brand-host-studio.ts). */}
      {brandHost ? <p className="bw-note" data-shortlist-admin-elsewhere>{copy.adminOnly}</p> : (
        <OpForm op="brandWorkspace.shortlistImport" back={back} className="bw-form">
          {hiddenIds("projectId", projectId)}
          <label>
            {copy.file}
            <input type="file" name="file" accept="application/json,.json" required />
          </label>
          <button className="bw-button bw-primary" type="submit">{copy.import}</button>
        </OpForm>
      )}
      {list.length === 0 ? (
        <p className="bw-note">{copy.none}</p>
      ) : (
        <>
          <div className="bw-row">
            <p data-shortlist-summary>{interpolate(copy.summary, { total: list.length, shared, hidden, excluded, picked })}</p>
            {hidden > 0 && (
              <Form op="brandWorkspace.shortlistShare" back={back}>
                {hiddenIds("projectId", projectId)}
                {hiddenIds("shared", "true")}
                <button className="bw-button" type="submit" data-shortlist-share-all>{copy.shareAll}</button>
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
          <ShortlistTriage
            projectId={projectId}
            candidates={list}
            criteria={view?.criteria ?? null}
            newSince={new Date(Date.now() - NEW_FOR_MS).toISOString()}
            door={door}
            copy={copy}
            locale={locale}
          />
          {!brandHost && (
            <details className="bw-triage-remove">
              <summary>{copy.removeTitle}</summary>
              <OpForm op="brandWorkspace.shortlistRemove" back={back} className="bw-form">
                {hiddenIds("projectId", projectId)}
                <select name="candidateId" required aria-label={copy.removeTitle} defaultValue="">
                  <option value="" disabled>@…</option>
                  {[...list].sort((a, b) => a.handle.localeCompare(b.handle)).map((c) => <option key={c.id} value={c.id}>@{c.handle}</option>)}
                </select>
                <ConfirmCheck label={copy.removeConfirm} />
                <button className="bw-button bw-danger" type="submit">{copy.remove}</button>
              </OpForm>
            </details>
          )}
        </>
      )}
    </section>
  );
}
