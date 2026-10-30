import { randomUUID } from "node:crypto";
import {
  OpForm,
  Field,
  INPUT,
  BUTTON,
  BUTTON_PRIMARY,
  Panel,
} from "@/components/admin/chrome";
import { collaborationCopy } from "@/messages/campaign-collaboration";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { loadCollaborationBindingOptions } from "@/lib/campaigns/collaboration/service";
export async function CollaborationBinding({
  campaignId,
  locale,
  projectId,
}: {
  campaignId: string;
  locale: string;
  projectId?: string;
}) {
  const t = collaborationCopy(locale),
    [sql, viewer] = await Promise.all([getSqlRunner(), getViewer()]);
  const [state, pendingInvites] = sql
    ? await Promise.all([
        loadCollaborationBindingOptions({ sql }, viewer, campaignId),
        sql
          .query<{ id: string; invited_email: string | null }>(
            "select id, invited_email from campaign_participant_invites where campaign_id=$1 and revoked_at is null and accepted_at is null order by created_at desc limit 20",
            [campaignId],
          )
          .then((r) => r.rows)
          .catch(() => [] as Array<{ id: string; invited_email: string | null }>),
      ])
    : [null, []];
  if (!state) return null;
  return (
    <Panel title={t.bind}>
      <p className="mb-4 text-sm opacity-70">{t.bindHint}</p>
      {state.projectId ? (
        <p className="text-sm">
          {state.options.find((p) => p.id === state.projectId)?.label ??
            t.readOnly}
        </p>
      ) : state.options.length ? (
        <OpForm
          op="campaignCollaboration.bind"
          back={`/admin/campaigns/${campaignId}`}
        >
          <input type="hidden" name="campaignId" value={campaignId} />
          <Field label={t.bind}>
            <select
              className={INPUT}
              name="projectId"
              required
              defaultValue={projectId ?? ""}
            >
              <option value="" disabled>
                {t.bind}
              </option>
              {state.options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <button className={`${BUTTON_PRIMARY} mt-4`}>{t.save}</button>
        </OpForm>
      ) : (
        <p className="text-sm">{t.unavailable}</p>
      )}
      {pendingInvites.length > 0 && (
        <ul className="mt-4 divide-y divide-hairline border-t border-hairline pt-3 font-mono text-xs">
          {pendingInvites.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span>{inv.invited_email ?? inv.id.slice(0, 8)}</span>
              <OpForm
                op="campaignCollaboration.revoke"
                back={`/admin/campaigns/${campaignId}`}
              >
                <input type="hidden" name="invitationId" value={inv.id} />
                <button type="submit" className={BUTTON}>
                  {t.revoke}
                </button>
              </OpForm>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
export function CollaborationAdminForms({
  applicationId,
  locale,
}: {
  applicationId: string;
  locale: string;
}) {
  const t = collaborationCopy(locale),
    back = `/admin/campaigns/participants/${applicationId}`;
  return (
    <div className="space-y-8">
      <OpForm op="campaignCollaboration.message" back={back}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="requestId" value={randomUUID()} />
        <Field label={t.message}>
          <textarea
            className={INPUT}
            name="body"
            required
            maxLength={4000}
            rows={4}
          />
        </Field>
        <button className={`${BUTTON_PRIMARY} mt-4`}>{t.send}</button>
      </OpForm>
      <OpForm op="campaignCollaboration.file" back={back}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="requestId" value={randomUUID()} />
        <Field label={t.file} hint={t.fileHint}>
          <input
            type="file"
            name="file"
            required
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className={INPUT}
          />
        </Field>
        <button className={`${BUTTON_PRIMARY} mt-4`}>{t.upload}</button>
      </OpForm>
    </div>
  );
}
