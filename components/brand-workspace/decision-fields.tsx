"use client";
import { useId, useState } from "react";
import type { BrandCopy } from "./action-form";

/** A change request must say what to change; the server refuses an empty one, so say so up front. */
export function DecisionFields({ b, initial = "approved" }: { b: BrandCopy; initial?: "approved" | "changes_requested" }) {
  const [decision, setDecision] = useState(initial);
  const hint = useId();
  const changes = decision === "changes_requested";
  return (
    <>
      <label>
        {b.decision}
        <select name="decision" value={decision} onChange={(e) => setDecision(e.currentTarget.value as typeof decision)}>
          <option value="approved">{b.approve}</option>
          <option value="changes_requested">{b.requestChanges}</option>
        </select>
      </label>
      <label>
        {changes ? `${b.decisionForm.changesReason} (${b.required})` : `${b.decisionComment} (${b.optional})`}
        <textarea name="comment" maxLength={2000} required={changes} aria-describedby={hint} />
        <span id={hint} className="bw-muted">
          {changes ? b.decisionForm.changesReasonHint : b.decisionForm.commentOptional}
        </span>
      </label>
      {/* Only an approval is final enough to confirm; a change request just says what to change. */}
      {!changes && (
        <label className="bw-check">
          <input type="checkbox" required name="confirmed" />
          {b.approveConfirm}
        </label>
      )}
    </>
  );
}
