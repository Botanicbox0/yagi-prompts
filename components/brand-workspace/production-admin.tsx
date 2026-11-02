import { ARK_MODELS } from "@/lib/ark/models";
import { ManagedForm } from "./managed-form";
import type { getDictionary } from "@/lib/i18n/dictionaries";
import type { ProductionWorkspace } from "@/lib/brands/production/service";
type B = ReturnType<typeof getDictionary>["brandWorkspace"];
export function ProductionAdmin({
  organizationId,
  projects,
  previews,
  workspace,
  b,
}: {
  organizationId: string;
  projects: Array<{ id: string; title: string }>;
  previews: Array<{ id: string; project_id: string; name: string }>;
  workspace: ProductionWorkspace | null;
  b: B;
}) {
  const t = b.productionStudio;
  return (
    <section className="bw-panel" id="production">
      <div className="bw-section-heading">
        <div>
          <h2>{t.title}</h2>
          <p className="bw-muted">{t.adminHint}</p>
        </div>
      </div>
      <details>
        <summary>{t.addContract}</summary>
        <ManagedForm op="brandProduction.contract" b={b} submit={t.addContract}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <label>
            {b.projectTitle}
            <select name="projectId" required>
              {projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.contractName}
            <input name="title" required minLength={2} maxLength={120} />
          </label>
          <div className="bw-grid">
            <label>
              {t.startsAt}
              <input type="datetime-local" name="startsAt" required />
            </label>
            <label>
              {t.endsAt}
              <input type="datetime-local" name="endsAt" required />
            </label>
          </div>
          <label>
            {t.limit}
            <input type="number" name="limit" min={1} max={100000} required />
          </label>
          <p className="bw-muted">{t.timeHint}</p>
        </ManagedForm>
      </details>
      {workspace?.contracts.map((c) => (
        <article key={c.id} className="bw-production-contract">
          <div className="bw-row">
            <div>
              <h3>{c.title}</h3>
              <p>
                {t.used}: {c.used} / {c.limit} ·{" "}
                {c.enabled ? t.enabled : t.paused}
              </p>
            </div>
            <ManagedForm
              op="brandProduction.enabled"
              b={b}
              submit={c.enabled ? t.pause : t.resume}
            >
              <input
                type="hidden"
                name="organizationId"
                value={organizationId}
              />
              <input type="hidden" name="contractId" value={c.id} />
              <input type="hidden" name="expectedRevision" value={c.revision} />
              <input type="hidden" name="enabled" value={String(!c.enabled)} />
            </ManagedForm>
          </div>
          <ul className="bw-list">
            {c.templates.map((v) => (
              <li key={v.id}>
                {v.titleKo} / {v.title} · {v.seconds}s · {v.aspect}
              </li>
            ))}
          </ul>
          <details>
            <summary>{t.addTemplate}</summary>
            <ManagedForm
              op="brandProduction.template"
              b={b}
              submit={t.addTemplate}
            >
              <input
                type="hidden"
                name="organizationId"
                value={organizationId}
              />
              <input type="hidden" name="contractId" value={c.id} />
              <label>
                {t.titleKo}
                <input name="titleKo" required minLength={2} maxLength={120} />
              </label>
              <label>
                {t.titleEn}
                <input name="title" required minLength={2} maxLength={120} />
              </label>
              <label>
                {t.preview}
                <select name="previewAttachmentId">
                  <option value="">{t.noPreview}</option>
                  {previews
                    .filter((a) => a.project_id === c.projectId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.prompt}
                <textarea
                  name="promptText"
                  required
                  minLength={10}
                  maxLength={20000}
                />
              </label>
              <div className="bw-grid">
                <label>
                  {t.seconds}
                  <input
                    name="seconds"
                    type="number"
                    min={4}
                    max={ARK_MODELS["seedance-2.5"].maxDurationSeconds}
                    required
                  />
                </label>
                <label>
                  {t.aspect}
                  <select name="aspect">
                    {["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="bw-muted">{t.privateHint}</p>
            </ManagedForm>
          </details>
        </article>
      ))}
    </section>
  );
}
