"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { COVER_TYPES, coverFileProblem, studioRequest, uploadStudioImage } from "@/lib/brands/workspace/studio-cover";
import type { BrandCopy } from "./action-form";
import { managedErrorMessage } from "./managed-form";

const projectOf = (to: string) => to.match(/^\/brand\/projects\/([0-9a-f-]{36})/i)?.[1] ?? null;
const pickedFile = (data: FormData, name: string) => {
  const value = data.get(name);
  return value instanceof File && value.size > 0 ? value : null;
};

/**
 * The studio's new-campaign form on brand.twings.app, with an optional cover image
 * (lib/brands/workspace/studio-cover.ts). The campaign is created first; if the image then fails, the
 * campaign still exists and its page opens with a note to upload the cover there.
 */
export function StudioCampaignForm({ b, organizations, selected }: {
  b: BrandCopy;
  organizations: ReadonlyArray<{ id: string; name: string }>;
  selected: string | undefined;
}) {
  const c = b.studioPrep;
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState<"" | "saving" | "uploading">("");
  const [error, setError] = useState("");
  // Same retry rule as ManagedForm: an unchanged form keeps its request id, so a lost answer never makes a second campaign.
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    const file = pickedFile(data, "cover");
    data.delete("cover");
    if (coverFileProblem(file)) return setError(c.coverBad);
    const fields = Object.fromEntries([...data.entries()].map(([k, v]) => [k, String(v)]));
    const fingerprint = JSON.stringify([fields, file?.name, file?.size]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setBusy("saving");
    setError("");
    try {
      const created = await studioRequest({ ...fields, _op: "brandWorkspace.createProject", productionMode: "creator", requestId: request.current.id });
      const projectId = created.ok ? projectOf(created.to) : null;
      if (!created.ok || !projectId) {
        setError(managedErrorMessage(b, created.ok ? null : created.code));
        return;
      }
      request.current = null;
      if (!file) return location.assign(created.to);
      setBusy("uploading");
      try {
        const attachmentId = await uploadStudioImage(projectId, file);
        const cover = await studioRequest({ _op: "brandWorkspace.cover", projectId, expectedRevision: "0", attachmentId });
        if (!cover.ok) throw new Error("cover");
        location.assign(created.to);
      } catch {
        location.assign(`${created.to}?cover=failed#studio-tools`);
      }
    } catch {
      setError(b.error);
    } finally {
      setBusy("");
    }
  }
  return (
    <form method="post" className="bw-form" onSubmit={send} aria-busy={Boolean(busy)} data-studio-campaign-form>
      <fieldset disabled={!ready || Boolean(busy)} className="bw-fields">
        <label>
          {c.brand}
          <select name="organizationId" defaultValue={selected} required data-studio-prep-brand>
            {organizations.map((o) => <option value={o.id} key={o.id}>{o.name}</option>)}
          </select>
          <span className="bw-muted">{c.brandHint}</span>
        </label>
        <label>{b.projectTitle}<input name="title" minLength={3} maxLength={120} required /></label>
        <label>{c.objective}<textarea name="objective" minLength={3} maxLength={2000} required /></label>
        <label>{c.budget}<input type="number" name="budgetKrw" min={0} inputMode="numeric" /></label>
        <label>
          {c.cover}
          <input type="file" name="cover" accept={COVER_TYPES.join(",")} data-studio-prep-cover />
          <span className="bw-muted">{c.coverHint}</span>
        </label>
      </fieldset>
      <button className="bw-button bw-primary" disabled={!ready || Boolean(busy)}>
        {busy === "uploading" ? c.coverUploading : busy ? b.working : c.submit}
      </button>
      {error && <p role="alert" className="bw-error">{error}</p>}
    </form>
  );
}

/** Upload a new cover for an existing campaign from its page (TWINGS team view, DB admins). */
export function StudioCoverForm({ b, projectId, revision, hasCover }: {
  b: BrandCopy;
  projectId: string;
  revision: number;
  hasCover: boolean;
}) {
  const c = b.studioPrep;
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const file = pickedFile(new FormData(form), "cover");
    if (!file || coverFileProblem(file)) return setError(c.coverBad);
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const attachmentId = await uploadStudioImage(projectId, file);
      const cover = await studioRequest({ _op: "brandWorkspace.cover", projectId, expectedRevision: String(revision), attachmentId });
      if (!cover.ok) return setError(managedErrorMessage(b, cover.code));
      form.reset();
      setDone(true);
      router.refresh();
    } catch {
      setError(b.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form method="post" className="bw-form" onSubmit={send} aria-busy={busy} data-studio-cover-form>
      <fieldset disabled={!ready || busy} className="bw-fields">
        <label>
          {c.coverFile}
          <input type="file" name="cover" accept={COVER_TYPES.join(",")} required />
        </label>
      </fieldset>
      <button className="bw-button bw-primary" disabled={!ready || busy}>{busy ? c.coverUploading : hasCover ? c.coverReplace : c.coverAdd}</button>
      {error && <p role="alert" className="bw-error">{error}</p>}
      {done && <p role="status" className="bw-note">{c.coverDone}</p>}
    </form>
  );
}
