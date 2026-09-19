import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
export default async function Loading() {
  return (
    <p role="status">
      {getDictionary(await getRequestLocale()).brandWorkspace.loading}
    </p>
  );
}
