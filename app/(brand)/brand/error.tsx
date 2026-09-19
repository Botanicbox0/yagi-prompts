"use client";
import { useEffect, useState } from "react";
import { getDictionary } from "@/lib/i18n/dictionaries";
export default function BrandError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<"en" | "ko">("ko");
  useEffect(() => {
    setLocale(document.documentElement.lang === "en" ? "en" : "ko");
  }, []);
  const b = getDictionary(locale).brandWorkspace;
  return (
    <section className="bw-empty" role="alert">
      <h1>{b.unavailable}</h1>
      <button className="bw-button" onClick={reset}>
        {b.retry}
      </button>
    </section>
  );
}
