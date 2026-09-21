"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { PENDING_BRAND_INVITATION_KEY } from "@/lib/auth/invitation-transfer";

export type BrandCopy = Dictionary["brandWorkspace"];
export function ActionForm({
  operation,
  fixed = {},
  b,
  children,
  submit,
  redirectTo,
  className = "",
}: {
  operation: string;
  fixed?: Record<string, unknown>;
  b: BrandCopy;
  children?: ReactNode;
  submit: string;
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input: Record<string, unknown> = {
      ...Object.fromEntries(fields),
      ...fixed,
    };
    for (const key of [
      "budgetKrw",
      "views",
      "likes",
      "comments",
      "shares",
      "saves",
      "minFollowers",
      "maxFollowers",
      "targetValue",
    ]) {
      if (key in input)
        input[key] = input[key] === "" ? null : Number(input[key]);
    }
    for (const key of ["startsOn", "endsOn"])
      if (key in input && !input[key]) input[key] = null;
    if ("measuredAt" in input)
      input.measuredAt = input.measuredAt
        ? new Date(String(input.measuredAt)).toISOString()
        : null;
    if (operation === "project.create") {
      input.referenceLinks = fields
        .getAll("referenceUrl")
        .map((url, i) => ({
          url: String(url).trim(),
          note: String(fields.getAll("referenceNote")[i] ?? ""),
        }))
        .filter((x) => x.url);
      delete input.referenceUrl;
      delete input.referenceNote;
      input.criteria = {
        platforms: fields.getAll("platforms"),
        minFollowers: input.minFollowers,
        maxFollowers: input.maxFollowers,
        primaryMetric: input.primaryMetric,
        targetValue: input.targetValue,
      };
      for (const key of [
        "platforms",
        "minFollowers",
        "maxFollowers",
        "primaryMetric",
        "targetValue",
      ])
        delete input[key];
    }
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    input.requestId = request.current.id;
    setBusy(true);
    setNotice("");
    setFailed(false);
    setConflict(false);
    form
      .querySelectorAll("[aria-invalid]")
      .forEach((el) => el.removeAttribute("aria-invalid"));
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, input }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setFailed(true);
        setConflict(result.code === "conflict");
        setNotice(
          result.code === "conflict"
            ? b.conflict
            : result.code === "invalid"
              ? b.invalid
              : ["forbidden", "not_found", "sign_in_required"].includes(
                    result.code,
                  )
                ? b.denied
                : b.error,
        );
        const field =
          typeof result.field === "string"
            ? form.elements.namedItem(result.field.split(".")[0])
            : null;
        if (field instanceof HTMLElement) {
          field.setAttribute("aria-invalid", "true");
          field.focus();
        }
        return;
      }
      setNotice(b.saved);
      request.current = null;
      if (operation === "invitation.create" && result.token)
        setInviteUrl(
          `${location.origin}/brand/invite#token=${encodeURIComponent(result.token)}`,
        );
      else if (operation === "project.create" && result.id) {
        location.assign(`/brand/projects/${encodeURIComponent(result.id)}`);
        return;
      }
      else if (operation === "invitation.accept") {
        try {
          sessionStorage.removeItem(PENDING_BRAND_INVITATION_KEY);
        } catch {}
        location.assign("/brand");
        return;
      } else if (redirectTo) {
        // A push followed by refresh can refresh the old page and cancel navigation.
        // Read the newly created workspace from the server, without the old router cache.
        location.assign(redirectTo);
        return;
      }
      else if (operation === "message.send") form.reset();
      router.refresh();
    } catch {
      setFailed(true);
      setNotice(b.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={send} className={`bw-form ${className}`} aria-busy={busy}>
      <fieldset disabled={busy}>{children}</fieldset>
      <div className="bw-form-actions">
        <button className="bw-button bw-primary" disabled={busy} type="submit">
          {busy ? b.working : submit}
        </button>
        {conflict && (
          <button
            type="button"
            className="bw-button"
            onClick={() => {
              if (operation === "invitation.create") {
                request.current = null;
                setConflict(false);
                setNotice(b.inviteRetry);
              } else router.refresh();
            }}
          >
            {operation === "invitation.create" ? b.newInvitation : b.refresh}
          </button>
        )}
      </div>
      {notice && (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "bw-error" : "bw-success"}
        >
          {notice}
        </p>
      )}
      {inviteUrl && (
        <div className="bw-note">
          <p>{b.inviteReady}</p>
          <label>
            {b.inviteToken}
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <p>{b.inviteExpiry}</p>
        </div>
      )}
    </form>
  );
}
