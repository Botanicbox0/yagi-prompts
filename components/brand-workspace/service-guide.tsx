import type { Dictionary } from "@/messages/en";

export function ServiceGuide({ kind, b, showOther = true }: {
  kind: "campaign" | "studio";
  b: Dictionary["brandWorkspace"];
  /** Off when the other service's entry would only lead to a page this account cannot use. */
  showOther?: boolean;
}) {
  const t = b.serviceGuide[kind];
  return (
    <section className="bw-service-guide" aria-label={b.serviceGuide.label} data-brand-service={kind}>
      <div className="bw-service-intro">
        <h2>{t.lead}</h2>
        <p>{t.body}</p>
      </div>
      <dl>
        <div><dt>{t.scopeLabel}</dt><dd>{t.scope}</dd></div>
        <div><dt>{t.termsLabel}</dt><dd>{t.terms}</dd></div>
      </dl>
      {showOther && <a href={kind === "campaign" ? "/brand/studio" : "/brand/projects/new"}>{t.other}</a>}
    </section>
  );
}
