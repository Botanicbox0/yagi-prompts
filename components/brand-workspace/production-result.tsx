"use client";
import { useEffect, useState } from "react";
import type { getDictionary } from "@/lib/i18n/dictionaries";
type T = ReturnType<typeof getDictionary>["brandWorkspace"]["productionStudio"];
export function ProductionResult({
  id,
  initialStatus,
  released,
  t,
}: {
  id: string;
  initialStatus: string;
  released: boolean;
  t: T;
}) {
  const [status, setStatus] = useState(initialStatus),
    [restored, setRestored] = useState(released),
    [error, setError] = useState(false);
  useEffect(() => {
    if (status === "succeeded" || status === "failed") return;
    let active = true;
    const controller = new AbortController();
    const check = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/brand-production/${id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw Error();
        const data = await r.json();
        if (active) {
          setStatus(data.status);
          setRestored(data.released);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };
    void check();
    const timer = setInterval(check, 8000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [id, status]);
  return (
    <section className="bw-panel bw-production-result" aria-live="polite">
      {status === "succeeded" ? (
        <>
          <video
            controls
            playsInline
            preload="metadata"
            src={`/api/brand-production/${id}/media`}
          />
          <a
            className="bw-button bw-primary"
            href={`/api/brand-production/${id}/media?download=1`}
          >
            {t.download}
          </a>
        </>
      ) : (
        <div className="bw-production-wait">
          <span className="bw-kicker">
            {t.states[status as keyof typeof t.states] ?? t.states.queued}
          </span>
          <h2>{status === "failed" ? t.failed : t.processing}</h2>
          <p>
            {status === "failed"
              ? restored
                ? t.restored
                : t.failedHint
              : t.processingHint}
          </p>
        </div>
      )}
      {error && <p role="alert">{t.connection}</p>}
    </section>
  );
}
