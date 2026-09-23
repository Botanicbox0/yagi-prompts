"use client";
import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { useBrandErrorCopy } from "@/components/brand-workspace/error-copy";
export default function BrandError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  // From the layout, in the request's language; no dictionary is imported into this client bundle.
  const copy = useBrandErrorCopy();
  return (
    <section className="bw-empty" role="alert" data-brand-error>
      {copy && <h1>{copy.title}</h1>}
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
        {copy?.retry ?? "↻"}
      </button>
    </section>
  );
}
