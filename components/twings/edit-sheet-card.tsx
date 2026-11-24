/**
 * docs/PERSONAL-STUDIO.md §2.3, §3.1 — the customer's edit sheet card (P1a screen half, flag
 * `TWINGS_PERSONAL_EDIT_SHEET`). The template page's director panel shows the customer's requests back as three
 * blocks (change, keep, exclude) instead of the summary chips, and the order carries the sheet.
 *
 * Presentational and client-safe: the card takes resolved strings and callbacks; the pure helpers below hold every
 * decision the panel makes about a turn's answer and about what the order carries, so they are tested without a DOM.
 * Every word comes from the `editSheet` dictionary section; slot names are looked up by `slot`, never taken from
 * the server's Korean chip label.
 */
import { useId } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { normSheetText, sheetTextKey } from '@/lib/revision/sheet-core';
import {
  locksFromPublic,
  lockVerdict,
  type PublicTemplateLocks,
  type TemplateLocks
} from '@/lib/template-director/locks';
import {
  appendSheetTurns,
  chipsFromSheet,
  cleanPersonalSheetState,
  foldPendingNote,
  guardSheetText,
  hasSheetContent,
  sheetForOrder,
} from '@/lib/template-director/sheet';
import {
  PERSONAL_SHEET_BLOCKS,
  PERSONAL_SHEET_LIMITS,
  type CustomDirectorRefSlot,
  type PersonalAudioMode,
  type PersonalBgmMood,
  type PersonalDirectorSpec,
  type PersonalEditSheet,
  type PersonalSheetBlock,
  type PersonalSheetChange,
  type PersonalSheetQuestion,
  type PersonalSheetState,
} from '@/lib/template-director/schema';

export type EditSheetCopy = Dictionary['editSheet'];

// --- What the order carries ---------------------------------------------------------------------------------------

/**
 * Typed text that was not sent as a turn, against the sheet:
 * - `none`: nothing typed;
 * - `folded`: it joins the sheet (a new whole-video action line, or appended to the last one when the block is full);
 * - `present`: the same request is already listed;
 * - `full`: six change lines and none to append to — it cannot travel, so the screen says so and keeps the text;
 * - `blocked`: the text guard refuses it (another person's face, instructions to the system), or a template lock
 *   would drop it (`locked`, docs/PERSONAL-STUDIO.md §3.3) — the screen says so instead of folding it in silently.
 */
export type PendingFoldStatus = 'none' | 'folded' | 'present' | 'full' | 'blocked';

export interface PendingFold {
  /** The sheet the order carries and the card shows. */
  sheet: PersonalEditSheet;
  status: PendingFoldStatus;
  /** The change line that holds the typed text, or null. */
  pendingIndex: number | null;
  /** Why a `blocked` note was refused. */
  blockedAs?: 'identity' | 'unsafe' | 'locked';
  /** `folded`, but the line holds only part of the typed text (a sheet line is at most `itemMax` characters). */
  truncated?: boolean;
}

const isUnrangedAction = (l: PersonalSheetChange): boolean => l.slot === 'shot_action' && !l.shots && !l.ref;

/**
 * docs/PERSONAL-STUDIO.md §3.3 — whether a template lock would keep typed text out of the video: the line it folds
 * into (an unranged action) fails `lockVerdict`, the same check the compile applies to that line (a closed action
 * slot, a closed slot the text is about by the keyword lists, or a named locked part).
 */
function lockedPendingText(text: string, locks: TemplateLocks): boolean {
  return locks.any && lockVerdict({ slot: 'shot_action', text }, locks) !== 'ok';
}

export function foldPendingForOrder(
  sheet: PersonalEditSheet,
  note: string,
  locks: PublicTemplateLocks | null = null
): PendingFold {
  const full = normSheetText(note).trim();
  const text = full.slice(0, PERSONAL_SHEET_LIMITS.itemMax).trim();
  if (!text) return { sheet, status: 'none', pendingIndex: null };
  const verdict = guardSheetText(text);
  if (verdict !== 'ok') return { sheet, status: 'blocked', pendingIndex: null, blockedAs: verdict };
  if (locks && lockedPendingText(full, locksFromPublic(locks))) {
    return { sheet, status: 'blocked', pendingIndex: null, blockedAs: 'locked' };
  }
  const next = foldPendingNote(sheet, text);
  if (next === sheet) {
    const listed = sheet.change.some((l) => isUnrangedAction(l) && sheetTextKey(l.text) === sheetTextKey(text));
    return { sheet, status: listed ? 'present' : 'full', pendingIndex: null };
  }
  const changedAt = next.change.findIndex((l, i) => l !== sheet.change[i]);
  const pendingIndex = changedAt < 0 ? next.change.length - 1 : changedAt;
  // Cut when the line no longer holds the whole request (too long on its own, or joined onto a full line).
  const truncated = !(next.change[pendingIndex]?.text ?? '').includes(full);
  return { sheet: next, status: 'folded', pendingIndex, ...(truncated ? { truncated: true } : {}) };
}

/**
 * The director spec an order carries in sheet mode: the sheet without history, the chips derived from it (a compile
 * with the flag off is built from them), and the change texts as the note (the chips path reads only hair, makeup,
 * outfit and prop, so the rest travels in `userMessage`). Typed text that was not sent is folded in first. Null when
 * nothing is asked for — the same rule as the chips path. With template locks (docs/PERSONAL-STUDIO.md §3.3) locked
 * typed text, closed photos and, under a sound lock, background music stay out of the order (the compile drops them
 * again); without locks the spec is exactly as before.
 */
export function buildSheetDirectorSpec(input: {
  sheet: PersonalEditSheet;
  pendingNote: string;
  audioMode: PersonalAudioMode;
  bgmMood: PersonalBgmMood | null;
  slotOverrides: readonly CustomDirectorRefSlot[];
  locks?: PublicTemplateLocks | null;
}): { spec: PersonalDirectorSpec | null; fold: PendingFold } {
  const locks = input.locks ?? null;
  const soundLocked = locks !== null && locks.named.includes('sound');
  const audioMode: PersonalAudioMode = soundLocked ? 'ambient' : input.audioMode;
  const bgmMood = soundLocked ? null : input.bgmMood;
  const slotOverrides = locks ? input.slotOverrides.filter((ref) => !locks.refs.includes(ref)) : input.slotOverrides;
  const fold = foldPendingForOrder(input.sheet, input.pendingNote, locks);
  const hasSheet = hasSheetContent(fold.sheet);
  const hasAny = hasSheet || audioMode === 'bgm' || slotOverrides.length > 0;
  if (!hasAny) return { spec: null, fold };
  const order = sheetForOrder(fold.sheet);
  const note = order.change.map((l) => l.text).join('\n').trim();
  return {
    fold,
    spec: {
      userMessage: note || null,
      summaryChips: chipsFromSheet(order),
      audioMode,
      bgmMood: audioMode === 'bgm' ? bgmMood : null,
      structuredIntent: null,
      slotOverrides: [...slotOverrides],
      ...(hasSheet ? { sheet: order } : {}),
    },
  };
}

// --- A turn's answer ----------------------------------------------------------------------------------------------

export type SheetNoticeKey =
  | 'updated'
  | 'unchanged'
  | 'rateLimited'
  | 'retry'
  | 'refusedIdentity'
  | 'refusedUnsafe'
  | 'refusedUnsupported'
  | 'refusedTooLarge'
  /** docs/PERSONAL-STUDIO.md §3.3 — the turn asked to change a fixed part: nothing else changed. */
  | 'refusedLocked'
  /** The turn changed something, and its part about a fixed part was left out. */
  | 'updatedLocked';

/**
 * The live line under the card: always dictionary copy (the studio's own reply is not shown — it repeats the request
 * and is written in Korean). `detail` is the studio's note on a softened request, kept only where it is readable.
 */
export interface SheetNotice {
  key: SheetNoticeKey;
  detail?: string;
}

/** `turn.refusal` as dictionary copy; the server's Korean sentence is never shown in sheet mode. */
export function sheetRefusalNotice(refusal: unknown): SheetNoticeKey {
  switch (refusal) {
    case 'identity':
      return 'refusedIdentity';
    case 'unsafe':
      return 'refusedUnsafe';
    case 'too_large':
      return 'refusedTooLarge';
    default:
      return 'refusedUnsupported';
  }
}

export interface SheetTurnOutcome {
  state: PersonalSheetState;
  notice: SheetNotice | null;
  /** The request was taken: the text that was sent may leave the input. */
  accepted: boolean;
  changed: boolean;
}

/**
 * Reads one `/api/template-director` answer in sheet mode. A rate limit (429) or any failure leaves the state as it
 * was; an answer adopts the server's sheet, question and `asked`, and appends the turn to the kept conversation (the
 * studio's reply travels back as context but is never shown). The answer is checked again here
 * (`cleanPersonalSheetState`), as the server checks what the screen sends.
 */
export function readSheetTurnAnswer(input: {
  prior: PersonalSheetState;
  message: string;
  status: number;
  payload: unknown;
  /**
   * The screen's locale: the studio writes `guardrailAdjustmentKo` (and, for now, its question) in Korean, so the
   * note shows only in `ko`, and a question counts only where `visibleSheetQuestion` lets it render.
   */
  locale: string;
}): SheetTurnOutcome {
  const { prior } = input;
  const kept = (key: SheetNoticeKey): SheetTurnOutcome => ({
    state: prior,
    notice: { key },
    accepted: false,
    changed: false,
  });
  const body = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : null;
  if (input.status === 429 || body?.code === 'rate_limited') return kept('rateLimited');
  // docs/PERSONAL-STUDIO.md §3.3 — a photo for a reference the template closed (the screen hides those pickers).
  if (body?.code === 'locked_slot_photo') return kept('refusedLocked');
  if (input.status < 200 || input.status >= 300 || body?.ok !== true) return kept('retry');
  const turn = body.turn && typeof body.turn === 'object' ? (body.turn as Record<string, unknown>) : null;
  if (!turn || !turn.sheet || typeof turn.sheet !== 'object') return kept('retry');

  const reply = typeof turn.replyKo === 'string' ? turn.replyKo.trim() : '';
  const state = cleanPersonalSheetState({
    sheet: turn.sheet,
    turns: appendSheetTurns(prior.turns, input.message, reply),
    question: turn.question ?? null,
    asked: prior.asked || turn.asked === true,
  });
  const accepted = turn.approved === true && turn.refusal === 'none';
  // docs/PERSONAL-STUDIO.md §3.3 — the turn asked to change a part the template fixes; that part was left out.
  const lockedHit = turn.lockedHit === true;
  if (!accepted) {
    const key = lockedHit && turn.refusal === 'unsupported' ? 'refusedLocked' : sheetRefusalNotice(turn.refusal);
    return { state, notice: { key }, accepted: false, changed: false };
  }
  const changed = turn.changed === true;
  const adjustment = typeof turn.guardrailAdjustmentKo === 'string' ? turn.guardrailAdjustmentKo.trim() : '';
  const detail = input.locale === 'ko' && adjustment ? { detail: adjustment } : {};
  // A locked request is always answered, even next to a question: the customer must know it was left out.
  if (lockedHit) return { state, notice: { key: changed ? 'updatedLocked' : 'refusedLocked', ...detail }, accepted: true, changed };
  // A turn that asked a question the card will show: no "unchanged" line, the question stands alone (and "updated"
  // only when the sheet did change). A question the guard hides does not count.
  const asksQuestion = visibleSheetQuestion(state.question, input.locale) !== null;
  if (!changed && asksQuestion) return { state, notice: null, accepted: true, changed };
  const notice: SheetNotice = {
    key: changed ? 'updated' : 'unchanged',
    ...detail,
  };
  return { state, notice, accepted: true, changed };
}

export function sheetNoticeText(notice: SheetNotice | null, copy: EditSheetCopy): string | null {
  return notice ? copy[notice.key] : null;
}

const HANGUL = /[가-힣]/;

/**
 * The question the card may show. Temporary guard: the studio writes its question in Korean for now (server
 * follow-up: localize `question` in lib/template-director/flash-director.ts), so the English screen leaves a Korean
 * question out instead of showing it untranslated. Never blocks ordering — the question is optional anyway.
 */
export function visibleSheetQuestion(
  question: PersonalSheetQuestion | null,
  locale: string,
): PersonalSheetQuestion | null {
  if (!question) return null;
  if (locale === 'en' && [question.text, ...question.options].some((text) => HANGUL.test(text))) return null;
  return question;
}

/** What the card says under the pending line when only part of the typed text is on it; never blocks ordering. */
export function pendingLineNotice(fold: Pick<PendingFold, 'status' | 'truncated'>, copy: EditSheetCopy): string | null {
  return fold.status === 'folded' && fold.truncated ? copy.pendingTooLong : null;
}

/** What the card says about typed text it could not carry; null when there is nothing to say. */
export function pendingFoldNotice(fold: Pick<PendingFold, 'status' | 'blockedAs'>, copy: EditSheetCopy): string | null {
  if (fold.status === 'full') return interpolate(copy.full, { max: PERSONAL_SHEET_LIMITS.changeMax });
  if (fold.status === 'blocked') {
    if (fold.blockedAs === 'locked') return copy.refusedLocked;
    return fold.blockedAs === 'identity' ? copy.refusedIdentity : copy.refusedUnsafe;
  }
  return null;
}

// --- Template locks (docs/PERSONAL-STUDIO.md §3.3, §3.4.4) ----------------------------------------------------------

/** One part the template fixes, as the screen names it. `key`: 'product' | 'logo' | 'sound' | <slot> | 'shots-2-3'. */
export interface LockedPart {
  key: string;
  label: string;
}

/**
 * The template's locked parts in the screen's words: the named parts, then the closed slots, then the shot ranges.
 * The prop is part of the product, so it is not listed again when the product is locked. Empty when everything is
 * locked (`all`): the screen says so in one line instead.
 */
export function lockedPartsOf(locks: PublicTemplateLocks, copy: EditSheetCopy): LockedPart[] {
  if (locks.all) return [];
  const product = locks.named.includes('product');
  return [
    ...locks.named.map((kind) => ({ key: kind, label: copy.locks[kind] })),
    ...locks.slots.filter((slot) => !(slot === 'prop' && product)).map((slot) => ({ key: slot, label: copy.slots[slot] })),
    ...locks.shots.map((range) => ({ key: `shots-${range.from}-${range.to}`, label: shotLabel(range, copy) })),
  ];
}

/** A small padlock drawn like the one in components/playbook/blocks.tsx; decorative, the words carry the meaning. */
export function TemplateLockGlyph({ className = 'size-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// --- The card -----------------------------------------------------------------------------------------------------

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#09090B]';

const HEADING: Record<PersonalSheetBlock, 'changeHeading' | 'keepHeading' | 'excludeHeading'> = {
  change: 'changeHeading',
  keep: 'keepHeading',
  exclude: 'excludeHeading',
};

function shotLabel(shots: NonNullable<PersonalSheetChange['shots']>, copy: EditSheetCopy): string {
  return shots.from === shots.to
    ? interpolate(copy.shotOne, { n: shots.from })
    : interpolate(copy.shotRange, { from: shots.from, to: shots.to });
}

export interface EditSheetCardProps {
  copy: EditSheetCopy;
  /** The sheet as the order will carry it (typed text not sent yet already folded in). */
  sheet: PersonalEditSheet;
  /** The change line that holds typed text not sent yet; its remove button clears the input instead. */
  pendingIndex?: number | null;
  /** Shown directly under the pending line when it holds only part of the typed text. */
  pendingNotice?: string | null;
  question?: PersonalSheetQuestion | null;
  /** The turn's live line (taken, unchanged, refusal, rate limit, failure), already resolved to text. */
  notice?: string | null;
  /** A second line under it: the studio's note on a softened request, when readable. */
  noticeDetail?: string | null;
  /** What the card says about typed text it could not carry. */
  foldNotice?: string | null;
  /**
   * docs/PERSONAL-STUDIO.md §3.3 — the template's locked parts. Present, the card opens with "can't be changed" (even
   * on an empty sheet), above everything the customer changes. Absent, the card is exactly as before.
   */
  locks?: PublicTemplateLocks | null;
  disabled?: boolean;
  onRemove?: (block: PersonalSheetBlock, index: number) => void;
  onRevert?: (index: number) => void;
  onDiscardPending?: () => void;
  onAnswer?: (option: string) => void;
}

export function EditSheetCard({
  copy,
  sheet,
  pendingIndex = null,
  pendingNotice = null,
  question = null,
  notice = null,
  noticeDetail = null,
  foldNotice = null,
  locks = null,
  disabled = false,
  onRemove,
  onRevert,
  onDiscardPending,
  onAnswer,
}: EditSheetCardProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const empty = !hasSheetContent(sheet);
  const options = question ? question.options.slice(0, PERSONAL_SHEET_LIMITS.optionsMax) : [];
  const lockedId = `${baseId}-locked`;
  const lockedParts = locks ? lockedPartsOf(locks, copy) : [];

  const removeButton = (block: PersonalSheetBlock, index: number, item: string, pending: boolean) => (
    <button
      type="button"
      data-edit-sheet-remove={`${block}-${index}`}
      aria-label={interpolate(copy.removeLabel, { item })}
      disabled={disabled}
      onClick={() => (pending ? onDiscardPending?.() : onRemove?.(block, index))}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full text-base text-[#71717A] transition-colors hover:bg-[#F4F4F5] hover:text-[#09090B] disabled:opacity-40 ${FOCUS_RING}`}
    >
      ×
    </button>
  );

  return (
    <section
      data-edit-sheet
      aria-labelledby={titleId}
      className="rounded-[20px] border border-[#E4E4E7] bg-white px-4 pt-3.5 pb-3 text-[#09090B]"
    >
      <h3 id={titleId} className="text-sm font-semibold tracking-[-0.01em]">
        {copy.title}
      </h3>

      {/* Fixed parts: read-only, on the wash, no line controls — they never look like a line the customer can edit. */}
      {locks && (
        <section
          data-edit-sheet-block="locked"
          aria-labelledby={lockedId}
          className="mt-2 rounded-[14px] bg-[#F4F4F5] px-3 pt-2.5 pb-2.5"
        >
          <h4 id={lockedId} className="flex items-center gap-1.5 text-xs font-medium text-[#52525B]">
            <TemplateLockGlyph />
            {copy.lockedHeading}
          </h4>
          {locks.all ? (
            <p data-edit-sheet-locked-all className="mt-1 text-sm leading-[1.5] text-[#09090B]">
              {copy.lockedAll}
            </p>
          ) : (
            <>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {lockedParts.map((part) => (
                  <li
                    key={part.key}
                    data-edit-sheet-locked={part.key}
                    className="inline-flex min-h-7 items-center rounded-full border border-[#E4E4E7] bg-white px-2.5 text-xs font-medium text-[#09090B] tabular-nums"
                  >
                    {part.label}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs leading-relaxed text-[#71717A]">{copy.lockedNote}</p>
            </>
          )}
        </section>
      )}

      {empty ? (
        <p data-edit-sheet-empty className={`${locks ? 'mt-2.5' : 'mt-1'} text-[0.8125rem] leading-[1.55] text-[#71717A]`}>
          {copy.empty}
        </p>
      ) : (
        <div className={locks ? 'mt-2.5' : 'mt-1.5'}>
          {PERSONAL_SHEET_BLOCKS.map((block) => {
            const headingId = `${baseId}-${block}`;
            const count = sheet[block].length;
            // "Change" stands whenever the sheet has content; keep and exclude appear only with lines.
            if (block !== 'change' && count === 0) return null;
            return (
              <section
                key={block}
                data-edit-sheet-block={block}
                aria-labelledby={headingId}
                className="border-t border-[#E4E4E7] pt-2.5 pb-1.5 first:border-t-0 first:pt-1"
              >
                <h4 id={headingId} className="text-xs font-medium text-[#52525B]">
                  {copy[HEADING[block]]}
                </h4>
                {count > 0 && (
                  <ul className="mt-0.5">
                    {block === 'change'
                      ? sheet.change.map((line, index) => {
                          const slotName = copy.slots[line.slot];
                          const item = `${slotName}: ${line.text}`;
                          const pending = index === pendingIndex;
                          const canRevert = !pending && (line.was?.length ?? 0) > 0;
                          return (
                            <li
                              key={`change-${index}`}
                              data-edit-sheet-line={`change-${index}`}
                              className="flex items-start gap-1 border-t border-[#F4F4F5] py-1 first:border-t-0"
                            >
                              <div className="min-w-0 flex-1 py-1.5">
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                                  <span className="font-semibold text-[#09090B]">{slotName}</span>
                                  {line.shots && (
                                    <span data-edit-sheet-shots className="text-[#52525B] tabular-nums">
                                      {shotLabel(line.shots, copy)}
                                    </span>
                                  )}
                                  {line.ref && (
                                    <span
                                      data-edit-sheet-photo
                                      className="rounded-full bg-[#F4F4F5] px-2 py-0.5 text-[0.6875rem] font-medium text-[#52525B]"
                                    >
                                      {copy.photoAttached}
                                    </span>
                                  )}
                                  {pending && (
                                    <span
                                      data-edit-sheet-pending
                                      className="rounded-full border border-[#E4E4E7] px-2 py-0.5 text-[0.6875rem] font-medium text-[#52525B]"
                                    >
                                      {copy.pendingTag}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-sm leading-[1.5]">{line.text}</p>
                                {pending && pendingNotice && (
                                  <p data-edit-sheet-pending-cut className="mt-1 text-xs leading-relaxed text-[#52525B]">
                                    {pendingNotice}
                                  </p>
                                )}
                              </div>
                              {canRevert && (
                                <button
                                  type="button"
                                  data-edit-sheet-revert={index}
                                  aria-label={interpolate(copy.revertLabel, { item })}
                                  disabled={disabled}
                                  onClick={() => onRevert?.(index)}
                                  className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-2.5 text-xs font-medium text-[#52525B] underline underline-offset-4 transition-colors hover:text-[#09090B] disabled:opacity-40 ${FOCUS_RING}`}
                                >
                                  {copy.revert}
                                </button>
                              )}
                              {removeButton('change', index, item, pending)}
                            </li>
                          );
                        })
                      : sheet[block].map((text, index) => (
                          <li
                            key={`${block}-${index}`}
                            data-edit-sheet-line={`${block}-${index}`}
                            className="flex items-center gap-1 border-t border-[#F4F4F5] first:border-t-0"
                          >
                            <p className="min-w-0 flex-1 py-1.5 text-sm leading-[1.5]">{text}</p>
                            {removeButton(block, index, text, false)}
                          </li>
                        ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {question && (
        <div data-edit-sheet-question className="mt-2.5 rounded-[14px] bg-[#F4F4F5] p-3">
          <p className="text-xs font-medium text-[#52525B]">{copy.questionLabel}</p>
          <p className="mt-1 text-sm leading-[1.5]">{question.text}</p>
          {options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {options.map((option, index) => (
                <button
                  key={`${index}-${option}`}
                  type="button"
                  data-edit-sheet-option={index}
                  disabled={disabled}
                  onClick={() => onAnswer?.(option)}
                  className={`inline-flex min-h-11 items-center rounded-full border border-[#E4E4E7] bg-white px-4 text-xs font-medium text-[#09090B] transition-colors hover:border-[#09090B] disabled:opacity-40 ${FOCUS_RING}`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-[#71717A]">{copy.questionOptional}</p>
        </div>
      )}

      <div role="status" aria-live="polite" data-edit-sheet-status="">
        {notice && (
          <div data-edit-sheet-notice className="mt-2 rounded-xl bg-[#F4F4F5] px-3 py-2 text-xs leading-relaxed">
            <p>{notice}</p>
            {noticeDetail && (
              <p data-edit-sheet-adjustment className="mt-0.5 text-[#52525B]">
                {noticeDetail}
              </p>
            )}
          </div>
        )}
        {foldNotice && (
          <p data-edit-sheet-full className="mt-2 text-xs leading-relaxed text-[#52525B]">
            {foldNotice}
          </p>
        )}
      </div>
    </section>
  );
}
