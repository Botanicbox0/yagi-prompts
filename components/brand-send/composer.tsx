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
import type { Fail } from '@/components/brand-rooms/chat/transport';
import type { SendPerson } from '@/lib/brand-rooms/send-contracts';
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
  requestId: string;
}

export interface SendComposerProps {
  copy: SendCopy;
  placeholder: string;
  hint: string;
  onSend: (draft: SendComposerSubmit) => Promise<{ ok: true } | Fail>;
  loadPeople?: () => Promise<{ ok: true; people: SendPerson[] } | Fail>;
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
  const [trigger, setTrigger] = useState<MentionTrigger | null>(() =>
    initialPickerOpen ? parseMentionTrigger(initialText, initialText.length, initialPeople) : null,
  );
  const [people, setPeople] = useState<SendPerson[]>(() => (initialPeople ? [...initialPeople] : []));
  const [peopleLoaded, setPeopleLoaded] = useState<boolean>(() => Boolean(initialPeople));
  const [activeIndex, setActiveIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  const trackedRef = useRef<TrackedMention[]>(tracked);
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

  const triggerRef = useRef<MentionTrigger | null>(trigger);
  useEffect(() => {
    triggerRef.current = trigger;
  }, [trigger]);

  const triggerKey = (t: MentionTrigger) => `${t.start}:${t.query}`;

  const syncTrigger = useCallback(
    (nextText: string, caret: number) => {
      const nextTrigger = parseMentionTrigger(nextText, caret, peopleRef.current);
      if (!nextTrigger) {
        dismissedKeyRef.current = null;
        triggerRef.current = null;
        setTrigger(null);
        return;
      }
      if (dismissedKeyRef.current === triggerKey(nextTrigger)) {
        triggerRef.current = null;
        setTrigger(null);
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
    },
    [ensurePeopleLoaded],
  );

  const filteredPeople = useMemo(() => {
    if (!trigger) return [];
    return filterMentionPeople(people, trigger.query);
  }, [people, trigger]);

  const safeIndex = filteredPeople.length > 0 ? Math.min(activeIndex, filteredPeople.length - 1) : 0;
  const counter = bodyCountNearLimit(text);
  const hasContent = text.trim().length > 0;
  const noMentionYet = showNoMentionHint && hasContent && extractMentionIds(text, tracked).length === 0;
  const overLimit = counter?.over ?? false;
  const canSubmit = !disabled && !sending && hasContent && !overLimit;

  const pickPerson = useCallback(
    (person: SendPerson) => {
      if (!trigger) return;
      const picked = applyMentionPick(textRef.current, trigger, person, trackedRef.current);
      textRef.current = picked.text;
      trackedRef.current = picked.tracked;
      dismissedKeyRef.current = null;
      setText(picked.text);
      setTracked(picked.tracked);
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
    [trigger],
  );

  const submit = useCallback(async () => {
    if (sendingRef.current || disabled || submitDisabled) return;
    const rawBody = textRef.current;
    if (rawBody.trim().length === 0) return;
    const countCheck = bodyCountNearLimit(rawBody);
    if (countCheck?.over) return;

    sendingRef.current = true;
    setSending(true);
    setError(null);

    const mentions = extractMentionIds(rawBody, trackedRef.current);
    const { plan, requestId } = resolveRequestId(requestPlanRef.current, rawBody, mentions);
    requestPlanRef.current = plan;

    try {
      const result = await onSend({ body: rawBody, mentions, requestId });
      if (!mountedRef.current) return;
      if (result.ok) {
        requestPlanRef.current = EMPTY_REQUEST_ID_PLAN;
        setError(null);
        const next = remainingDraftAfterSend(textRef.current, rawBody, trackedRef.current);
        textRef.current = next.text;
        trackedRef.current = next.tracked;
        dismissedKeyRef.current = null;
        setText(next.text);
        setTracked(next.tracked);
        setTrigger(null);
        setActiveIndex(0);
        if (textareaRef.current) {
          textareaRef.current.value = next.text;
          textareaRef.current.focus?.();
        }
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
      if (!outcome.keepText && textRef.current === rawBody) {
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
  }, [copy, disabled, hideNotFoundError, onClosed, onSend, refusalContext, submitDisabled]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = e.currentTarget.value;
    const prevText = textRef.current;
    const nextTracked = reconcileMentions(prevText, nextText, trackedRef.current);
    textRef.current = nextText;
    trackedRef.current = nextTracked;
    setText(nextText);
    setTracked(nextTracked);
    setError(null);

    if (composingRef.current) {
      return;
    }
    const caret = typeof e.currentTarget.selectionStart === 'number' ? e.currentTarget.selectionStart : nextText.length;
    syncTrigger(nextText, caret);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onCompStart = () => {
      composingRef.current = true;
    };
    const onCompEnd = () => {
      composingRef.current = false;
      const nextText = typeof el.value === 'string' ? el.value : textRef.current;
      const nextTracked = reconcileMentions(textRef.current, nextText, trackedRef.current);
      textRef.current = nextText;
      trackedRef.current = nextTracked;
      setText(nextText);
      setTracked(nextTracked);
      const caret = typeof el.selectionStart === 'number' ? el.selectionStart : nextText.length;
      syncTrigger(nextText, caret);
    };
    el.addEventListener('compositionstart', onCompStart);
    el.addEventListener('compositionend', onCompEnd);
    return () => {
      el.removeEventListener('compositionstart', onCompStart);
      el.removeEventListener('compositionend', onCompEnd);
    };
  }, [syncTrigger]);

  const handleCaretMove = () => {
    if (composingRef.current) return;
    const el = textareaRef.current;
    if (!el) return;
    const val = typeof el.value === 'string' ? el.value : textRef.current;
    const caret = typeof el.selectionStart === 'number' ? el.selectionStart : val.length;
    syncTrigger(val, caret);
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
      if (e.key === 'ArrowDown' && filteredPeople.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filteredPeople.length);
        return;
      }
      if (e.key === 'ArrowUp' && filteredPeople.length > 0) {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filteredPeople.length) % filteredPeople.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && filteredPeople.length > 0) {
        e.preventDefault();
        const chosen = filteredPeople[safeIndex];
        if (chosen) pickPerson(chosen);
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
    trigger && filteredPeople[safeIndex] ? `${listboxId}-${filteredPeople[safeIndex].id}` : undefined;

  return (
    <div ref={wrapRef} className={styles.wrap} onBlur={handleBlur} data-send-composer>
      {trigger ? (
        <div className={styles.picker} data-send-picker>
          <div className={styles.pickerHeading}>{copy.peopleHeading}</div>
          <div id={listboxId} role="listbox" aria-label={copy.peopleHeading}>
            {filteredPeople.length > 0 ? (
              filteredPeople.map((person, index) => (
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
                  <span className={styles.personRole}>{copy.roles[person.role]}</span>
                </div>
              ))
            ) : (
              <div className={styles.pickerEmpty}>
                {peopleLoaded || initialPeople || !loadPeople ? copy.peopleEmpty : copy.loading}
              </div>
            )}
          </div>
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
          aria-expanded={Boolean(trigger)}
          aria-controls={trigger ? listboxId : undefined}
          aria-activedescendant={activeDescendant}
          rows={compact ? 2 : 3}
          onChange={handleChange}
          onKeyUp={handleKeyUp}
          onClick={handleCaretMove}
          onKeyDown={handleKeyDown}
        />

        <div className={styles.bar}>
          <div className={styles.hints}>
            {noMentionYet ? (
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
