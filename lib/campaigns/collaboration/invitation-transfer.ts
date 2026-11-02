/** Browser-only transport between the invitation landing and same-tab OAuth return.
 * No token enters a query string, cookie, server-rendered HTML or external auth URL.
 */
export const INVITATION_TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type TransferOptions = {
  slug: string;
  hash: string;
  storage: () => TokenStorage;
  now?: number;
};
export const invitationTransferKey = (slug: string) =>
  `twings-campaign-invite:${slug}`;
const validToken = (value: unknown): value is string =>
  typeof value === "string" && /^[\w-]{43}$/.test(value);

export function captureInvitationTransfer(options: TransferOptions): {
  token: string;
  persisted: boolean;
} {
  const clock = options.now ?? Date.now();
  const key = invitationTransferKey(options.slug);
  const fragmentToken = new URLSearchParams(options.hash.replace(/^#/, "")).get(
    "token",
  );
  if (validToken(fragmentToken)) {
    try {
      options
        .storage()
        .setItem(
          key,
          JSON.stringify({
            token: fragmentToken,
            expiresAt: clock + INVITATION_TRANSFER_TTL_MS,
          }),
        );
      return { token: fragmentToken, persisted: true };
    } catch {
      // An already signed-in person can still accept directly using component memory.
      return { token: fragmentToken, persisted: false };
    }
  }
  try {
    const storage = options.storage();
    const raw = storage.getItem(key);
    if (!raw) return { token: "", persisted: true };
    let record: { token?: unknown; expiresAt?: unknown };
    try {
      record = JSON.parse(raw);
    } catch {
      storage.removeItem(key);
      return { token: "", persisted: true };
    }
    if (
      record &&
      validToken(record.token) &&
      typeof record.expiresAt === "number" &&
      record.expiresAt > clock &&
      record.expiresAt <= clock + INVITATION_TRANSFER_TTL_MS
    ) {
      return { token: record.token, persisted: true };
    }
    storage.removeItem(key);
    return { token: "", persisted: true };
  } catch {
    return { token: "", persisted: false };
  }
}

export function forgetInvitationTransfer(
  slug: string,
  storage: () => TokenStorage,
): void {
  try {
    storage().removeItem(invitationTransferKey(slug));
  } catch {
    /* Storage denial cannot undo successful server acceptance. */
  }
}

/** Copy-only external-browser handoff. Never call this for an OAuth URL or query parameter. */
export function campaignInvitationBrowserAddress(
  target: string,
  origin: string,
  storage: () => TokenStorage,
  clock = Date.now(),
): string {
  try {
    const url = new URL(target),
      current = new URL(origin);
    if (
      url.origin !== current.origin ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search
    )
      return target;
    const match = /^\/campaigns\/([a-z0-9]+(?:-[a-z0-9]+)*)\/join\/?$/.exec(
      url.pathname,
    );
    const slug=match?.[1];
    if (!slug || slug.length > 80) return target;
    const pending = captureInvitationTransfer({
      slug,
      hash: "",
      storage,
      now: clock,
    });
    if (!pending.token) return target;
    url.hash = `token=${pending.token}`;
    return url.href;
  } catch {
    return target;
  }
}
