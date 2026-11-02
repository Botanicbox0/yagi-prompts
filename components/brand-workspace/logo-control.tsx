"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, type BrandCopy } from "./action-form";
import { BrandAvatar } from "./brand-avatar";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Owner-only logo upload for the brand settings page. The raw file goes to the private logo route,
 * which re-checks ownership and the actual bytes; the checks here only spare a pointless upload.
 */
export function LogoControl({ organizationId, name, logoUrl, logoRevision, b }: {
  organizationId: string; name: string; logoUrl: string | null; logoRevision: number; b: BrandCopy;
}) {
  const router = useRouter(), t = b.identity, inputId = useId(), hintId = useId();
  const request = useRef<{ key: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [failed, setFailed] = useState(false);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !TYPES.includes(file.type)) {
      setFailed(true); setMessage(t.logoInvalid); return;
    }
    // Same file retried after a lost response reuses its request id, so it is stored once.
    const key = `${file.name}:${file.size}:${file.lastModified}:${logoRevision}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch(`/api/brand-workspace/organizations/${organizationId}/logo?requestId=${request.current.id}&expectedRevision=${logoRevision}`, {
        method: "POST", headers: { "Content-Type": file.type }, body: file,
      });
      const result = await response.json().catch(() => null);
      if (!result?.ok) {
        setFailed(true);
        setMessage(result?.code === "conflict" ? b.conflict : result?.code === "invalid" ? t.logoInvalid : b.error);
        return;
      }
      request.current = null;
      setMessage(t.logoSaved);
      router.refresh();
    } catch {
      setFailed(true); setMessage(b.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bw-logo-control" data-brand-logo-control>
      <div className="bw-logo-current">
        <BrandAvatar name={name} logoUrl={logoUrl} />
        {!logoUrl && <p className="bw-muted">{t.logoNone}</p>}
      </div>
      <form onSubmit={upload} className="bw-form bw-logo-form" aria-busy={busy}>
        <label htmlFor={inputId}>{t.logoFile}</label>
        <input id={inputId} name="file" type="file" accept={TYPES.join(",")} required aria-describedby={hintId} disabled={busy} />
        <p id={hintId} className="bw-muted">{t.logoHint}</p>
        <button type="submit" className="bw-button bw-primary" disabled={busy}>{busy ? t.logoUploading : t.logoUpload}</button>
        <p role={failed ? "alert" : "status"} className={failed ? "bw-error" : "bw-muted"}>{message}</p>
      </form>
      {logoUrl && (
        <ActionForm operation="organization.logo.remove" fixed={{ organizationId, expectedRevision: logoRevision }} b={b}
          submit={t.logoRemove} tone="danger" confirm={{ prompt: t.logoRemoveConfirm, action: t.logoRemove }} />
      )}
    </div>
  );
}
