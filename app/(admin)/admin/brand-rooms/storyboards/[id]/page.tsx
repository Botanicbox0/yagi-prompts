import "@/app/(brand)/workspace.css";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell, ConfirmCheck, OpForm, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader, StatusPill, type AdminTone } from "@/components/admin/patterns";
import { AdminStoryboardEditor } from "@/components/brand-rooms/storyboard/admin-editor";
import { StoryboardReadOnly } from "@/components/brand-rooms/storyboard";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { staffStoryboardDetail } from "@/lib/brand-rooms/storyboards";
import { STORYBOARD_ADMIN_PATH, STORYBOARD_LIMITS, storyboardAdminHref, type StoryboardStatus } from "@/lib/brand-rooms/storyboard-contracts";

/**
 * `/admin/brand-rooms/storyboards/[id]` — one storyboard version, the team's side (docs/BRAND-ROOMS.md
 * §5). A draft opens in the same editor the brand uses; saving, sharing, a new version and deleting go
 * through the registered `brand_rooms.storyboard.*` operations and are stored as the team
 * (`created_role = 'studio'`). A shared board is read-only here as it is for the brand.
 */
export const dynamic = "force-dynamic";

const TONES: Record<StoryboardStatus, AdminTone> = { draft: "hold", shared: "action", changes_requested: "progress", approved: "done" };

export default async function AdminStoryboard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, sql, locale, { id }, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), params, searchParams]);
  const dict = getDictionary(locale);
  const s = dict.roomsStoryboard;
  const a = s.admin;
  if (!sql) return <p role="alert">{dict.brandWorkspace.unavailable}</p>;
  const detail = await staffStoryboardDetail({ sql, media: createStudioMediaStore() }, viewer, id);
  if (!detail.ok) notFound();
  const board = detail.board;
  const back = storyboardAdminHref(board.id);
  const draft = board.status === "draft";
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-storyboard={board.id} data-storyboard-status={board.status}>
        <AdminPageHeader
          back={{ href: STORYBOARD_ADMIN_PATH, label: a.back }}
          eyebrow={interpolate(a.brandOf, { brand: detail.organizationName, project: detail.projectTitle })}
          title={`${board.title} · ${interpolate(s.version, { n: board.version })}`}
          status={<StatusPill tone={TONES[board.status]}>{s.status[board.status]}</StatusPill>}
          lede={`${s.madeBy[board.createdRole]} · ${a.source[board.source]}`}
        />

        <div className="flex flex-wrap items-end gap-3 mt-2" data-admin-storyboard-actions>
          {detail.versions.length > 1 ? (
            <nav aria-label={s.versionLabel} className="admin-filters">
              <ul>
                {detail.versions.map((v) => (
                  <li key={v.id}>
                    <a href={storyboardAdminHref(v.id)} aria-current={v.id === board.id ? "true" : undefined}>
                      {interpolate(s.version, { n: v.version })} · {s.status[v.status]}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <OpForm op="brand_rooms.storyboard.update" back={back} className="bw-form flex flex-wrap items-end gap-2">
            <input type="hidden" name="storyboardId" value={board.id} />
            <label>
              {s.editor.title}
              <input name="title" required minLength={1} maxLength={STORYBOARD_LIMITS.titleMax} defaultValue={board.title} />
            </label>
            <button className="bw-button" type="submit">
              {a.rename}
            </button>
          </OpForm>
          <OpForm op="brand_rooms.storyboard.version" back={back}>
            <input type="hidden" name="storyboardId" value={board.id} />
            <button className="bw-button" type="submit" data-admin-storyboard-version>
              {a.newVersion}
            </button>
          </OpForm>
          <details>
            <summary>{a.delete}</summary>
            <OpForm op="brand_rooms.storyboard.delete" back={back} className="bw-form">
              <input type="hidden" name="storyboardId" value={board.id} />
              <ConfirmCheck label={a.deleteCheck} />
              <button className="bw-button" type="submit">
                {a.delete}
              </button>
            </OpForm>
          </details>
        </div>

        {detail.previous ? (
          <p className="bw-muted mt-3" data-admin-storyboard-changed>
            {detail.changedFrameIds.length === 0 && detail.removedCount === 0
              ? interpolate(s.sameAsBefore, { prev: detail.previous.version })
              : [
                  detail.changedFrameIds.length ? interpolate(s.changedSummary, { n: detail.changedFrameIds.length, prev: detail.previous.version }) : null,
                  detail.removedCount ? interpolate(s.removedSummary, { n: detail.removedCount }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        ) : null}

        <div className="mt-4">
          {draft ? (
            <>
              {detail.pendingCount > 0 ? <p className="bw-muted">{interpolate(a.pending, { n: detail.pendingCount })}</p> : null}
              <AdminStoryboardEditor board={board} copy={s} back={back} />
            </>
          ) : (
            <>
              <p className="bw-muted">{a.readOnly}</p>
              <StoryboardReadOnly board={board} locale={locale === "en" ? "en" : "ko"} copy={s} />
            </>
          )}
        </div>

        <p className="bw-muted mt-6 text-[12px]" data-admin-storyboard-cli>
          <code>{interpolate(a.cliHint, { id: board.projectId })}</code>
        </p>
      </div>
    </AdminShell>
  );
}
