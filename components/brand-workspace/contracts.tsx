import { randomUUID } from "node:crypto";
import type { BrandProjectDetail } from "@/lib/brands/workspace/types";
import type { BrandCopy } from "./action-form";
import { BrandUpload } from "./upload";
import { ManagedForm } from "./managed-form";
import { formatBrandTimestamp } from "./format";

export function CampaignContracts({
  project: p,
  b,
  locale,
  studio = false,
}: {
  project: BrandProjectDetail;
  b: BrandCopy;
  locale: string;
  studio?: boolean;
}) {
  const newKey = `contract_${randomUUID().slice(0, 8)}`,
    c = b.managed,
    groups = [
      ...new Map(
        (p.contracts ?? []).map((d) => [d.documentKey, d.title]),
      ).entries(),
    ];
  return (
    <section
      className="bw-panel bw-contracts"
      id="contracts"
      data-brand-contracts
    >
      <div className="bw-section-heading">
        <h2>{c.contracts}</h2>
        <span className="bw-count">{p.contracts?.length ?? 0}</span>
      </div>
      {studio && <p className="bw-muted">{c.contractHint}</p>}
      {!p.contracts?.length ? (
        <p className="bw-muted">{studio || p.role === "studio" ? c.contractEmpty : c.contractEmptyClient}</p>
      ) : (
        <ul className="bw-list">
          {p.contracts.map((d) => (
            <li key={d.id} className="bw-contract-row">
              {/* A document mark, not a word: the title beside it names the file. */}
              <div className="bw-file-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>
              </div>
              <div className="bw-contract-info">
                <strong>{d.title}</strong>
                <p className="bw-muted">
                  {c.version.replace("{version}", String(d.version))} ·{" "}
                  {formatBrandTimestamp(d.createdAt, locale)}
                  {/* The TWINGS team's read-only view also lists unshared documents, so it says which. */}
                  {(studio || p.role === "studio") && <> · {d.shared ? c.shared : c.private}</>}
                </p>
              </div>
              <a
                className="bw-button"
                href={`/api/brand-workspace/attachments/${d.attachmentId}`}
                download
              >
                {c.download}
              </a>
              {studio && (
                <ManagedForm
                  op="brandWorkspace.contractShare"
                  b={b}
                  submit={d.shared ? c.unshare : c.share}
                  tone={d.shared ? "danger" : "secondary"}
                  confirm={d.shared
                    ? { prompt: b.confirm.unshareContract, action: b.confirm.unshareContractAction }
                    : { prompt: b.confirm.shareContract, action: b.confirm.shareContractAction }}
                >
                  <input type="hidden" name="projectId" value={p.id} />
                  <input type="hidden" name="contractId" value={d.id} />
                  <input
                    type="hidden"
                    name="expectedRevision"
                    value={d.revision}
                  />
                  <input
                    type="hidden"
                    name="shared"
                    value={String(!d.shared)}
                  />
                </ManagedForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {studio && (
        <details className="bw-contract-add">
          <summary>{c.saveContract}</summary>
          <div className="bw-grid">
            <BrandUpload projectId={p.id} b={b} studio purpose="contract" />
            {!!p.contractUploads?.length && (
              <ManagedForm
                op="brandWorkspace.contract"
                b={b}
                submit={c.saveContract}
              >
                <input type="hidden" name="projectId" value={p.id} />
                <label>
                  {c.chooseFile}
                  <select name="attachmentId" required>
                    {p.contractUploads.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {c.contractTitle}
                  <input name="title" maxLength={160} required />
                </label>
                <label>
                  {c.contractKey}
                  <select name="documentKey" defaultValue={newKey}>
                    <option value={newKey}>{c.newContract}</option>
                    {groups.map(([key, title]) => (
                      <option value={key} key={key}>
                        {title}
                      </option>
                    ))}
                  </select>
                  <span className="bw-muted">{c.contractKeyHint}</span>
                </label>
              </ManagedForm>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
