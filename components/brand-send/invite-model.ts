/**
 * Pure address parsing, debounced single-flight lookup reducer, invite chip tracking, refusal mapping,
 * and chip presentation helpers for 초대하고 보내기 (slice 4c).
 *
 * Imports nothing from `lib/**` except `import type` and `SEND_LIMITS`.
 */
import {
  SEND_LIMITS,
  type SendInviteChip,
  type SendInviteOutcome,
  type SendLookup,
  type SendPerson,
} from '@/lib/brand-rooms/send-contracts';
import {
  parseMentionTrigger,
  refusalMessageText,
  sendRefusalOutcome,
  type MentionTrigger,
  type RequestIdPlan,
  type SendCopy,
  type SendRefusalContext,
  type TrackedMention,
} from './model';

export const INVITE_LOOKUP_DEBOUNCE_MS = 300;
export const INVITE_COPIED_FEEDBACK_MS = 2000;

/** Exact shape enforced by `SendInviteEmailSchema` (`z.email()`, max 254 after trim/lowercase). */
const INVITE_EMAIL_RE =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

/** Trims and lowercases `raw`, returning the normalized email iff it is a complete contract address. */
export function parseCompleteInviteEmail(raw: string): string | null {
  if (raw.length > 320) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  return INVITE_EMAIL_RE.test(normalized) ? normalized : null;
}

/**
 * Triggers `@` picker for either a member query (existing 4b rule) or a complete e-mail address
 * following `@` at start or after whitespace. Never triggers on partial addresses or trailing dots.
 */
export function parseInviteTrigger(
  text: string,
  caret: number,
  people?: readonly SendPerson[],
): MentionTrigger | null {
  const memberTrigger = parseMentionTrigger(text, caret, people);
  if (memberTrigger) return memberTrigger;
  const clamped = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, clamped);
  const match = /(^|\s)@([^\s]+)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? '';
  if (!query.includes('@') || parseCompleteInviteEmail(query) === null) return null;
  return {
    start: before.length - query.length - 1,
    end: clamped,
    query,
  };
}

/* ------------------------------------------------------------------ lookup reducer */

export type InviteLookupEntry =
  | { status: 'invitable'; email: string }
  | { status: 'not_allowed'; email: string }
  | { status: 'member'; email: string; member: { id: string; name: string } };

export interface InviteLookupState {
  targetEmail: string | null;
  debouncingEmail: string | null;
  debouncingSeq: number;
  inflightEmail: string | null;
  inflightSeq: number;
  queuedEmail: string | null;
  nextSeq: number;
  cache: Readonly<Record<string, InviteLookupEntry>>;
  rateLimited: boolean;
  stopped: boolean;
  inviteClosed: boolean;
}

export type InviteLookupAction =
  | { type: 'target'; email: string | null; textChanged?: boolean }
  | { type: 'debounce_fire'; seq: number; email: string }
  | { type: 'answer'; seq: number; email: string; result: SendLookup | { ok: false; code: string } };

export type InviteLookupCommand =
  | { type: 'debounce'; email: string; seq: number; delayMs: number }
  | { type: 'cancel_debounce' }
  | { type: 'fetch'; email: string; seq: number };

export function initialInviteLookupState(seed?: InviteLookupEntry | null): InviteLookupState {
  const email = seed ? seed.email.toLowerCase() : null;
  return {
    targetEmail: email,
    debouncingEmail: null,
    debouncingSeq: 0,
    inflightEmail: null,
    inflightSeq: 0,
    queuedEmail: null,
    nextSeq: 0,
    cache: seed && email ? { [email]: seed } : {},
    rateLimited: false,
    stopped: false,
    inviteClosed: false,
  };
}

function toCacheEntry(result: SendLookup): InviteLookupEntry {
  const normalized = result.email.trim().toLowerCase();
  if (result.status === 'member' && result.member) {
    return { status: 'member', email: normalized, member: { ...result.member } };
  }
  if (result.status === 'invitable') {
    return { status: 'invitable', email: normalized };
  }
  return { status: 'not_allowed', email: normalized };
}

export function inviteLookupReduce(
  state: InviteLookupState,
  action: InviteLookupAction,
): { state: InviteLookupState; command: InviteLookupCommand | null } {
  if (action.type === 'target') {
    const email = action.email ? action.email.trim().toLowerCase() : null;
    const rateLimited = action.textChanged ? false : state.rateLimited;

    if (state.stopped || state.inviteClosed || rateLimited) {
      const hadDebounce = state.debouncingEmail !== null;
      return {
        state: {
          ...state,
          targetEmail: email,
          debouncingEmail: null,
          queuedEmail: null,
          rateLimited,
        },
        command: hadDebounce ? { type: 'cancel_debounce' } : null,
      };
    }

    if (!email) {
      const hadDebounce = state.debouncingEmail !== null;
      if (state.targetEmail === null && !hadDebounce && state.queuedEmail === null && state.rateLimited === rateLimited) {
        return { state, command: null };
      }
      return {
        state: {
          ...state,
          targetEmail: null,
          debouncingEmail: null,
          queuedEmail: null,
          rateLimited,
        },
        command: hadDebounce ? { type: 'cancel_debounce' } : null,
      };
    }

    if (state.cache[email] || state.inflightEmail === email) {
      const hadDebounce = state.debouncingEmail !== null;
      return {
        state: {
          ...state,
          targetEmail: email,
          debouncingEmail: null,
          queuedEmail: null,
          rateLimited,
        },
        command: hadDebounce ? { type: 'cancel_debounce' } : null,
      };
    }

    if (state.targetEmail === email && state.debouncingEmail === email && !action.textChanged) {
      return { state, command: null };
    }

    if (state.targetEmail === email && (state.debouncingEmail === email || state.queuedEmail === email)) {
      return {
        state: state.rateLimited !== rateLimited ? { ...state, rateLimited } : state,
        command: null,
      };
    }

    const seq = state.nextSeq + 1;
    return {
      state: {
        ...state,
        targetEmail: email,
        debouncingEmail: email,
        debouncingSeq: seq,
        queuedEmail: null,
        nextSeq: seq,
        rateLimited,
      },
      command: { type: 'debounce', email, seq, delayMs: INVITE_LOOKUP_DEBOUNCE_MS },
    };
  }

  if (action.type === 'debounce_fire') {
    if (
      state.stopped ||
      state.inviteClosed ||
      state.rateLimited ||
      state.debouncingEmail !== action.email ||
      state.debouncingSeq !== action.seq ||
      state.targetEmail !== action.email
    ) {
      return { state, command: null };
    }
    if (state.cache[action.email] || state.inflightEmail === action.email) {
      return {
        state: { ...state, debouncingEmail: null },
        command: null,
      };
    }
    if (state.inflightEmail !== null) {
      return {
        state: { ...state, debouncingEmail: null, queuedEmail: action.email },
        command: null,
      };
    }
    return {
      state: {
        ...state,
        debouncingEmail: null,
        inflightEmail: action.email,
        inflightSeq: action.seq,
        queuedEmail: null,
      },
      command: { type: 'fetch', email: action.email, seq: action.seq },
    };
  }

  // `answer`
  if (action.seq !== state.inflightSeq) {
    return { state, command: null };
  }

  const email = action.email.trim().toLowerCase();
  const stillTargeted = state.targetEmail === email;

  if (!action.result.ok) {
    const code = action.result.code;
    const isClosed = code === 'invalid';
    const isStopped = isClosed || code === 'rooms_closed' || code === 'sign_in_required' || code === 'not_found';
    const isRateLimited = code === 'rate_limited';

    if (isStopped || isRateLimited) {
      return {
        state: {
          ...state,
          inflightEmail: null,
          queuedEmail: null,
          debouncingEmail: null,
          rateLimited: state.rateLimited || isRateLimited,
          stopped: state.stopped || isStopped,
          inviteClosed: state.inviteClosed || isClosed,
        },
        command: null,
      };
    }

    const nextQueued =
      state.queuedEmail &&
      state.queuedEmail === state.targetEmail &&
      !state.cache[state.queuedEmail] &&
      !state.rateLimited &&
      !state.stopped
        ? state.queuedEmail
        : null;
    if (nextQueued) {
      const nextSeq = state.nextSeq + 1;
      return {
        state: {
          ...state,
          inflightEmail: nextQueued,
          inflightSeq: nextSeq,
          queuedEmail: null,
          nextSeq,
        },
        command: { type: 'fetch', email: nextQueued, seq: nextSeq },
      };
    }
    return {
      state: { ...state, inflightEmail: null, queuedEmail: null },
      command: null,
    };
  }

  // Drop stale answer when the address is no longer the active target in the field.
  const nextCache = stillTargeted
    ? {
        ...state.cache,
        [email]: toCacheEntry(action.result),
        [action.result.email.trim().toLowerCase()]: toCacheEntry(action.result),
      }
    : state.cache;

  const nextQueued =
    state.queuedEmail &&
    state.queuedEmail === state.targetEmail &&
    !nextCache[state.queuedEmail] &&
    !state.rateLimited &&
    !state.stopped
      ? state.queuedEmail
      : null;

  if (nextQueued) {
    const nextSeq = state.nextSeq + 1;
    return {
      state: {
        ...state,
        cache: nextCache,
        inflightEmail: nextQueued,
        inflightSeq: nextSeq,
        queuedEmail: null,
        nextSeq,
      },
      command: { type: 'fetch', email: nextQueued, seq: nextSeq },
    };
  }

  return {
    state: {
      ...state,
      cache: nextCache,
      inflightEmail: null,
      queuedEmail: null,
    },
    command: null,
  };
}

export type InviteLookupView =
  | { kind: 'none' }
  | { kind: 'loading'; email: string }
  | { kind: 'rate_limited'; email: string }
  | { kind: 'invitable'; email: string }
  | { kind: 'not_allowed'; email: string }
  | { kind: 'self'; email: string }
  | { kind: 'member'; email: string; person: { id: string; name: string; role: SendPerson['role'] | null } };

export function activeInviteLookupView(
  state: InviteLookupState,
  people: readonly SendPerson[],
  peopleReady: boolean,
): InviteLookupView {
  const email = state.targetEmail;
  if (!email || state.inviteClosed) return { kind: 'none' };
  if (state.rateLimited) return { kind: 'rate_limited', email };

  const entry = state.cache[email];
  if (entry) {
    if (entry.status === 'member') {
      if (!peopleReady) return { kind: 'loading', email };
      const self = people.find((p) => p.me && p.id.toLowerCase() === entry.member.id.toLowerCase());
      if (self) return { kind: 'self', email };
      const matched = people.find((p) => p.id.toLowerCase() === entry.member.id.toLowerCase());
      return {
        kind: 'member',
        email,
        person: {
          id: entry.member.id,
          name: matched?.name || entry.member.name,
          role: matched?.role ?? null,
        },
      };
    }
    if (entry.status === 'invitable') return { kind: 'invitable', email };
    return { kind: 'not_allowed', email };
  }

  if (state.debouncingEmail === email || state.inflightEmail === email || state.queuedEmail === email) {
    return { kind: 'loading', email };
  }
  return { kind: 'none' };
}

/* ------------------------------------------------------------------ tracked invites */

export interface TrackedInvite {
  email: string;
  start: number;
  end: number;
}

function hasInviteBoundary(text: string, start: number): boolean {
  return start === 0 || /\s/.test(text[start - 1] ?? '');
}

function validTrackedInvites(text: string, tracked: readonly TrackedInvite[]): TrackedInvite[] {
  return tracked.filter(
    (inv) =>
      inv.start >= 0 &&
      inv.end <= text.length &&
      hasInviteBoundary(text, inv.start) &&
      text.slice(inv.start, inv.end).toLowerCase() === `@${inv.email}`,
  );
}

/** Verified unique invite addresses carried by `text` in order, capped at `SEND_LIMITS.invitesPerMessage`. */
export function extractInviteEmails(text: string, tracked: readonly TrackedInvite[]): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const inv of validTrackedInvites(text, tracked)) {
    if (!seen.has(inv.email)) {
      seen.add(inv.email);
      emails.push(inv.email);
      if (emails.length >= SEND_LIMITS.invitesPerMessage) break;
    }
  }
  return emails;
}

export type ApplyInvitePickResult =
  | {
      ok: true;
      email: string;
      text: string;
      caret: number;
      trackedMentions: TrackedMention[];
      trackedInvites: TrackedInvite[];
    }
  | { ok: false; reason: 'invalid' | 'too_many' };

export function applyInvitePick(
  text: string,
  trigger: MentionTrigger,
  email: string,
  trackedMentions: readonly TrackedMention[],
  trackedInvites: readonly TrackedInvite[],
): ApplyInvitePickResult {
  const normalized = parseCompleteInviteEmail(email);
  if (!normalized) return { ok: false, reason: 'invalid' };
  const existing = extractInviteEmails(text, trackedInvites);
  if (!existing.includes(normalized) && existing.length >= SEND_LIMITS.invitesPerMessage) {
    return { ok: false, reason: 'too_many' };
  }

  const insert = `@${normalized} `;
  const nextText = text.slice(0, trigger.start) + insert + text.slice(trigger.end);
  const delta = insert.length - (trigger.end - trigger.start);
  const tokenEnd = trigger.start + 1 + normalized.length;

  const nextMentions: TrackedMention[] = [];
  for (const m of trackedMentions) {
    if (m.end <= trigger.start) nextMentions.push({ ...m });
    else if (m.start >= trigger.end) nextMentions.push({ ...m, start: m.start + delta, end: m.end + delta });
  }

  const nextInvites: TrackedInvite[] = [];
  for (const inv of trackedInvites) {
    if (inv.end <= trigger.start) nextInvites.push({ ...inv });
    else if (inv.start >= trigger.end) nextInvites.push({ ...inv, start: inv.start + delta, end: inv.end + delta });
  }
  nextInvites.push({ email: normalized, start: trigger.start, end: tokenEnd });
  nextInvites.sort((a, b) => a.start - b.start);

  return {
    ok: true,
    email: normalized,
    text: nextText,
    caret: trigger.start + insert.length,
    trackedMentions: nextMentions,
    trackedInvites: nextInvites,
  };
}

/**
 * Updates tracked invite spans after any text edit. Deleting or editing any character inside an
 * inserted `@address` token (or breaking its whitespace boundary) removes that invite.
 */
export function reconcileInvites(
  prevText: string,
  nextText: string,
  tracked: readonly TrackedInvite[],
): TrackedInvite[] {
  if (tracked.length === 0) return [];
  if (prevText === nextText) return validTrackedInvites(nextText, tracked);

  let prefix = 0;
  const minLen = Math.min(prevText.length, nextText.length);
  while (prefix < minLen && prevText[prefix] === nextText[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = minLen - prefix;
  while (
    suffix < maxSuffix &&
    prevText[prevText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const editStart = prefix;
  const prevEditEnd = prevText.length - suffix;
  const delta = nextText.length - prevText.length;

  const kept: TrackedInvite[] = [];
  for (const inv of tracked) {
    let start = inv.start;
    let end = inv.end;
    if (editStart >= inv.end) {
      // Edit is strictly after this invite token.
    } else if (prevEditEnd <= inv.start) {
      // Edit is strictly before this invite token.
      start += delta;
      end += delta;
    } else {
      continue;
    }

    if (
      start >= 0 &&
      end <= nextText.length &&
      hasInviteBoundary(nextText, start) &&
      nextText.slice(start, end).toLowerCase() === `@${inv.email}`
    ) {
      kept.push({ ...inv, start, end });
    }
  }
  return kept;
}

/** Removes all tracked spans for `targetEmail` from `text` and shifts tracked mentions and remaining invites. */
export function removeTrackedInvite(
  text: string,
  targetEmail: string,
  trackedMentions: readonly TrackedMention[],
  trackedInvites: readonly TrackedInvite[],
): { text: string; trackedMentions: TrackedMention[]; trackedInvites: TrackedInvite[] } {
  const target = targetEmail.trim().toLowerCase();
  const valid = validTrackedInvites(text, trackedInvites).sort((a, b) => a.start - b.start);
  let nextText = text;
  let nextMentions = trackedMentions.map((m) => ({ ...m }));
  let nextInvites = valid.filter((inv) => inv.email !== target).map((inv) => ({ ...inv }));

  const removals = valid.filter((inv) => inv.email === target).sort((a, b) => b.start - a.start);
  for (const rem of removals) {
    let cutStart = rem.start;
    let cutEnd = rem.end;
    if (nextText[cutEnd] === ' ') {
      cutEnd += 1;
    } else if (cutStart > 0 && nextText[cutStart - 1] === ' ') {
      cutStart -= 1;
    }
    const delta = cutEnd - cutStart;
    nextText = nextText.slice(0, cutStart) + nextText.slice(cutEnd);
    nextMentions = nextMentions
      .filter((m) => m.end <= cutStart || m.start >= cutEnd)
      .map((m) => (m.start >= cutEnd ? { ...m, start: m.start - delta, end: m.end - delta } : m));
    nextInvites = nextInvites
      .filter((inv) => inv.end <= cutStart || inv.start >= cutEnd)
      .map((inv) => (inv.start >= cutEnd ? { ...inv, start: inv.start - delta, end: inv.end - delta } : inv));
  }

  return {
    text: nextText,
    trackedMentions: nextMentions,
    trackedInvites: nextInvites,
  };
}

function isAllowedLeftBoundary(text: string, tokStart: number): boolean {
  if (tokStart === 0) return true;
  const ch = text[tokStart - 1]!;
  if (/\s/.test(ch)) return true;
  if (/^\p{Script=Hangul}$/u.test(ch)) return true;
  if (/[@._+\-\/=]/.test(ch)) return false;
  return /^[\p{P}<>「」『』【】~]$/u.test(ch);
}

function isAllowedRightBoundary(text: string, emailEnd: number): boolean {
  if (emailEnd >= text.length) return true;
  const ch = text[emailEnd]!;
  if (/\s/.test(ch)) return true;
  if (/^\p{Script=Hangul}$/u.test(ch)) return true;
  if (ch === '.') {
    const afterDot = text[emailEnd + 1] ?? '';
    return !/[\p{L}\p{N}@._+\-\/=]/u.test(afterDot);
  }
  if (/[@_+\-\/=]/.test(ch)) return false;
  return /^[\p{P}>」』】~]$/u.test(ch);
}

function isUrlTokenChunk(text: string, tokStart: number, emailEnd: number): boolean {
  let wsLeft = tokStart;
  while (wsLeft > 0 && !/\s/.test(text[wsLeft - 1]!)) wsLeft -= 1;
  let wsRight = emailEnd;
  while (wsRight < text.length && !/\s/.test(text[wsRight]!)) wsRight += 1;
  const wsChunk = text.slice(wsLeft, wsRight);
  if (/^(?:https?:|mailto:|ftp:|www\.)/i.test(wsChunk)) return true;
  if (wsChunk.includes('://') || wsChunk.includes('/') || wsChunk.includes('=') || wsChunk.includes('&')) return true;
  const leftInChunk = text.slice(wsLeft, tokStart);
  if (leftInChunk.includes('?')) return true;
  const rightInChunk = text.slice(emailEnd, wsRight);
  if (/^\?[\p{L}\p{N}]/u.test(rightInChunk)) return true;
  return false;
}

function findStandaloneEmailSpans(text: string, emails: readonly string[]): Array<{ start: number; end: number }> {
  if (!text || emails.length === 0) return [];
  const lower = text.toLowerCase();
  const sorted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const rawSpans: Array<{ start: number; end: number }> = [];

  for (const email of sorted) {
    let pos = 0;
    while (pos <= lower.length - email.length) {
      const idx = lower.indexOf(email, pos);
      if (idx === -1) break;
      const emailEnd = idx + email.length;
      const hasDoubleAt = idx >= 2 && text[idx - 1] === '@' && text[idx - 2] === '@';
      const tokStart = !hasDoubleAt && idx > 0 && text[idx - 1] === '@' ? idx - 1 : idx;
      if (
        !hasDoubleAt &&
        isAllowedLeftBoundary(text, tokStart) &&
        isAllowedRightBoundary(text, emailEnd) &&
        !isUrlTokenChunk(text, tokStart, emailEnd)
      ) {
        rawSpans.push({ start: tokStart, end: emailEnd });
      }
      pos = emailEnd;
    }
  }

  rawSpans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of rawSpans) {
    const prev = merged[merged.length - 1];
    if (prev && span.start < prev.end) continue;
    merged.push(span);
  }
  return merged;
}

/**
 * Builds the wire `body` by removing every standalone occurrence of any invited address
 * (case-insensitive, with directly preceding `@` when present). Longer tokens (e.g. `aa@b.com`
 * when inviting `a@b.com`) and URLs containing an invited address stay untouched so
 * `conflictingInviteEmails` catches them and refuses in-field before sending.
 */
export function stripTrackedInvitesFromBody(text: string, trackedInvites: readonly TrackedInvite[]): string {
  const invitedEmails = extractInviteEmails(text, trackedInvites);
  if (invitedEmails.length === 0) {
    return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  }
  const spans = findStandaloneEmailSpans(text, invitedEmails).sort((a, b) => b.start - a.start);
  let out = text;
  for (const span of spans) {
    let cutStart = span.start;
    let cutEnd = span.end;
    if (out[cutEnd] === ' ' && (cutStart === 0 || /\s/.test(out[cutStart - 1] ?? ''))) {
      cutEnd += 1;
    } else if (
      cutStart > 0 &&
      out[cutStart - 1] === ' ' &&
      (cutEnd === out.length || /[\s.,!?;:)\]}"'”’»]/.test(out[cutEnd] ?? ''))
    ) {
      cutStart -= 1;
    }
    out = out.slice(0, cutStart) + out.slice(cutEnd);
  }
  return out.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/**
 * Returns invited addresses that still appear inside `wireBody` as part of a longer token or URL,
 * which the server would reject as `invalid` (`body.includes(email)`).
 */
export function conflictingInviteEmails(wireBody: string, inviteEmails: readonly string[]): string[] {
  if (inviteEmails.length === 0) return [];
  const lower = wireBody.toLowerCase();
  return inviteEmails.filter((email) => lower.includes(email.toLowerCase()));
}

export function remainingInviteDraftAfterSend(
  currentText: string,
  sentRawText: string,
  currentMentions: readonly TrackedMention[],
  currentInvites: readonly TrackedInvite[],
): { text: string; trackedMentions: TrackedMention[]; trackedInvites: TrackedInvite[]; cleared: boolean } {
  if (!currentText.startsWith(sentRawText)) {
    return {
      text: currentText,
      trackedMentions: currentMentions.map((m) => ({ ...m })),
      trackedInvites: currentInvites.map((inv) => ({ ...inv })),
      cleared: currentText.length === 0,
    };
  }
  let cut = sentRawText.length;
  const trailing = currentText[cut];
  if (trailing === ' ' || trailing === '\n') {
    cut += 1;
  }
  const nextText = currentText.slice(cut);
  const nextMentions: TrackedMention[] = [];
  for (const m of currentMentions) {
    if (m.start < cut) continue;
    const start = m.start - cut;
    const end = m.end - cut;
    if (end <= nextText.length && hasInviteBoundary(nextText, start) && nextText.slice(start, end) === `@${m.name}`) {
      nextMentions.push({ ...m, start, end });
    }
  }
  const nextInvites: TrackedInvite[] = [];
  for (const inv of currentInvites) {
    if (inv.start < cut) continue;
    const start = inv.start - cut;
    const end = inv.end - cut;
    if (
      end <= nextText.length &&
      hasInviteBoundary(nextText, start) &&
      nextText.slice(start, end).toLowerCase() === `@${inv.email}`
    ) {
      nextInvites.push({ ...inv, start, end });
    }
  }
  return {
    text: nextText,
    trackedMentions: nextMentions,
    trackedInvites: nextInvites,
    cleared: nextText.length === 0,
  };
}

export function resolveInviteRequestId(
  plan: RequestIdPlan,
  wireBody: string,
  mentions: readonly string[],
  invites: readonly string[],
  makeId: () => string = () => crypto.randomUUID(),
): { plan: RequestIdPlan; requestId: string } {
  const normalized = wireBody.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  const key = `${normalized}\u0000${mentions.join(',')}\u0000${invites.join(',')}`;
  if (plan.key === key && plan.requestId) {
    return { plan, requestId: plan.requestId };
  }
  const requestId = makeId();
  return { plan: { key, requestId }, requestId };
}

/* ------------------------------------------------------------------ refusals & chips */

export interface InviteRefusalOutcome {
  hideSend: boolean;
  keepText: boolean;
  resetRequestId: boolean;
  errorText: string | null;
  refusedEmails: string[];
}

export function inviteRefusalOutcome(
  code: string,
  refused: readonly string[] | undefined,
  context: SendRefusalContext,
  copy: SendCopy,
  carriedInvites = false,
): InviteRefusalOutcome {
  if (code === 'invite_limit') {
    return {
      hideSend: false,
      keepText: true,
      resetRequestId: false,
      errorText: copy.inviteLimit,
      refusedEmails: [],
    };
  }
  if (code === 'invite_refused') {
    const normalized = [...new Set((refused ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    return {
      hideSend: false,
      keepText: true,
      resetRequestId: true,
      errorText: normalized.length > 0 ? null : copy.inviteRefused,
      refusedEmails: normalized,
    };
  }
  if (code === 'forbidden') {
    return {
      hideSend: false,
      keepText: true,
      resetRequestId: true,
      errorText: copy.inviteNotAllowed,
      refusedEmails: [],
    };
  }
  if (code === 'invalid' && carriedInvites) {
    return {
      hideSend: false,
      keepText: true,
      resetRequestId: true,
      errorText: copy.sendFailed,
      refusedEmails: [],
    };
  }
  const base = sendRefusalOutcome(code, context);
  return {
    hideSend: base.hideSend,
    keepText: base.keepText,
    resetRequestId: base.resetRequestId,
    errorText: refusalMessageText(base, copy),
    refusedEmails: [],
  };
}

export function formatInviteRemoveLabel(email: string, template: string): string {
  const trimmed = template.trim();
  return trimmed.includes('{name}') ? trimmed.replace('{name}', email) : `${trimmed} ${email}`;
}

export type InviteChipView =
  | {
      kind: 'detail';
      key: string;
      email: string;
      state: SendInviteChip['state'];
      stateLabel: string;
      hasCopyLink: boolean;
    }
  | {
      kind: 'count';
      key: 'count';
      count: number;
      label: string;
    };

export function inviteChipDisplayList(
  invites: readonly SendInviteChip[] | undefined,
  copy: Pick<SendCopy, 'chipPending' | 'chipExpired' | 'chipAccepted' | 'chipCount'>,
  copyableEmails?: ReadonlySet<string>,
): InviteChipView[] {
  if (!invites || invites.length === 0) return [];
  const out: InviteChipView[] = [];
  let hiddenCount = 0;

  for (let i = 0; i < invites.length; i += 1) {
    const chip = invites[i]!;
    if (chip.email === null) {
      hiddenCount += 1;
      continue;
    }
    const lower = chip.email.toLowerCase();
    const stateLabel =
      chip.state === 'expired'
        ? copy.chipExpired
        : chip.state === 'accepted'
          ? copy.chipAccepted
          : copy.chipPending;
    out.push({
      kind: 'detail',
      key: `${lower}:${i}`,
      email: chip.email,
      state: chip.state,
      stateLabel,
      hasCopyLink: Boolean(copyableEmails?.has(lower)),
    });
  }

  if (hiddenCount > 0) {
    out.push({
      kind: 'count',
      key: 'count',
      count: hiddenCount,
      label: copy.chipCount.replace('{n}', String(hiddenCount)),
    });
  }
  return out;
}

/** Extracts single-use copyable invite link tokens returned for newly issued invitations when mail is off/unsent. */
export function extractCopyableInviteTokens(
  invited: readonly SendInviteOutcome[] | undefined,
): Record<string, string> {
  if (!invited || invited.length === 0) return {};
  const map: Record<string, string> = {};
  for (const item of invited) {
    if (item.result === 'invited' && typeof item.token === 'string' && item.token.length > 0 && item.mailState !== 'sent') {
      map[item.email.trim().toLowerCase()] = item.token;
    }
  }
  return map;
}

/** Builds the existing invitation acceptance URL (`/brand/invite#token=<encoded>`). */
export function buildInviteLinkUrl(origin: string, token: string): string {
  return `${origin}/brand/invite#token=${encodeURIComponent(token)}`;
}
