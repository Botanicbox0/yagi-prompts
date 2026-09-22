"use client";
import {
  useRef,
  useState,
  useEffect,
  type ReactNode,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { AdminOperationName } from "@/lib/admin/operations";
import type { BrandCopy } from "./action-form";

/** Same registered admin dispatcher, with one-time invitation data kept out of URL queries. */
export function ManagedForm({
  op,
  b,
  children,
  submit,
}: {
  op: AdminOperationName;
  b: BrandCopy;
  children: ReactNode;
  submit: string;
}) {
  const router = useRouter(),
    request = useRef<{fingerprint:string;id:string} | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [link, setLink] = useState("");
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    data.set("_op", op);
    const fingerprint=JSON.stringify([...data.entries()]);
    if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
    data.set("requestId", request.current.id);
    setBusy(true);
    setError(false);
    setLink("");
    try {
      const response = await fetch("/admin/do", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error("save");
      request.current = null;
      if (result.invitationToken) {
        const origin = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
          ? location.origin
          : "https://brand.twings.app";
        setLink(
          `${origin}/brand/invite#token=${encodeURIComponent(result.invitationToken)}`,
        );
      } else if (
        typeof result.to === "string" &&
        result.to.startsWith("/admin/")
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
    } catch {
      // Invitation tokens cannot be recovered; a fresh invite revokes the lost one.
      // Other uncertain writes retain their idempotency key.
      if(op==="brandWorkspace.invite")request.current = null;
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      method="post"
      action="/admin/do"
      className="bw-form"
      onSubmit={send}
      aria-busy={busy}
    >
      <input type="hidden" name="_op" value={op} />
      <fieldset disabled={!ready || busy} className="bw-fields">
        {children}
      </fieldset>
      <button className="bw-button bw-primary" disabled={!ready || busy}>
        {busy ? b.working : submit}
      </button>
      {error && (
        <p role="alert" className="bw-error">
          {b.error}
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
