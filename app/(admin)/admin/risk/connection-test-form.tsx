'use client';
import { useState } from 'react';
export function RiskSlackConnectionForm({
  label,
  pendingLabel,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      method="post"
      action="/admin/do"
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        setPending(true);
      }}
    >
      <input type="hidden" name="_op" value="campaignRisk.slackConnectionTest" />
      <input type="hidden" name="_back" value="/admin/risk" />
      <button
        className="border border-hairline px-3 py-1.5 font-label text-eyebrow uppercase hover:border-accent hover:text-accent disabled:opacity-40"
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending}
      >
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}
