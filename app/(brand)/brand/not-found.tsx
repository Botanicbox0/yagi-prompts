import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
export default async function BrandNotFound() {
  const b = getDictionary(await getRequestLocale()).brandWorkspace;
  return (
    <section className="bw-empty">
      <h1>{b.denied}</h1>
      <a href="/brand" className="bw-button">
        {b.back}
      </a>
    </section>
  );
}
