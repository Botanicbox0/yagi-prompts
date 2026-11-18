"use client";
/**
 * The share link's page body (`/s/<token>`, docs/BRAND-ROOMS.md §6). Only the shared item: a draft on the
 * review stage (watch, read the notes, and when the link allows it leave a note under a name), or a
 * storyboard read-only. No workspace chrome and no way into the workspace.
 *
 * A passphrase-protected link shows the gate first; the right answer sets an http-only cookie on the
 * server and the page re-renders. A view is counted once, after the item is visible (link previews that
 * never run scripts do not count). The guest's name is remembered on this device only.
 *
 * The open page stays live (docs/BRAND-ROOMS-FEEDBACK.md §11): the share door's pulse gives a short stamp of
 * the one shared item every 5 seconds while the tab is on screen, and the page re-reads when it moved; a
 * guest's half-written note holds the re-read until it is sent or cleared. The draft plays in the wide
 * layout, with full screen where the browser has it.
 */
import "@/components/brand-studio/review/review.css";
import "./share.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewComment, ReviewItem } from "@/lib/brand-studio/review-contracts";
import type { PublicShare } from "@/lib/brand-rooms/share-contracts";
import { ReviewStage, type ReviewActions, type ReviewCopy } from "@/components/brand-studio/review/stage";
import type { RoomLocale, StoryboardView } from "../seams";
import { StoryboardReadOnly } from "../storyboard";
import { SHARE_PUBLIC_ENDPOINT, sharePublic } from "../review/api";
import { readPulse, sharePulseInit, usePulse } from "../pulse";
import type { roomsReviewEn } from "@/messages/rooms-review";
import type { roomsStoryboardEn } from "@/messages/rooms-storyboard";

type RoomsReviewCopy = typeof roomsReviewEn;
type StoryboardCopy = typeof roomsStoryboardEn;

export type SharedPageView =
  | { state: "locked"; kind: "review" | "storyboard" }
  | { state: "open"; share: PublicShare; review: { review: ReviewItem; comments: ReviewComment[] } }
  | { state: "open"; share: PublicShare; storyboard: StoryboardView };

const NAME_KEY = "twings_share_guest_name";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

function day(iso: string, locale: RoomLocale): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(iso));
}

export function SharedPage({
  token,
  view,
  locale,
  copy,
  reviewCopy,
  storyboardCopy,
}: {
  token: string;
  view: SharedPageView;
  locale: RoomLocale;
  copy: RoomsReviewCopy;
  reviewCopy: ReviewCopy;
  storyboardCopy: StoryboardCopy;
}) {
  const p = copy.page;
  const kind = view.state === "locked" ? view.kind : view.share.kind;
  return (
    <div className="brh-page" data-share-page={kind} data-share-state={view.state}>
      <header className="brh-page-top">
        <span className="brh-page-mark" aria-label="TWINGS">
          TWINGS
        </span>
        <span className="brh-page-meta">
          <span className="brh-page-eyebrow">{kind === "review" ? p.reviewEyebrow : p.storyboardEyebrow}</span>
          {view.state === "open" && <span>{fill(p.expires, { date: day(view.share.expiresAt, locale) })}</span>}
        </span>
      </header>
      <main className="brh-page-body" id="main">
        {view.state === "locked" ? (
          <Gate token={token} copy={copy} />
        ) : "review" in view ? (
          <SharedReview token={token} share={view.share} item={view.review} locale={locale} copy={copy} reviewCopy={reviewCopy} />
        ) : (
          <SharedStoryboard token={token} board={view.storyboard} locale={locale} copy={storyboardCopy} />
        )}
      </main>
      <footer className="brh-page-foot">{p.footer}</footer>
    </div>
  );
}

/**
 * Re-read the page when the shared item's stamp moves. `holding` (a guest's unsent note) delays the re-read
 * until it lets go; the returned callback is the stage's `onComposingChange`.
 */
function useLiveShare(token: string): (holding: boolean) => void {
  const router = useRouter();
  const holding = useRef(false);
  const pending = useRef(false);
  const read = useCallback(() => readPulse<{ item: string }>(SHARE_PUBLIC_ENDPOINT, sharePulseInit(token)), [token]);
  const onChange = useCallback(() => {
    if (holding.current) pending.current = true;
    else router.refresh();
  }, [router]);
  usePulse(token, read, onChange);
  return useCallback(
    (value: boolean) => {
      holding.current = value;
      if (!value && pending.current) {
        pending.current = false;
        router.refresh();
      }
    },
    [router],
  );
}

/** Count this view once, after the item is on screen. */
function useCountView(token: string) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void sharePublic({ op: "view", token });
  }, [token]);
}

function Gate({ token, copy }: { token: string; copy: RoomsReviewCopy }) {
  const p = copy.page;
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="brh-gate"
      data-share-gate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value || busy) return;
        setBusy(true);
        setError(null);
        const result = await sharePublic({ op: "unlock", token, passphrase: value });
        setBusy(false);
        if (result.ok) {
          router.refresh();
          return;
        }
        setError(result.code === "locked" || result.code === "rate_limited" ? p.locked : result.code === "wrong_passphrase" ? p.wrong : p.errors.generic);
      }}
    >
      <h1>{p.lockedTitle}</h1>
      <p>{p.lockedLine}</p>
      <label className="brh-visually-hidden" htmlFor="brh-passphrase">
        {p.passphrase}
      </label>
      <input
        id="brh-passphrase"
        type="password"
        autoComplete="current-password"
        placeholder={p.passphrase}
        value={value}
        maxLength={64}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        data-share-passphrase
      />
      <button type="submit" className="brh-primary" disabled={busy || !value}>
        {busy ? p.unlocking : p.unlock}
      </button>
      <p className="brh-error" role="alert">
        {error ?? ""}
      </p>
    </form>
  );
}

function SharedReview({
  token,
  share,
  item,
  locale,
  copy,
  reviewCopy,
}: {
  token: string;
  share: PublicShare;
  item: { review: ReviewItem; comments: ReviewComment[] };
  locale: RoomLocale;
  copy: RoomsReviewCopy;
  reviewCopy: ReviewCopy;
}) {
  useCountView(token);
  const router = useRouter();
  const onComposingChange = useLiveShare(token);
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      setName(window.localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      // Storage can be off (private windows); the name is typed again.
    }
  }, []);
  const remember = (value: string) => {
    setName(value);
    try {
      window.localStorage.setItem(NAME_KEY, value.slice(0, 40));
    } catch {
      // Not remembered on this device; nothing else changes.
    }
  };
  // The stage's sentences, with the guest's own read-only line and the share door's refusals.
  const stageCopy = useMemo<ReviewCopy>(
    () => ({ ...reviewCopy, readOnly: copy.page.readOnly, errors: { ...reviewCopy.errors, ...copy.page.errors } }),
    [reviewCopy, copy.page],
  );
  const actions = useMemo<ReviewActions>(
    () => ({
      addComment: async (input) => {
        const result = await sharePublic({ op: "comment", token, name: name.trim(), ...input });
        if (!result.ok) return { ok: false, code: result.code };
        router.refresh();
        return { ok: true };
      },
    }),
    [token, name, router],
  );
  return (
    <ReviewStage
      review={item.review}
      comments={item.comments}
      canWrite={false}
      canComment={share.allowComments}
      canManage={false}
      extended
      layout="wide"
      onComposingChange={onComposingChange}
      guest={share.allowComments ? { name, onName: remember } : null}
      copy={stageCopy}
      locale={locale}
      actions={actions}
      downloadUrl={share.allowDownload ? item.review.mediaUrl : null}
    />
  );
}

function SharedStoryboard({ token, board, locale, copy }: { token: string; board: StoryboardView; locale: RoomLocale; copy: StoryboardCopy }) {
  useCountView(token);
  useLiveShare(token);
  return <StoryboardReadOnly board={board} locale={locale} copy={copy} />;
}
