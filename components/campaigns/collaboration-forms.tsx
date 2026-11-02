"use client";
import {
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { collaborationCopy } from "@/messages/campaign-collaboration";
import {
  captureInvitationTransfer,
  forgetInvitationTransfer,
} from "@/lib/campaigns/collaboration/invitation-transfer";
const inputClass =
  "mt-2 w-full rounded-lg border border-hairline bg-transparent p-3 text-sm";
const buttonClass =
  "rounded-full bg-accent px-5 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
export function CollaborationForm({
  locale,
  operation,
  hidden = {},
  children,
  label,
  file = false,
  onSuccess,
}: {
  locale: string;
  operation: string;
  hidden?: Record<string, string>;
  children: ReactNode;
  label: string;
  file?: boolean;
  onSuccess?: (r: Record<string, unknown>) => void;
}) {
  const t = collaborationCopy(locale),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [link, setLink] = useState("");
  const pending = useRef({ fingerprint: "", id: "" });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      f = new FormData(form);
    setBusy(true);
    setStatus("");
    try {
      let body: BodyInit, headers: HeadersInit | undefined;
      const fingerprint = JSON.stringify(
        await Promise.all(
          [...f.entries()].map(async ([k, v]) => [
            k,
            typeof v === "string"
              ? v
              : [
                  v.name,
                  v.size,
                  v.type,
                  Array.from(
                    new Uint8Array(
                      await crypto.subtle.digest(
                        "SHA-256",
                        await v.arrayBuffer(),
                      ),
                    ),
                  ),
                ],
          ]),
        ),
      );
      if (pending.current.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: crypto.randomUUID() };
      if (file) {
        f.set("requestId", pending.current.id);
        body = f;
      } else {
        const values: Record<string, unknown> = {
          ...Object.fromEntries(f),
          requestId: pending.current.id,
        };
        if (operation === "invitation.revoke") delete values.requestId;
        if (values.email === "") delete values.email;
        body = JSON.stringify({ operation, input: values });
        headers = { "Content-Type": "application/json" };
      }
      const response = await fetch("/api/campaign-collaboration", {
        method: "POST",
        headers,
        body,
      });
      const r = await response.json();
      if (!response.ok || !r.ok) throw Error(String(r.code));
      setStatus(t.done);
      pending.current = { fingerprint: "", id: "" };
      if (r.token && r.slug) {
        const origin = ["brand.twings.app", "admin.twings.app"].includes(
          location.hostname,
        )
          ? "https://twings.app"
          : location.origin;
        setLink(
          `${origin}/campaigns/${encodeURIComponent(r.slug)}/join#token=${r.token}`,
        );
        router.refresh();
      } else {
        form.reset();
        router.refresh();
      }
      onSuccess?.(r);
    } catch (error) {
      if ((error as Error).message === "invitation_retry") {
        pending.current = { fingerprint: "", id: "" };
        router.refresh();
      }
      setStatus(
        t.errors[(error as Error).message as keyof typeof t.errors] ?? t.failed,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" data-collaboration-form>
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {children}
      <button disabled={busy} className={buttonClass}>
        {busy ? t.pending : label}
      </button>
      <p role="status" className="text-sm" aria-live="polite">
        {status}
      </p>
      {link && (
        <div className="rounded-xl border border-hairline p-4">
          <label className="text-sm font-medium">
            {t.link}
            <input
              readOnly
              value={link}
              className={inputClass}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <p className="mt-3 text-sm opacity-70">{t.linkHint}</p>
        </div>
      )}
    </form>
  );
}
export function InvitationForm({
  locale,
  campaignId,
}: {
  locale: string;
  campaignId: string;
}) {
  const t = collaborationCopy(locale);
  return (
    <CollaborationForm
      locale={locale}
      operation="invitation.create"
      hidden={{ campaignId }}
      label={t.invite}
    >
      <label className="block text-sm">
        {t.email}
        <input
          className={inputClass}
          type="email"
          name="email"
          autoComplete="email"
          spellCheck={false}
          maxLength={254}
        />
      </label>
      <p className="text-sm opacity-70">{t.emailHint}</p>
    </CollaborationForm>
  );
}
export function ParticipantForms({
  locale,
  applicationId,
}: {
  locale: string;
  applicationId: string;
}) {
  const t = collaborationCopy(locale);
  return (
    <div className="space-y-8">
      <CollaborationForm
        locale={locale}
        operation="message.send"
        hidden={{ applicationId }}
        label={t.send}
      >
        <label className="block text-sm">
          {t.message}
          <textarea
            className={inputClass}
            name="body"
            rows={4}
            maxLength={4000}
            required
          />
        </label>
      </CollaborationForm>
      <CollaborationForm
        locale={locale}
        operation="file.upload"
        hidden={{ applicationId }}
        label={t.upload}
        file
      >
        <label className="block text-sm">
          {t.file}
          <input
            className={inputClass}
            type="file"
            name="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            required
          />
        </label>
        <p className="text-sm opacity-70">{t.fileHint}</p>
      </CollaborationForm>
    </div>
  );
}
export function JoinForm({
  locale,
  slug,
  signInHref,
  signedIn,
  termsVersion,
}: {
  locale: string;
  slug: string;
  signInHref: string;
  signedIn: boolean;
  termsVersion: string;
}) {
  const t = collaborationCopy(locale),
    router = useRouter();
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  useEffect(() => {
    const transfer = captureInvitationTransfer({
      slug,
      hash: location.hash,
      storage: () => sessionStorage,
    });
    setToken(transfer.token);
    if (!transfer.persisted && !signedIn) setStatus(t.storageBlocked);
    try {
      if (location.hash)
        history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}`,
        );
    } catch {
      /* Do not block direct acceptance when history is restricted. */
    }
  }, [slug, signedIn, t.storageBlocked]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/campaign-collaboration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "invitation.accept",
          input: {
            token,
            slug,
            termsVersion,
            pitch: String(f.get("pitch")),
            snsUrl: String(f.get("snsUrl")),
            followerCount: Number(f.get("followerCount")),
            consent: f.get("consent") === "on",
          },
        }),
      });
      const result = await r.json();
      if (!r.ok || !result.ok) throw Error(String(result.code));
      forgetInvitationTransfer(slug, () => sessionStorage);
      router.push(`/campaigns/participations/${result.id}`);
    } catch (error) {
      setStatus(
        t.errors[(error as Error).message as keyof typeof t.errors] ?? t.failed,
      );
      setBusy(false);
    }
  }
  if (!token) return <p role="status">{t.tokenMissing}</p>;
  if (!signedIn)
    return (
      <div>
        <p role="status" className="mb-4 text-sm" aria-live="polite">
          {status}
        </p>
        <a href={signInHref} className={buttonClass}>
          {t.signIn}
        </a>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-5" data-campaign-join>
      <label className="block text-sm">
        {t.pitch}
        <textarea
          name="pitch"
          required
          minLength={10}
          maxLength={300}
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        {t.snsUrl}
        <input
          type="url"
          name="snsUrl"
          autoComplete="url"
          spellCheck={false}
          required
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        {t.followers}
        <input
          type="number"
          name="followerCount"
          inputMode="numeric"
          required
          min={0}
          max={100000000}
          className={inputClass}
        />
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-1" />
        {t.consent}
      </label>
      <button className={buttonClass} disabled={busy}>
        {busy ? t.pending : t.accept}
      </button>
      <p role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
