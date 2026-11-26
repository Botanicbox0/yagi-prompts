'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import type { Fail, SendInviteFail } from '@/components/brand-rooms/chat/transport';
import type { SendLookup, SendPerson } from '@/lib/brand-rooms/send-contracts';
import {
  activeInviteLookupView,
  applyInvitePick,
  conflictingInviteEmails,
  extractInviteEmails,
  formatInviteRemoveLabel,
  initialInviteLookupState,
  inviteLookupReduce,
  inviteRefusalOutcome,
  parseCompleteInviteEmail,
  parseInviteTrigger,
  reconcileInvites,
  remainingInviteDraftAfterSend,
  removeTrackedInvite,
  resolveInviteRequestId,
  stripTrackedInvitesFromBody,
  type InviteLookupAction,
  type InviteLookupCommand,
  type InviteLookupEntry,
  type InviteLookupState,
  type TrackedInvite,
} from './invite-model';
import { SendInviteRow } from './invite-row';
import {
  EMPTY_REQUEST_ID_PLAN,
  applyMentionPick,
  bodyCountNearLimit,
  extractMentionIds,
  filterMentionPeople,
  initialChar,
  isComposingKeyEvent,
  parseMentionTrigger,
  reconcileMentions,
  refusalMessageText,
  remainingDraftAfterSend,
  resolveRequestId,
  sendRefusalOutcome,
  type MentionTrigger,
  type RequestIdPlan,
  type SendCopy,
  type SendRefusalContext,
  type TrackedMention,
} from './model';
import styles from './composer.module.css';

export interface SendComposerSubmit {
  body: string;
  mentions: string[];
  invites?: string[];
  requestId: string;
}

export interface SendComposerProps {
  copy: SendCopy;
  placeholder: string;
  hint: string;
  onSend: (draft: SendComposerSubmit) => Promise<{ ok: true } | SendInviteFail>;
  loadPeople?: () => Promise<{ ok: true; people: SendPerson[] } | Fail>;
  invite?: boolean;
  lookupAddress?: (email: string) => Promise<SendLookup | SendInviteFail>;
  initialLookup?: InviteLookupEntry | null;
  showNoMentionHint?: boolean;
  refusalContext?: SendRefusalContext;
  disabled?: boolean;
  submitDisabled?: boolean;
  hideNotFoundError?: boolean;
  autoFocus?: boolean;
  initialText?: string;
  initialPickerOpen?: boolean;
  initialPeople?: readonly SendPerson[];
  compact?: boolean;
  onClosed?: () => void;
  ariaLabel?: string;
}

export function SendComposer({
  copy,
  placeholder,
  hint,
  onSend,
  loadPeople,
  invite = false,
  lookupAddress,
  initialLookup = null,
  showNoMentionHint = false,
  refusalContext = 'compose_post',
  disabled = false,
  submitDisabled = false,
  hideNotFoundError = false,
  autoFocus = false,
  initialText = '',
  initialPickerOpen = false,
  initialPeople,
  compact = false,
  onClosed,
  ariaLabel,
}: SendComposerProps) {
  const [text, setText] = useState(initialText);
  const [tracked, setTracked] = useState<TrackedMention[]>([]);
  const [trackedInvites, setTrackedInvites] = useState<TrackedInvite[]>([]);
  const [refusedEmails, setRefusedEmails] = useState<string[]>([]);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(() =>
    initialPickerOpen
      ? (invite ? parseInviteTrigger(initialText, initialText.length, initialPeople) : parseMentionTrigger(initialText, initialText.length, initialPeople))
      : null,
  );
  const [people, setPeople] = useState<SendPerson[]>(() => (initialPeople ? [...initialPeople] : []));
  const [peopleLoaded, setPeopleLoaded] = useState<boolean>(() => Boolean(initialPeople));
  const [lookupState, setLookupState] = useState<InviteLookupState>(() => initialInviteLookupState(initialLookup));
  const [activeIndex, setActiveIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  const trackedRef = useRef<TrackedMention[]>(tracked);
  const trackedInvitesRef = useRef<TrackedInvite[]>(trackedInvites);
  const lookupStateRef = useRef<InviteLookupState>(lookupState);
  lookupStateRef.current = lookupState;
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupAddressRef = useRef(lookupAddress);
  lookupAddressRef.current = lookupAddress;
  const peopleRef = useRef<SendPerson[]>(people);
  peopleRef.current = people;
  const composingRef = useRef(false);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const dismissedKeyRef = useRef<string | null>(null);
  const requestPlanRef = useRef<RequestIdPlan>(EMPTY_REQUEST_ID_PLAN);
  const peopleLoadStatusRef = useRef<'idle' | 'loading' | 'ready'>(initialPeople ? 'ready' : 'idle');

  const listboxId = useId();
  const hintId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (lookupTimerRef.current !== null) {
        clearTimeout(lookupTimerRef.current);
        lookupTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  const ensurePeopleLoaded = useCallback(() => {
    if (!loadPeople || peopleLoadStatusRef.current !== 'idle') return;
    peopleLoadStatusRef.current = 'loading';
    void loadPeople()
      .then((res) => {
        if (!mountedRef.current) return;
        if (res.ok) {
          peopleLoadStatusRef.current = 'ready';
          const nextPeople = [...res.people];
          peopleRef.current = nextPeople;
          setPeople(nextPeople);
          setPeopleLoaded(true);
          return;
        }
        peopleLoadStatusRef.current = 'idle';
        setPeopleLoaded(true);
      })
      .catch(() => {
        peopleLoadStatusRef.current = 'idle';
      });
  }, [loadPeople]);

  const clearLookupTimer = useCallback(() => {
    if (lookupTimerRef.current !== null) {
      clearTimeout(lookupTimerRef.current);
      lookupTimerRef.current = null;
    }
  }, []);

  const runLookupCommandRef = useRef<(cmd: InviteLookupCommand) => void>(() => {});
  const dispatchLookup = useCallback((action: InviteLookupAction) => {
    const { state: next, command } = inviteLookupReduce(lookupStateRef.current, action);
    lookupStateRef.current = next;
    setLookupState(next);
    if (command) {
      runLookupCommandRef.current(command);
    }
  }, []);

  runLookupCommandRef.current = (cmd: InviteLookupCommand) => {
    if (cmd.type === 'cancel_debounce') {
      clearLookupTimer();
      return;
    }
    if (cmd.type === 'debounce') {
      clearLookupTimer();
      if (!invite || !lookupAddressRef.current || composingRef.current) return;
      lookupTimerRef.current = setTimeout(() => {
        lookupTimerRef.current = null;
        if (composingRef.current) return;
        dispatchLookup({ type: 'debounce_fire', seq: cmd.seq, email: cmd.email });
      }, cmd.delayMs);
      return;
    }
    if (!invite || !lookupAddressRef.current) return;
    void lookupAddressRef
      .current(cmd.email)
      .then((res) => {
        if (!mountedRef.current) return;
        dispatchLookup({ type: 'answer', seq: cmd.seq, email: cmd.email, result: res });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        dispatchLookup({ type: 'answer', seq: cmd.seq, email: cmd.email, result: { ok: false, code: 'offline' } });
      });
  };

  const triggerRef = useRef<MentionTrigger | null>(trigger);
  useEffect(() => {
    triggerRef.current = trigger;
  }, [trigger]);

  const triggerKey = (t: MentionTrigger) => `${t.start}:${t.query}`;

  const syncTrigger = useCallback(
    (nextText: string, caret: number, textChanged = false) => {
      if (composingRef.current) return;
      const nextTrigger = invite
        ? parseInviteTrigger(nextText, caret, peopleRef.current)
        : parseMentionTrigger(nextText, caret, peopleRef.current);
      if (!nextTrigger) {
        dismissedKeyRef.current = null;
        triggerRef.current = null;
        setTrigger(null);
        if (invite) {
          dispatchLookup({ type: 'target', email: null, textChanged });
        }
        return;
      }
      if (dismissedKeyRef.current === triggerKey(nextTrigger)) {
        triggerRef.current = null;
        setTrigger(null);
        if (invite) {
          dispatchLookup({ type: 'target', email: null, textChanged });
        }
        return;
      }
      dismissedKeyRef.current = null;
      const prev = triggerRef.current;
      const queryChanged = !prev || prev.start !== nextTrigger.start || prev.query !== nextTrigger.query;
      triggerRef.current = nextTrigger;
      setTrigger(nextTrigger);
      if (queryChanged) {
        setActiveIndex(0);
      }
      ensurePeopleLoaded();
      if (invite) {
        const emailTarget = parseCompleteInviteEmail(nextTrigger.query);
        dispatchLookup({ type: 'target', email: emailTarget, textChanged });
      }
    },
    [dispatchLookup, ensurePeopleLoaded, invite],
  );

  const filteredPeople = useMemo(() => {
    if (!trigger) return [];
    return filterMentionPeople(people, trigger.query);
  }, [people, trigger]);

  const peopleReady = peopleLoaded || Boolean(initialPeople) || !loadPeople;
  const lookupView = useMemo(() => {
    if (!invite || !trigger) return { kind: 'none' } as const;
    return activeInviteLookupView(lookupState, people, peopleReady);
  }, [invite, lookupState, people, peopleReady, trigger]);

  const pickerMembers = useMemo(() => {
    if (!invite || lookupView.kind !== 'member') return filteredPeople;
    const looked = lookupView.person;
    if (filteredPeople.some((p) => p.id.toLowerCase() === looked.id.toLowerCase())) {
      return filteredPeople;
    }
    return [
      ...filteredPeople,
      {
        id: looked.id,
        name: looked.name,
        role: looked.role ?? ('viewer' as const),
        me: false,
        lookupOnlyRole: looked.role === null,
      },
    ];
  }, [filteredPeople, invite, lookupView]);

  const hasInviteOption = Boolean(invite && lookupView.kind === 'invitable');
  const totalOptions = pickerMembers.length + (hasInviteOption ? 1 : 0);
  const safeIndex = totalOptions > 0 ? Math.min(activeIndex, totalOptions - 1) : 0;
  const activeInvites = useMemo(
    () => (invite ? extractInviteEmails(text, trackedInvites) : []),
    [invite, text, trackedInvites],
  );
  const effectiveBody = invite && activeInvites.length > 0 ? stripTrackedInvitesFromBody(text, trackedInvites) : text;
  const tokenConflicts = useMemo(
    () => (invite && activeInvites.length > 0 ? conflictingInviteEmails(effectiveBody, activeInvites) : []),
    [activeInvites, effectiveBody, invite],
  );
  const displayedRefused = useMemo(
    () => (tokenConflicts.length === 0 ? refusedEmails : [...new Set([...refusedEmails, ...tokenConflicts])]),
    [refusedEmails, tokenConflicts],
  );
  const counter = bodyCountNearLimit(text);
  const hasContent = effectiveBody.trim().length > 0;
  const inviteNeedsWords = Boolean(invite && activeInvites.length > 0 && !hasContent);
  const noMentionYet =
    showNoMentionHint && hasContent && extractMentionIds(text, tracked).length === 0 && activeInvites.length === 0;
  const overLimit = counter?.over ?? false;
  const canSubmit = !disabled && !sending && hasContent && !overLimit && tokenConflicts.length === 0;

  const pickPerson = useCallback(
    (person: Pick<SendPerson, 'id' | 'name'>) => {
      if (!trigger) return;
      const prevText = textRef.current;
      const picked = applyMentionPick(prevText, trigger, person, trackedRef.current);
      const nextInvites = invite ? reconcileInvites(prevText, picked.text, trackedInvitesRef.current) : trackedInvitesRef.current;
      textRef.current = picked.text;
      trackedRef.current = picked.tracked;
      trackedInvitesRef.current = nextInvites;
      dismissedKeyRef.current = null;
      setText(picked.text);
      setTracked(picked.tracked);
      if (invite) {
        setTrackedInvites(nextInvites);
        dispatchLookup({ type: 'target', email: null, textChanged: true });
      }
      setTrigger(null);
      setActiveIndex(0);
      setError(null);
      const el = textareaRef.current;
      if (el) {
        el.value = picked.text;
        el.focus?.();
        el.setSelectionRange?.(picked.caret, picked.caret);
      }
    },
    [dispatchLookup, invite, trigger],
  );

  const pickInvite = useCallback(
    (email: string) => {
      if (!invite || !trigger) return;
      const picked = applyInvitePick(textRef.current, trigger, email, trackedRef.current, trackedInvitesRef.current);
      if (!picked.ok) {
        if (picked.reason === 'too_many') {
          setError(copy.inviteTooMany);
        }
        return;
      }
      textRef.current = picked.text;
      trackedRef.current = picked.trackedMentions;
      trackedInvitesRef.current = picked.trackedInvites;
      dismissedKeyRef.current = null;
      setText(picked.text);
      setTracked(picked.trackedMentions);
      setTrackedInvites(picked.trackedInvites);
      setRefusedEmails((prev) => prev.filter((item) => item !== picked.email));
      dispatchLookup({ type: 'target', email: null, textChanged: true });
      setTrigger(null);
      setActiveIndex(0);
      setError(null);
      const el = textareaRef.current;
      if (el) {
        el.value = picked.text;
        el.focus?.();
        el.setSelectionRange?.(picked.caret, picked.caret);
      }
    },
    [copy.inviteTooMany, dispatchLookup, invite, trigger],
  );

  const removeInviteChip = useCallback(
    (email: string) => {
      if (!invite) return;
      const removed = removeTrackedInvite(textRef.current, email, trackedRef.current, trackedInvitesRef.current);
      textRef.current = removed.text;
      trackedRef.current = removed.trackedMentions;
      trackedInvitesRef.current = removed.trackedInvites;
      setText(removed.text);
      setTracked(removed.trackedMentions);
      setTrackedInvites(removed.trackedInvites);
      setRefusedEmails((prev) => prev.filter((item) => item !== email.toLowerCase()));
      setError(null);
      if (textareaRef.current) {
        textareaRef.current.value = removed.text;
        textareaRef.current.focus?.();
      }
    },
    [invite],
  );

  const submit = useCallback(async () => {
    if (sendingRef.current || disabled || submitDisabled) return;
    const rawText = textRef.current;
    const invites = invite ? extractInviteEmails(rawText, trackedInvitesRef.current) : [];
    const wireBody = invite && invites.length > 0 ? stripTrackedInvitesFromBody(rawText, trackedInvitesRef.current) : rawText;
    if (wireBody.trim().length === 0) return;
    if (invite && invites.length > 0 && conflictingInviteEmails(wireBody, invites).length > 0) return;
    const countCheck = bodyCountNearLimit(wireBody);
    if (countCheck?.over) return;

    sendingRef.current = true;
    setSending(true);
    setError(null);

    const mentions = extractMentionIds(rawText, trackedRef.current);
    const { plan, requestId } =
      invite && invites.length > 0
        ? resolveInviteRequestId(requestPlanRef.current, wireBody, mentions, invites)
        : resolveRequestId(requestPlanRef.current, wireBody, mentions);
    requestPlanRef.current = plan;

    try {
      const result = await onSend(
        invite && invites.length > 0
          ? { body: wireBody, mentions, invites, requestId }
          : { body: wireBody, mentions, requestId },
      );
      if (!mountedRef.current) return;
      if (result.ok) {
        requestPlanRef.current = EMPTY_REQUEST_ID_PLAN;
        setError(null);
        setRefusedEmails([]);
        const inviteNext = invite
          ? remainingInviteDraftAfterSend(textRef.current, rawText, trackedRef.current, trackedInvitesRef.current)
          : null;
        const baseNext = inviteNext ? null : remainingDraftAfterSend(textRef.current, rawText, trackedRef.current);
        const nextText = inviteNext ? inviteNext.text : baseNext!.text;
        const nextMentions = inviteNext ? inviteNext.trackedMentions : baseNext!.tracked;
        const nextInvites = inviteNext ? inviteNext.trackedInvites : [];
        textRef.current = nextText;
        trackedRef.current = nextMentions;
        trackedInvitesRef.current = nextInvites;
        dismissedKeyRef.current = null;
        setText(nextText);
        setTracked(nextMentions);
        if (invite) {
          setTrackedInvites(nextInvites);
          dispatchLookup({ type: 'target', email: null, textChanged: true });
        }
        setTrigger(null);
        setActiveIndex(0);
        if (textareaRef.current) {
          textareaRef.current.value = nextText;
          textareaRef.current.focus?.();
        }
        return;
      }

      if (invite) {
        const outcome = inviteRefusalOutcome(
          result.code,
          result.refused,
          refusalContext,
          copy,
          invites.length > 0,
        );
        if (outcome.resetRequestId) {
          requestPlanRef.current = EMPTY_REQUEST_ID_PLAN;
        }
        if (outcome.hideSend) {
          setTrigger(null);
          onClosed?.();
          return;
        }
        if (!outcome.keepText && textRef.current === rawText) {
          textRef.current = '';
          trackedRef.current = [];
          trackedInvitesRef.current = [];
          setText('');
          setTracked([]);
          setTrackedInvites([]);
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
        }
        if (result.code === 'not_found' && hideNotFoundError) {
          return;
        }
        if (outcome.refusedEmails.length > 0) {
          setRefusedEmails(outcome.refusedEmails);
        }
        setError(outcome.errorText);
        return;
      }

      const outcome = sendRefusalOutcome(result.code, refusalContext);
      if (outcome.resetRequestId) {
        requestPlanRef.current = EMPTY_REQUEST_ID_PLAN;
      }
      if (outcome.hideSend) {
        setTrigger(null);
        onClosed?.();
        return;
      }
      if (!outcome.keepText && textRef.current === rawText) {
        textRef.current = '';
        trackedRef.current = [];
        setText('');
        setTracked([]);
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
      }
      if (result.code === 'not_found' && hideNotFoundError) {
        return;
      }
      setError(refusalMessageText(outcome, copy));
    } catch {
      if (!mountedRef.current) return;
      setError(copy.sendFailed);
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) {
        setSending(false);
      }
    }
  }, [copy, disabled, dispatchLookup, hideNotFoundError, invite, onClosed, onSend, refusalContext, submitDisabled]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = e.currentTarget.value;
    const prevText = textRef.current;
    const nextTracked = reconcileMentions(prevText, nextText, trackedRef.current);
    textRef.current = nextText;
    trackedRef.current = nextTracked;
    setText(nextText);
    setTracked(nextTracked);
    if (invite) {
      const nextInvites = reconcileInvites(prevText, nextText, trackedInvitesRef.current);
      trackedInvitesRef.current = nextInvites;
      setTrackedInvites(nextInvites);
      if (refusedEmails.length > 0) {
        const remainingEmails = new Set(extractInviteEmails(nextText, nextInvites));
        setRefusedEmails((prev) => prev.filter((item) => remainingEmails.has(item)));
      }
    }
    setError(null);

    const nativeComposing = Boolean((e.nativeEvent as { isComposing?: boolean } | undefined)?.isComposing);
    if (composingRef.current || nativeComposing) {
      if (nativeComposing && !composingRef.current) {
        composingRef.current = true;
        if (invite) {
          clearLookupTimer();
          dispatchLookup({ type: 'target', email: null, textChanged: false });
        }
      }
      return;
    }
    const caret = typeof e.currentTarget.selectionStart === 'number' ? e.currentTarget.selectionStart : nextText.length;
    syncTrigger(nextText, caret, true);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onCompStart = () => {
      composingRef.current = true;
      if (invite) {
        clearLookupTimer();
        dispatchLookup({ type: 'target', email: null, textChanged: false });
      }
    };
    const onCompEnd = () => {
      composingRef.current = false;
      const nextText = typeof el.value === 'string' ? el.value : textRef.current;
      const prevText = textRef.current;
      const nextTracked = reconcileMentions(prevText, nextText, trackedRef.current);
      textRef.current = nextText;
      trackedRef.current = nextTracked;
      setText(nextText);
      setTracked(nextTracked);
      if (invite) {
        const nextInvites = reconcileInvites(prevText, nextText, trackedInvitesRef.current);
        trackedInvitesRef.current = nextInvites;
        setTrackedInvites(nextInvites);
      }
      const caret = typeof el.selectionStart === 'number' ? el.selectionStart : nextText.length;
      syncTrigger(nextText, caret, true);
    };
    el.addEventListener('compositionstart', onCompStart);
    el.addEventListener('compositionend', onCompEnd);
    return () => {
      el.removeEventListener('compositionstart', onCompStart);
      el.removeEventListener('compositionend', onCompEnd);
    };
  }, [clearLookupTimer, dispatchLookup, invite, syncTrigger]);

  const handleCaretMove = () => {
    if (composingRef.current) return;
    const el = textareaRef.current;
    if (!el) return;
    const val = typeof el.value === 'string' ? el.value : textRef.current;
    const caret = typeof el.selectionStart === 'number' ? el.selectionStart : val.length;
    syncTrigger(val, caret, false);
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || isComposingKeyEvent(e)) {
      return;
    }
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'Shift' ||
      e.key === 'Control' ||
      e.key === 'Alt' ||
      e.key === 'Meta'
    ) {
      return;
    }
    handleCaretMove();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || isComposingKeyEvent(e)) {
      return;
    }

    if (trigger) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent?.stopPropagation?.();
        dismissedKeyRef.current = triggerKey(trigger);
        setTrigger(null);
        return;
      }
      if (e.key === 'Tab') {
        dismissedKeyRef.current = triggerKey(trigger);
        setTrigger(null);
        return;
      }
      if (e.key === 'ArrowDown' && totalOptions > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % totalOptions);
        return;
      }
      if (e.key === 'ArrowUp' && totalOptions > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + totalOptions) % totalOptions);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && totalOptions > 0) {
        e.preventDefault();
        if (safeIndex < pickerMembers.length) {
          const chosen = pickerMembers[safeIndex];
          if (chosen) pickPerson(chosen);
        } else if (hasInviteOption && lookupView.kind === 'invitable') {
          pickInvite(lookupView.email);
        }
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && wrapRef.current?.contains(next)) return;
    if (trigger) {
      dismissedKeyRef.current = triggerKey(trigger);
      setTrigger(null);
    }
  };

  const activeDescendant =
    trigger && totalOptions > 0
      ? safeIndex < pickerMembers.length && pickerMembers[safeIndex]
        ? `${listboxId}-${pickerMembers[safeIndex].id}`
        : hasInviteOption
          ? `${listboxId}-invite`
          : undefined
      : undefined;

  const suppressEmptyPeople = invite && pickerMembers.length === 0 && lookupView.kind !== 'none';
  const showListbox = Boolean(trigger && (!invite || !suppressEmptyPeople || totalOptions > 0));

  return (
    <div ref={wrapRef} className={styles.wrap} onBlur={handleBlur} data-send-composer>
      {trigger ? (
        <div className={styles.picker} data-send-picker>
          {!suppressEmptyPeople ? <div className={styles.pickerHeading}>{copy.peopleHeading}</div> : null}
          {showListbox ? (
            <div id={listboxId} role="listbox" aria-label={suppressEmptyPeople ? copy.inviteHeading : copy.peopleHeading}>
              {pickerMembers.length > 0 ? (
                pickerMembers.map((person, index) => (
                  <div
                    key={person.id}
                    id={`${listboxId}-${person.id}`}
                    role="option"
                    aria-selected={index === safeIndex}
                    className={styles.option}
                    onMouseDown={(event) => {
                      if (typeof event.button === 'number' && event.button !== 0) return;
                      event.preventDefault();
                      pickPerson(person);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {initialChar(person.name)}
                    </span>
                    <span className={styles.personName}>{person.name}</span>
                    {'lookupOnlyRole' in person && person.lookupOnlyRole ? null : (
                      <span className={styles.personRole}>{copy.roles[person.role]}</span>
                    )}
                  </div>
                ))
              ) : !suppressEmptyPeople ? (
                <div className={styles.pickerEmpty}>
                  {peopleLoaded || initialPeople || !loadPeople ? copy.peopleEmpty : copy.loading}
                </div>
              ) : null}
              {invite && lookupView.kind === 'invitable' ? (
                <SendInviteRow
                  mode="invitable"
                  email={lookupView.email}
                  optionId={`${listboxId}-invite`}
                  selected={hasInviteOption && safeIndex === pickerMembers.length}
                  copy={copy}
                  onHover={() => {
                    if (hasInviteOption) setActiveIndex(pickerMembers.length);
                  }}
                  onPick={pickInvite}
                />
              ) : null}
            </div>
          ) : null}
          {invite && lookupView.kind === 'loading' && pickerMembers.length === 0 ? (
            <div className={styles.pickerEmpty} role="status" data-send-invite-loading>
              {copy.loading}
            </div>
          ) : null}
          {invite &&
          (lookupView.kind === 'not_allowed' ||
            lookupView.kind === 'self' ||
            lookupView.kind === 'rate_limited') ? (
            <SendInviteRow mode={lookupView.kind} email={lookupView.email} copy={copy} />
          ) : null}
        </div>
      ) : null}

      <div className={styles.box} data-compact={compact ? 'true' : undefined}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          data-send-input
          role="combobox"
          aria-autocomplete="list"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel ?? copy.composerLabel}
          aria-describedby={hintId}
          aria-expanded={showListbox}
          aria-controls={showListbox ? listboxId : undefined}
          aria-activedescendant={activeDescendant}
          rows={compact ? 2 : 3}
          onChange={handleChange}
          onKeyUp={handleKeyUp}
          onClick={handleCaretMove}
          onKeyDown={handleKeyDown}
        />

        {invite && activeInvites.length > 0 ? (
          <div className={styles.inviteTray} data-send-invite-tray>
            {activeInvites.map((email) => {
              const isRefused = displayedRefused.includes(email);
              return (
                <span key={email} className={styles.inviteChipGroup}>
                  <span className={styles.inviteChip} data-send-invite-draft={email} data-refused={isRefused ? 'true' : undefined}>
                    <span className={styles.inviteChipAddr}>{`@${email}`}</span>
                    <button
                      type="button"
                      className={styles.inviteChipRemove}
                      data-send-invite-remove={email}
                      aria-label={formatInviteRemoveLabel(email, copy.inviteRemove)}
                      onClick={() => removeInviteChip(email)}
                    >
                      ×
                    </button>
                  </span>
                  {isRefused ? (
                    <span className={styles.inviteChipRefused} role="status" data-send-invite-refused={email}>
                      {copy.inviteRefused}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        ) : null}

        <div className={styles.bar}>
          <div className={styles.hints}>
            {inviteNeedsWords ? (
              <span id={hintId} className={styles.subNote} data-send-invite-needs-words>
                {copy.inviteNeedsWords}
              </span>
            ) : noMentionYet ? (
              <span id={hintId} className={styles.subNote}>
                {copy.sendNoMention}
              </span>
            ) : (
              <span id={hintId} className={styles.hint}>
                {hint}
              </span>
            )}
          </div>

          <div className={styles.controls}>
            {counter ? (
              <span className={styles.counter} data-over={counter.over ? 'true' : undefined}>
                {counter.count} / {counter.max}
              </span>
            ) : null}
            <button
              type="button"
              className={styles.sendBtn}
              data-send-submit
              disabled={!canSubmit || submitDisabled}
              onClick={() => void submit()}
            >
              {copy.action}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert" data-send-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
