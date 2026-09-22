"use client";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
export default function BrandError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<"en" | "ko">("ko");
  useEffect(() => {
    setLocale(document.documentElement.lang === "en" ? "en" : "ko");
  }, []);
  const b = getDictionary(locale).brandWorkspace;
  return (
    <section className="bw-empty" role="alert">
      <h1>{b.unavailable}</h1>
      <button
        className="bw-button"
        onClick={() =>
          // In Next 15 `reset` only clears the boundary's own state and re-renders the payload it
          // already has; a failure thrown while rendering on the server needs a fresh server render.
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        {b.retry}
      </button>
    </section>
  );
}
