/**
 * "캠페인으로 보내기" (docs/BRAND-STUDIO-V2.md §10): pick a campaign or start a new one with just a
 * title and a goal; the server copies the file across and answers with the campaign page to open.
 */
import { useId, useRef, useState } from "react";
import type { StudioHandoffDone } from "@/lib/brand-studio/contracts";
import { isFailure, type ApiResult, type StudioOps } from "./api";
import { errorLine, newRequestId, type StudioCopy } from "./copy";
import { useModal } from "./modal";
import type { RefSource } from "./refs";

export type HandoffChoice = { projectId: string } | { newProject: { title: string; objective: string } };

/** The `handoff.campaign` input for one result or asset; `asFormat` asks the team to use a video as the format. */
export function handoffInput(
  target: RefSource,
  choice: HandoffChoice,
  ids: { organizationId: string; requestId: string },
  asFormat = false,
): StudioOps["handoff.campaign"][0] {
  return { organizationId: ids.organizationId, requestId: ids.requestId, ...target, ...choice, asFormat };
}

export interface HandoffDialogProps {
  campaigns: ReadonlyArray<{ id: string; title: string }>;
  copy: StudioCopy;
  /** What is being sent: a video may be offered as the format creators follow. */
  kind?: "image" | "video";
  onSend(choice: HandoffChoice, requestId: string, asFormat: boolean): Promise<ApiResult<StudioHandoffDone>>;
  onDone(href: string): void;
  onClose(): void;
}

export function HandoffDialog({ campaigns, copy, kind = "image", onSend, onDone, onClose }: HandoffDialogProps) {
  const h = copy.handoff;
  const ref = useModal();
  const id = useId();
  const [selected, setSelected] = useState<string>(campaigns[0]?.id ?? "new");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [asFormat, setAsFormat] = useState(kind === "video");
  const press = useRef<{ fingerprint: string; id: string } | null>(null);

  async function send() {
    if (busy) return;
    const choice: HandoffChoice =
      selected === "new" ? { newProject: { title: title.trim(), objective: objective.trim() } } : { projectId: selected };
    if ("newProject" in choice && (choice.newProject.title.length < 3 || choice.newProject.objective.length < 3)) return setNotice(h.needFields);
    const format = kind === "video" && asFormat;
    const fingerprint = JSON.stringify({ choice, format });
    if (press.current?.fingerprint !== fingerprint) press.current = { fingerprint, id: newRequestId() };
    setBusy(true);
    setNotice(null);
    const result = await onSend(choice, press.current.id, format);
    setBusy(false);
    if (isFailure(result)) return setNotice(errorLine(copy, result.code));
    onDone(result.href);
  }

  return (
    <dialog
      ref={ref}
      className="bs-dialog"
      aria-labelledby={`${id}-title`}
      data-studio-handoff
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        className="bs-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <h2 id={`${id}-title`}>{h.title}</h2>
        <fieldset className="bs-choices">
          <legend className="bs-label">{h.existing}</legend>
          {campaigns.map((campaign) => (
            <label key={campaign.id} className="bs-choice">
              <input type="radio" name={`${id}-campaign`} value={campaign.id} checked={selected === campaign.id} onChange={() => setSelected(campaign.id)} />
              <span>{campaign.title}</span>
            </label>
          ))}
          <label className="bs-choice">
            <input type="radio" name={`${id}-campaign`} value="new" checked={selected === "new"} onChange={() => setSelected("new")} />
            <span>{h.newCampaign}</span>
          </label>
        </fieldset>
        {selected === "new" && (
          <>
            <label htmlFor={`${id}-name`}>{h.newTitle}</label>
            <input id={`${id}-name`} className="bs-field" value={title} minLength={3} maxLength={120} required onChange={(event) => setTitle(event.target.value)} />
            <label htmlFor={`${id}-goal`}>{h.objective}</label>
            <textarea
              id={`${id}-goal`}
              className="bs-field"
              rows={3}
              value={objective}
              minLength={3}
              maxLength={2000}
              required
              placeholder={h.objectivePlaceholder}
              onChange={(event) => setObjective(event.target.value)}
            />
          </>
        )}
        {kind === "video" && (
          <label className="bs-check" data-studio-handoff-format>
            <input type="checkbox" checked={asFormat} onChange={(event) => setAsFormat(event.target.checked)} />
            <span>{h.asFormat}</span>
          </label>
        )}
        {notice && <p className="bs-dock-message" role="alert">{notice}</p>}
        <div className="bs-row bs-dialog-actions">
          <span className="bs-spacer" />
          <button type="button" className="bs-btn" data-variant="ghost" data-size="md" onClick={onClose}>
            {h.cancel}
          </button>
          <button type="submit" className="bs-btn" data-variant="solid" data-size="md" disabled={busy} data-studio-handoff-send>
            {busy ? h.sending : h.send}
          </button>
        </div>
      </form>
    </dialog>
  );
}
