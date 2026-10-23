"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The brand's one control on an applicant: mark or unmark a preference. It never selects; TWINGS
 * reads the mark next to the application. Posts the registered `applicant.prefer` operation.
 */
export function ApplicantPreference({ applicationId, preferred, labels }: {
  applicationId: string;
  preferred: boolean;
  labels: { prefer: string; unprefer: string; failed: string; working: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/campaign-collaboration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "applicant.prefer", input: { applicationId, preferred: !preferred } }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(String(result.code));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bw-row bw-applicant-prefer">
      <button type="button" className="bw-button" aria-pressed={preferred} disabled={busy} onClick={toggle} data-applicant-prefer={preferred ? "on" : "off"}>
        {busy ? labels.working : preferred ? labels.unprefer : labels.prefer}
      </button>
      {failed && <p role="alert" className="bw-error">{labels.failed}</p>}
    </div>
  );
}
