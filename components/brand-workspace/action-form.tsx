"use client";
import { useId, useRef, useState, useEffect, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { PENDING_BRAND_INVITATION_KEY } from "@/lib/auth/invitation-transfer";
import { createFieldFocus, locateField, revealField } from "./form-errors";
import { ConfirmStep, toneClass, useConfirmStep, type ButtonTone, type ConfirmCopy } from "./confirm-step";
import { invitationFailure } from "./invite-outcome";
import { invitationLanding } from "@/lib/brands/workspace/selection";

export type BrandCopy = Dictionary["brandWorkspace"];
export function ActionForm({
  operation,
  fixed = {},
  b,
  children,
  submit,
  redirectTo,
  className = "",
  disabled = false,
  confirm,
  tone = "primary",
  successNotice,
  onSuccess,
}: {
  operation: string;
  fixed?: Record<string, unknown>;
  b: BrandCopy;
  children?: ReactNode;
  submit: string;
  redirectTo?: string;
  className?: string;
  disabled?: boolean;
  /** Ask once more, inline, before a removal or disclosure is sent. */
  confirm?: ConfirmCopy;
  tone?: ButtonTone;
  /** Replaces the generic "Saved." after a successful send. */
  successNotice?: string;
  /** Runs once after a successful send, before any navigation (the campaign wizard clears its draft). */
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const fieldFocus = useRef(createFieldFocus());
  const step = useConfirmStep(Boolean(confirm));
  const confirmId = useId();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [switchAccount, setSwitchAccount] = useState(false);
  // Runs after the commit that re-enables the fieldset; focusing earlier is silently ignored.
  useEffect(() => {
    if (!busy) fieldFocus.current.flush();
  }, [busy, notice]);
  async function send(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLElement | null | undefined;
    if (submitter?.dataset?.signOut === "true") return;
    event.preventDefault();
    if (busy || disabled || inFlight.current) return;
    if (step.intercept(event)) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input: Record<string, unknown> = {
      ...Object.fromEntries(fields),
      ...fixed,
    };
    for (const key of [
      "expectedRevision",
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
    // Submitted array index → DOM row, for arrays whose blank rows are dropped before posting.
    const submittedRows: Record<string, number[]> = {};
    if (operation === "project.create") {
      const references = fields
        .getAll("referenceUrl")
        .map((url, i) => ({
          url: String(url).trim(),
          note: String(fields.getAll("referenceNote")[i] ?? ""),
          row: i,
        }))
        .filter((x) => x.url);
      submittedRows.referenceLinks = references.map((x) => x.row);
      input.referenceLinks = references.map(({ url, note }) => ({ url, note }));
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
    // Secondary usage: ticked subjects ("kind:id") and hint chips are lists; an unticked list is sent
    // empty and stored as unknown. The acceptance box is a real boolean the server requires.
    if (operation === "usage.inquire") {
      input.subjects = fields.getAll("subject").map((raw) => {
        const [kind, id] = String(raw).split(":");
        return { kind, id };
      });
      input.hints = fields.getAll("hints").map(String);
      delete input.subject;
    }
    if (operation === "usage.accept") input.confirmed = fields.get("confirmed") === "on";
    if (operation === "identity.save") input.paletteOnly = fields.get("paletteOnly") === "on";
    if (operation === "look.save") input.skinProtect = fields.get("skinProtect") === "on";
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    input.requestId = request.current.id;
    inFlight.current = true;
    fieldFocus.current.clear();
    setBusy(true);
    setNotice("");
    setFailed(false);
    setConflict(false);
    setSwitchAccount(false);
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
        if (operation === "invitation.accept") {
          const outcome = invitationFailure(result.code, b);
          setNotice(outcome.notice);
          setSwitchAccount(outcome.switchAccount);
          return;
        }
        setConflict(result.code === "conflict");
        setNotice(
          result.code === "conflict"
            ? b.conflict
            : result.code === "invalid"
              ? b.invalid
              : result.code === "rate_limited"
                ? b.errors.rateLimited
                : ["forbidden", "not_found", "sign_in_required"].includes(
                      result.code,
                    )
                  ? b.denied
                  : b.error,
        );
        const field =
          typeof result.field === "string" ? locateField(form, result.field, submittedRows) : null;
        if (field) {
          field.setAttribute("aria-invalid", "true");
          revealField(field);
          fieldFocus.current.request(field);
        }
        return;
      }
      setNotice(
        operation === "invitation.create" && result.mailState === "sent"
          ? b.inviteMailSent
          : operation === "invitation.create" && (result.mailState === "failed" || result.mailState === "skipped")
            ? b.inviteMailFailed
            : (successNotice ?? b.saved),
      );
      request.current = null;
      onSuccess?.();
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
        location.assign(invitationLanding(result));
        return;
      } else if (redirectTo) {
        // A push followed by refresh can refresh the old page and cancel navigation.
        // Read the newly created workspace from the server, without the old router cache.
        location.assign(redirectTo);
        return;
      }
      else if ((operation === "message.send" || operation === "support.send" || operation === "usage.message" || operation === "usage.inquire" || operation === "memory.record" || operation === "look.save")) form.reset();
      router.refresh();
    } catch {
      setFailed(true);
      setNotice(b.error);
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (step.open) step.close();
    }
  }
  return (
    <form method="post" action="/api/brand-workspace" onSubmit={send} className={`bw-form ${className}`} aria-busy={busy}>
      <fieldset disabled={!ready || busy || disabled}>{children}</fieldset>
      {confirm && step.open ? (
        <ConfirmStep id={confirmId} copy={confirm} cancel={b.confirm.cancel} busy={busy} working={b.working}
          tone={tone} accept={step.accept} onCancel={step.close} />
      ) : null}
      <div className="bw-form-actions">
        {!(confirm && step.open) && (
          <button ref={step.trigger} className={toneClass(tone)} disabled={!ready || busy || disabled} type="submit">
            {busy ? b.working : submit}
          </button>
        )}
        {switchAccount && (
          // Posts this form natively to sign-out (forms cannot nest); `send` lets it through untouched.
          // Only fields in the DOM travel, and the invitation token is never one of them.
          <button type="submit" className="bw-button" formAction="/auth/signout" formMethod="post" formNoValidate
            data-sign-out="true" data-invite-switch-account>
            {b.inviteSignOut}
          </button>
        )}
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
