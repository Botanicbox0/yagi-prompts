"use client";
/**
 * The team's "upload a draft into a room" form (`/admin/brand-rooms/reviews`, docs/BRAND-ROOMS.md §6).
 *
 * The bytes never pass through a function: ask `/api/brand-rooms/reviews/upload` for an address (a signed
 * staging URL in the cloud, this app's own PUT locally), put the file there with progress, then run the
 * registered `brand_rooms.delivery.add` operation through `/admin/do`, which checks the bytes and makes the
 * studio file and the draft. On success the browser lands on that draft's review page.
 */
import { useState } from "react";
import { uploadMime } from "@/lib/admin/direct-upload";
import type { roomsReviewEn } from "@/messages/rooms-review";

type AdminCopy = (typeof roomsReviewEn)["admin"];

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

export interface DeliveryStackOption {
  reviewId: string;
  title: string;
  version: number;
}

function put(url: string, file: File, mime: string, onProgress: (percent: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.withCredentials = url.startsWith("/");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(file);
  });
}

export function DeliveryUpload({ organizationId, projectId, stacks, copy }: { organizationId: string; projectId: string; stacks: DeliveryStackOption[]; copy: AdminCopy }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [stack, setStack] = useState("");
  const [phase, setPhase] = useState<{ kind: "idle" } | { kind: "uploading"; percent: number } | { kind: "delivering" }>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const busy = phase.kind !== "idle";

  async function submit() {
    if (!file || !title.trim() || busy) return;
    setError(null);
    const mime = uploadMime(file.name, file.type);
    setPhase({ kind: "uploading", percent: 0 });
    let address: { ok?: boolean; error?: string; key?: string; url?: string } | null = null;
    try {
      const response = await fetch("/api/brand-rooms/reviews/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime, size: file.size, name: file.name }),
      });
      address = response.status === 404 ? { error: "session" } : ((await response.json().catch(() => null)) as typeof address);
    } catch {
      address = null;
    }
    if (!address?.ok || !address.key || !address.url) {
      setPhase({ kind: "idle" });
      setError(address?.error === "too_large" ? copy.tooLarge : address?.error === "bad_type" ? copy.badType : address?.error === "session" ? copy.session : copy.failed);
      return;
    }
    const status = await put(address.url, file, mime, (percent) => setPhase({ kind: "uploading", percent }));
    if (status < 200 || status >= 300) {
      setPhase({ kind: "idle" });
      setError(status === 413 ? copy.tooLarge : status === 404 ? copy.session : copy.failed);
      return;
    }
    setPhase({ kind: "delivering" });
    const form = new FormData();
    form.set("_op", "brand_rooms.delivery.add");
    form.set("_back", `/admin/brand-rooms/reviews?projectId=${projectId}`);
    form.set("organizationId", organizationId);
    form.set("projectId", projectId);
    form.set("title", title.trim());
    form.set("stagingKey", address.key);
    form.set("name", file.name.slice(0, 200));
    if (stack) form.set("stackReviewId", stack);
    try {
      const response = await fetch("/admin/do", { method: "POST", body: form, credentials: "same-origin", headers: { accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; to?: string; code?: string } | null;
      if (body?.ok && body.to) {
        window.location.assign(body.to);
        return;
      }
      setError(body?.code === "upload" ? copy.badType : body?.code === "forbidden" ? copy.session : copy.failed);
    } catch {
      setError(copy.failed);
    }
    setPhase({ kind: "idle" });
  }

  return (
    <form
      className="bw-form"
      data-admin-delivery-form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        {copy.file}
        <input
          type="file"
          accept="video/mp4,video/quicktime,image/png,image/jpeg,image/webp"
          required
          disabled={busy}
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            setFile(chosen);
            if (chosen && !title) setTitle(chosen.name.replace(/\.[A-Za-z0-9]{2,5}$/, "").slice(0, 120));
          }}
          data-admin-delivery-file
        />
      </label>
      <p className="bw-muted">{copy.fileHint}</p>
      <label>
        {copy.titleLabel}
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} disabled={busy} />
      </label>
      <label>
        {copy.stack}
        <select value={stack} onChange={(e) => setStack(e.target.value)} disabled={busy}>
          <option value="">{copy.stackNew}</option>
          {stacks.map((s) => (
            <option key={s.reviewId} value={s.reviewId}>
              {fill(copy.stackVersion, { title: s.title, version: s.version })}
            </option>
          ))}
        </select>
      </label>
      <button className="bw-button" type="submit" disabled={busy || !file || !title.trim()} data-admin-delivery-submit>
        {phase.kind === "uploading" ? fill(copy.uploading, { percent: phase.percent }) : phase.kind === "delivering" ? copy.delivering : copy.upload}
      </button>
      <p role="alert" className="bw-muted">
        {error ?? ""}
      </p>
    </form>
  );
}
