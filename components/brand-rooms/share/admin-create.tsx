"use client";
/**
 * The team makes a share link from a project's desk (docs/BRAND-ROOMS-FEEDBACK.md §4) with the brand
 * dialog's options, through the registered `brand_rooms.share.create` (`/admin/do`). The token comes back
 * once in the JSON answer and is shown here as the full address; it never rides in a redirect or a query.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { SHARE_EXPIRY_CHOICES, SHARE_LIMITS, sharePath } from "@/lib/brand-rooms/share-contracts";
import type { roomsReviewEn } from "@/messages/rooms-review";
import type { adminConsoleEn } from "@/messages/admin-console";
import { announceShareRevoked, onShareRevoked } from "./revoked";

type ShareCopy = (typeof roomsReviewEn)["share"];
type DeskCopy = (typeof adminConsoleEn)["roomDesk"];

export interface AdminShareTarget {
  /** `review:<id>` or `storyboard:<id>`. */
  value: string;
  label: string;
}

/** The admin host does not serve `/s/…`; its links point at the brand host. Local and preview hosts serve it themselves. */
function shareOrigin(current: { hostname: string; origin: string }): string {
  return current.hostname === "admin.twings.app" ? "https://brand.twings.app" : current.origin;
}

const ERRORS: Record<string, keyof ShareCopy["errors"]> = {
  notFound: "not_found",
  invalid: "invalid",
  brandConflict: "limit_reached",
  forbidden: "forbidden",
};

/**
 * Turn one of the project's links off from the desk (`brand_rooms.share.revoke`, scoped to the project).
 * With script it posts for JSON and refreshes the list in place, so the 공유 링크 tab and the conversation
 * stay where they are; without script the form posts and the operation returns to `back` (the same tab).
 */
export function AdminShareRevoke({
  shareId,
  organizationId,
  projectId,
  back,
  label,
  failed,
}: {
  shareId: string;
  organizationId: string;
  projectId: string;
  back: string;
  label: string;
  failed: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/admin/do", { method: "POST", body: new FormData(event.currentTarget), credentials: "same-origin", headers: { Accept: "application/json" } });
      const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (result?.ok) {
        // The "link made" box must not keep offering an address that no longer opens.
        announceShareRevoked(shareId);
        router.refresh();
      } else setError(failed);
    } catch {
      setError(failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form method="post" action="/admin/do" encType="multipart/form-data" onSubmit={submit} aria-busy={busy}>
      <input type="hidden" name="_op" value="brand_rooms.share.revoke" />
      <input type="hidden" name="_back" value={back} />
      <input type="hidden" name="shareId" value={shareId} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="projectId" value={projectId} />
      <button className="bw-button" type="submit" disabled={busy} data-admin-desk-share-revoke={shareId}>
        {label}
      </button>
      {error && (
        <p role="alert" className="bw-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function AdminShareCreate({
  organizationId,
  projectId,
  back,
  targets,
  copy,
  desk,
}: {
  organizationId: string;
  projectId: string;
  back: string;
  targets: AdminShareTarget[];
  copy: ShareCopy;
  desk: DeskCopy;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState("");
  const [copied, setCopied] = useState(false);
  // A link turned off on this tab may be the one shown here: stop offering it (any turn-off clears the box).
  useEffect(
    () =>
      onShareRevoked(() => {
        setMade("");
        setCopied(false);
      }),
    [],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const passphrase = String(data.get("passphrase") ?? "").trim();
    if (passphrase && passphrase.length < SHARE_LIMITS.passphraseMin) {
      setError(copy.passphraseHint);
      return;
    }
    setBusy(true);
    setError("");
    setMade("");
    setCopied(false);
    try {
      const response = await fetch("/admin/do", { method: "POST", body: data, credentials: "same-origin", headers: { Accept: "application/json" } });
      const result = (await response.json().catch(() => (response.status === 404 ? { ok: false, code: "notFound" } : null))) as { ok?: boolean; code?: string; shareToken?: string } | null;
      if (result?.ok && typeof result.shareToken === "string") {
        setMade(new URL(sharePath(result.shareToken), shareOrigin(window.location)).toString());
        (event.target as HTMLFormElement).reset();
        router.refresh();
      } else {
        setError(copy.errors[ERRORS[result?.code ?? ""] ?? "generic"]);
      }
    } catch {
      setError(copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(made);
      setCopied(true);
    } catch {
      setError(copy.copyFailed);
    }
  }

  if (targets.length === 0) return <p className="bw-muted">{desk.noTargets}</p>;
  return (
    <form method="post" action="/admin/do" className="bw-form" onSubmit={submit} aria-busy={busy} data-admin-share-create>
      <input type="hidden" name="_op" value="brand_rooms.share.create" />
      <input type="hidden" name="_back" value={back} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="projectId" value={projectId} />
      <label>
        {desk.target}
        <select name="target" required defaultValue={targets[0]!.value} disabled={busy}>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="bw-check">
        <input type="checkbox" name="allowComments" defaultChecked disabled={busy} />
        <span>{copy.allowComments}</span>
      </label>
      <label className="bw-check">
        <input type="checkbox" name="allowDownload" disabled={busy} />
        <span>{copy.allowDownload}</span>
      </label>
      <label>
        {copy.expiry}
        <select name="expiresInDays" defaultValue={String(SHARE_LIMITS.expiryDaysDefault)} disabled={busy}>
          {SHARE_EXPIRY_CHOICES.map((days) => (
            <option key={days} value={days}>
              {days === 1 ? copy.expiryDay : copy.expiryDays.replace("{days}", String(days))}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.passphrase}
        <input name="passphrase" type="text" autoComplete="off" maxLength={SHARE_LIMITS.passphraseMax} disabled={busy} />
      </label>
      <p className="bw-muted">{copy.passphraseHint}</p>
      <button className="bw-button" type="submit" disabled={!ready || busy} data-admin-share-create-submit>
        {busy ? copy.creating : copy.create}
      </button>
      {error && (
        <p role="alert" className="bw-error">
          {error}
        </p>
      )}
      {made && (
        <div role="status" className="bw-note" data-admin-share-made>
          <p>
            <strong>{copy.createdTitle}</strong> {copy.createdNote}
          </p>
          <label>
            {copy.linkLabel}
            <input readOnly value={made} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" className="bw-button" onClick={() => void copyLink()}>
            {copied ? copy.copied : copy.copy}
          </button>
        </div>
      )}
    </form>
  );
}
