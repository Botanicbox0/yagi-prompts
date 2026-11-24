"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { BrandCopy } from "./action-form";

type Field = Pick<HTMLInputElement, "focus" | "select">;
type CopyEnv = {
  clipboard?: Pick<Clipboard, "writeText">;
  exec: (command: string) => boolean;
};

/**
 * Copies the link with the clipboard API. Where that is missing or refused (an insecure context, a denied
 * permission), the link is selected in its field so it can be copied by hand, and the older copy command is
 * tried on that selection. True only when something says the copy happened.
 */
export async function copyInviteLink(
  text: string,
  field: Field | null,
  env: CopyEnv = {
    clipboard: typeof navigator === "undefined" ? undefined : navigator.clipboard,
    exec: (command) => document.execCommand(command),
  },
): Promise<boolean> {
  try {
    if (env.clipboard) {
      await env.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to selecting the field
  }
  if (!field) return false;
  field.focus();
  field.select();
  try {
    return env.exec("copy");
  } catch {
    return false;
  }
}

/** A new team invitation's link: shown once, read-only, with a quiet copy button beside it. */
export function InviteLink({ url, b }: { url: string; b: Pick<BrandCopy, "inviteReady" | "inviteToken" | "copy" | "copied"> }) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="bw-note" data-invite-link>
      <p>{b.inviteReady}</p>
      <label htmlFor={id}>{b.inviteToken}</label>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "7px" }}>
        <input id={id} ref={field} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="bw-button"
          data-invite-copy
          onClick={async () => setCopied(await copyInviteLink(url, field.current))}
          style={{ flexShrink: 0 }}
        >
          {copied ? b.copied : b.copy}
        </button>
        {/* The button's own label change is not reliably announced; this line is. */}
        <span className="bw-sr-only" role="status">{copied ? b.copied : ""}</span>
      </div>
    </div>
  );
}
