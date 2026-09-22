import type { Dictionary } from "@/messages/en";

export function ServiceGuide({ kind, b }: {
  kind: "campaign" | "studio";
  b: Dictionary["brandWorkspace"];
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
      <a href={kind === "campaign" ? "/brand/studio" : "/brand/projects/new"}>{t.other}</a>
    </section>
  );
}
