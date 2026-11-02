"use client";
import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { BrandCopy } from "./action-form";
/** Why an upload stopped: the person cancelled, the campaign's file limit was reached, or it failed. */
export type UploadStop = "aborted" | "rate_limited" | "failed";
export function uploadStopNotice(stop: UploadStop, b: BrandCopy): { notice: string; failed: boolean } {
  if (stop === "aborted") return { notice: "", failed: false };
  if (stop === "rate_limited") return { notice: b.errors.rateLimited, failed: true };
  return { notice: b.uploadFailed, failed: true };
}
const stopOf = (error: unknown): UploadStop =>
  error instanceof Error && (error.message === "aborted" || error.message === "rate_limited") ? error.message : "failed";
const CAPS: Record<string, number> = {
  "image/jpeg": 15 * 1024 * 1024,
  "image/png": 15 * 1024 * 1024,
  "image/webp": 15 * 1024 * 1024,
  "video/mp4": 50000000,
  "video/webm": 50000000,
  "application/pdf": 20 * 1024 * 1024,
};

export function BrandUpload({
  projectId,
  b,
  studio = false,
  purpose = "workspace",
}: {
  projectId: string;
  b: BrandCopy;
  studio?: boolean;
  purpose?: "workspace" | "contract";
}) {
  const endpoint = studio
    ? "/api/admin/brand-workspace"
    : "/api/brand-workspace";
  const router = useRouter();
  const [ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const active = useRef<XMLHttpRequest | null>(null);
  const reservation = useRef<{
    file: File;
    requestId: string;
    id?: string;
    uploaded?: boolean;
  } | null>(null);
  async function upload() {
    if (busy || !file) return;
    const cap = CAPS[file.type];
    if ((purpose === "contract" && file.type !== "application/pdf") || !cap || file.size <= 0 || file.size > cap) {
      setFailed(true);
      setNotice(b.badFile);
      return;
    }
    if (reservation.current?.file !== file)
      reservation.current = { file, requestId: crypto.randomUUID() };
    const attempt = reservation.current!;
    setBusy(true);
    setProgress(0);
    setNotice("");
    setFailed(false);
    try {
      const complete = async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "attachment.complete",
            input: { id: attempt.id },
          }),
        });
        const result = await response.json();
        return response.ok && result.ok;
      };
      // A storage PUT may have succeeded even when its response was lost. Verify the existing
      // bytes first; never overwrite a write-once key just to recover a network failure.
      if (attempt.id && !attempt.uploaded && (await complete()))
        attempt.uploaded = true;
      if (!attempt.uploaded) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "attachment.reserve",
            input: {
              projectId, purpose,
              requestId: attempt.requestId,
              name: file.name,
              mime: file.type,
              sizeBytes: file.size,
            },
          }),
        });
        const target = await response.json();
        if (!response.ok || !target.ok) throw Error(target?.code === "rate_limited" ? "rate_limited" : "upload");
        attempt.id = target.id;
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          active.current = xhr;
          xhr.open(
            target.direct ? "PUT" : "POST",
            target.direct ? target.url : `${endpoint}/attachments/${target.id}`,
          );
          xhr.setRequestHeader("Content-Type", file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(Error("upload"));
          xhr.onerror = () => reject(Error("upload"));
          xhr.onabort = () => reject(Error("aborted"));
          xhr.send(file);
        }).catch(async (error) => {
          // A cancel is the person's choice: stop, without probing whether bytes arrived anyway.
          if (stopOf(error) === "aborted" || !(await complete())) throw error;
        });
        attempt.uploaded = true;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "attachment.complete",
          input: { id: attempt.id },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error("complete");
      setNotice(b.uploadDone);
      setFile(null);
      if(fileInput.current)fileInput.current.value="";
      reservation.current = null;
      router.refresh();
    } catch (error) {
      const stop = uploadStopNotice(stopOf(error), b);
      setFailed(stop.failed);
      setNotice(stop.notice);
    } finally {
      setBusy(false);
      active.current = null;
    }
  }
  return (
    <div className="bw-upload" aria-busy={busy}>
      <label>
        {b.upload}
        <input
          ref={fileInput}
          type="file"
          accept={purpose === "contract" ? "application/pdf" : Object.keys(CAPS).join(",")}
          disabled={!ready||busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setNotice("");
          }}
        />
      </label>
      <p className="bw-muted">{purpose === "contract" ? b.managed.pdfHint : b.uploadHint}</p>
      <div className="bw-form-actions">
        <button
          className="bw-button"
          disabled={busy || !file}
          type="button"
          onClick={upload}
        >
          {busy ? b.uploading.replace("{percent}", String(progress)) : b.upload}
        </button>
        {busy && (
          <button
            className="bw-button"
            type="button"
            onClick={() => active.current?.abort()}
          >
            {b.cancelUpload}
          </button>
        )}
      </div>
      {busy && <progress max={100} value={progress} aria-label={b.upload} />}
      {notice && (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "bw-error" : "bw-success"}
        >
          {notice}
        </p>
      )}
    </div>
  );
}
