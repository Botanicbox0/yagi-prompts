"use client";
import { useEffect, useRef, useState } from "react";
import { interpolate } from "@/lib/i18n/format";

/**
 * A card's "2차 활용 견적 문의" link arrives as `#usage=post:<id>` (or `content_version:<id>`): tick that
 * subject in the inquiry form and open it. Only an existing checkbox can be ticked; nothing else is read.
 * Also announces how many subjects are ticked, so a preselected choice is visible before the list.
 */
export function UsageSubjectPreselect({ selectedCount }: { selectedCount?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const recount = () => setCount(form?.querySelectorAll('input[name="subject"]:checked').length ?? 0);
    const apply = () => {
      const match = /^#usage=((?:post|content_version):[0-9a-f-]{36})$/i.exec(location.hash);
      if (!match) return;
      const box = form?.querySelector<HTMLInputElement>(`input[name="subject"][value="${match[1]}"]`);
      if (!box) return;
      box.checked = true;
      recount();
      const details = form?.closest("details");
      if (details) details.open = true;
      box.focus({ preventScroll: true });
    };
    recount();
    apply();
    form?.addEventListener("change", recount);
    const afterReset = () => setTimeout(recount);
    form?.addEventListener("reset", afterReset);
    window.addEventListener("hashchange", apply);
    return () => {
      form?.removeEventListener("change", recount);
      form?.removeEventListener("reset", afterReset);
      window.removeEventListener("hashchange", apply);
    };
  }, []);
  return <p ref={ref} className="bw-usage-selected" aria-live="polite" data-usage-selected={count}>{selectedCount && count > 0 ? interpolate(selectedCount, { count }) : null}</p>;
}
