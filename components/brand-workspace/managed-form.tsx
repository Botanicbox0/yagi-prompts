"use client";
import {
  useId,
  useRef,
  useState,
  useEffect,
  type ReactNode,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { AdminOperationName } from "@/lib/admin/operations";
import type { BrandCopy } from "./action-form";
import { ConfirmStep, toneClass, useConfirmStep, type ButtonTone, type ConfirmCopy } from "./confirm-step";

class Refused extends Error {
  constructor(readonly code: string) { super(code); }
}

/**
 * Where an invitation link points (H1). Only the production admin host hands out production brand
 * links; local and Vercel preview hosts serve `/brand` themselves (consumer surface), so their links
 * stay on the deployment that issued them and preview QA never lands on production.
 */
export function invitationOrigin(current: { hostname: string; origin: string }): string {
  return current.hostname === "admin.twings.app" ? "https://brand.twings.app" : current.origin;
}

/** `/admin/do` failure codes, stated honestly instead of blaming the connection for every refusal. */
export function managedErrorMessage(b: BrandCopy, code: string | null, messages: Partial<Record<string, string>> = {}): string {
  const specific = code ? messages[code] : undefined;
  if (specific) return specific;
  if (code === "staleReview" || code === "brandConflict") return b.conflict;
  if (code === "invalid" || code === "brandNotActive" || code === "brandConsentRequired" || code === "brandNotShared") return b.errors.adminInvalid;
  if (code === "forbidden" || code === "notFound") return b.errors.adminDenied;
  return b.error;
}

/** Same registered admin dispatcher, with one-time invitation data kept out of URL queries. */
export function ManagedForm({
  op,
  b,
  children,
  submit,
  confirm,
  tone = "primary",
  messages,
  action = "/admin/do",
}: {
  op: AdminOperationName;
  b: BrandCopy;
  children: ReactNode;
  submit: string;
  /** Ask once more, inline, before a disclosure or removal is sent. */
  confirm?: ConfirmCopy;
  tone?: ButtonTone;
  /** Admin-dictionary sentences for specific refusal codes (e.g. `brandNotShared`), from the page. */
  messages?: Partial<Record<string, string>>;
  /** The brand host's studio door (lib/admin/brand-host-studio.ts); it answers with brand-host destinations. */
  action?: string;
}) {
  const router = useRouter(),
    request = useRef<{fingerprint:string;id:string} | null>(null),
    inFlight = useRef(false);
  const step = useConfirmStep(Boolean(confirm));
  const confirmId = useId();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState("");
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || inFlight.current) return;
    if (step.intercept(e)) return;
    const data = new FormData(e.currentTarget);
    data.set("_op", op);
    const fingerprint=JSON.stringify([...data.entries()]);
    if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
    data.set("requestId", request.current.id);
    inFlight.current = true;
    setBusy(true);
    setError("");
    setLink("");
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data,
      });
      // A lost admin session answers 404 with no body; that is a refusal, not a network error.
      const result = await response.json().catch(() => (response.status === 404 ? { ok: false, code: "notFound" } : null));
      if (!result) throw Error("save");
      if (!response.ok || !result.ok) throw new Refused(typeof result.code === "string" ? result.code : "unknown");
      request.current = null;
      if (result.invitationToken) {
        const origin = invitationOrigin(location);
        setLink(
          `${origin}/brand/invite#token=${encodeURIComponent(result.invitationToken)}`,
        );
      } else if (
        typeof result.to === "string" &&
        (result.to.startsWith("/admin/") || result.to === "/brand" || result.to.startsWith("/brand/"))
      ) {
        if (result.to === location.pathname) {
          router.refresh();
          return;
        }
        location.assign(
          result.to +
            (op.startsWith("brandWorkspace.contract") ? "#contracts" : ""),
        );
        return;
      }
      router.refresh();
    } catch (failure) {
      // Invitation tokens cannot be recovered; a fresh invite revokes the lost one.
      // Other uncertain writes retain their idempotency key.
      if(op==="brandWorkspace.invite")request.current = null;
      setError(managedErrorMessage(b, failure instanceof Refused ? failure.code : null, messages));
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (step.open) step.close();
    }
  }
  return (
    <form
      method="post"
      action={action}
      className="bw-form"
      onSubmit={send}
      aria-busy={busy}
    >
      <input type="hidden" name="_op" value={op} />
      <fieldset disabled={!ready || busy} className="bw-fields">
        {children}
      </fieldset>
      {confirm && step.open ? (
        <ConfirmStep id={confirmId} copy={confirm} cancel={b.confirm.cancel} busy={busy} working={b.working}
          tone={tone} accept={step.accept} onCancel={step.close} />
      ) : (
        <button ref={step.trigger} className={toneClass(tone)} disabled={!ready || busy}>
          {busy ? b.working : submit}
        </button>
      )}
      {error && (
        <p role="alert" className="bw-error">
          {error}
        </p>
      )}
      {link && (
        <div role="status" className="bw-note">
          <p>{b.managed.inviteReady}</p>
          <label>
            {b.managed.inviteLink}
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        </div>
      )}
    </form>
  );
}
