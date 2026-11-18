'use client';

/**
 * The "말로 편집" panel on the right of the editing studio (docs/BRAND-EDITING-STUDIO.md §4.1, §4.6).
 * Every word comes from the dictionary (`copy.assist`, plus the chat panel's rate-limit, undo and
 * read-only sentences); change lines come from the timeline diff, never from a model.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ComposerProject } from '@/lib/brand-studio/compose';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import type { StudioComposeCopy } from '@/messages/studio-compose';
import type { AssistEntry } from './assist-model';
import { askChoiceText, askQuestion, deltaText, noteText } from './delta-lines';
import type { AssistPanelModel } from './use-edit-assist';
import st from './assist.module.css';

export interface AssistPanelProps {
  assist: AssistPanelModel;
  copy: StudioComposeCopy;
  canCreate: boolean;
  /** The real timeline: answer chips name cuts by their position in it. */
  project: ComposerProject;
}

function Lines({ deltas, copy }: { deltas: readonly EditDelta[]; copy: StudioComposeCopy }) {
  return (
    <ul className={st.lines}>
      {deltas.map((delta, i) => (
        <li key={`${delta.kind}-${i}`} data-kind={delta.kind}>
          {deltaText(delta, copy)}
        </li>
      ))}
    </ul>
  );
}

/** Shows the original timeline only while held: pointer, or Space / Enter held down. */
function CompareButton({ label, pressed, onHold }: { label: string; pressed: boolean; onHold: (on: boolean) => void }) {
  const isHoldKey = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Enter';
  return (
    <button
      type="button"
      className={`${st.ghost} ${st.compare}`}
      aria-pressed={pressed}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      onPointerLeave={() => onHold(false)}
      onKeyDown={(event) => {
        if (!isHoldKey(event)) return;
        event.preventDefault();
        if (!event.repeat) onHold(true);
      }}
      onKeyUp={(event) => {
        if (!isHoldKey(event)) return;
        event.preventDefault();
        onHold(false);
      }}
      onBlur={() => onHold(false)}
      onContextMenu={(event) => event.preventDefault()}
      data-assist-compare
    >
      {label}
    </button>
  );
}

/** The slim bar above the timeline while a proposal is previewed. */
export function AssistPreviewBar({ text }: { text: string }) {
  return (
    <div className={st.previewBar} role="status" data-assist-preview-bar>
      {text}
    </div>
  );
}

/**
 * The entry that takes keyboard focus when it appears: the newest entry, when it is an open proposal or
 * an open question. Tab from there reaches its buttons (Apply first) before anything else.
 */
export function focusEntryId(entries: readonly AssistEntry[]): string | null {
  const last = entries[entries.length - 1];
  if (!last) return null;
  if ((last.type === 'proposal' || last.type === 'ask') && last.status === 'open') return last.id;
  return null;
}

export function AssistPanel({ assist, copy, canCreate, project }: AssistPanelProps) {
  const a = copy.assist;
  const p = a.proposal;
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const focusCardRef = useRef<HTMLDivElement | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  const { entries, busy } = assist;
  const focusId = focusEntryId(entries);

  // The log always shows its newest entry.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [entries, busy]);

  // A new proposal or question takes focus (the card, not its Apply button: a second Enter must not
  // apply), so Tab reaches its buttons right away. Each one is focused once, when it appears.
  useEffect(() => {
    if (!focusId || focusedIdRef.current === focusId) return;
    focusedIdRef.current = focusId;
    focusCardRef.current?.focus({ preventScroll: true });
  }, [focusId]);

  const submit = () => {
    if (!canCreate || busy || !text.trim()) return;
    assist.send(text);
    setText('');
  };

  const focusInput = () => inputRef.current?.focus();

  /** The open proposal / question card that takes focus: a labelled group, focusable by script only. */
  const focusTargetProps = (entryId: string, label: string) =>
    entryId === focusId
      ? ({ ref: focusCardRef, tabIndex: -1, role: 'group', 'aria-label': label, 'data-assist-focus': true } as const)
      : {};

  const undoControl = (entry: AssistEntry) => {
    const history = assist.historyOf(entry);
    if (history === 'undone') return <span className={st.status}>{p.undone}</span>;
    return (
      <button
        type="button"
        className={st.ghost}
        disabled={!assist.canUndo(entry)}
        onClick={() => assist.undoEntry(entry.id)}
        data-assist-undo
      >
        {p.undo}
      </button>
    );
  };

  const renderEntry = (entry: AssistEntry): ReactNode => {
    switch (entry.type) {
      case 'user':
        return (
          <div key={entry.id} className={st.user} data-assist-entry="user">
            {entry.text}
          </div>
        );
      case 'applied':
        return (
          <div key={entry.id} className={st.card} data-assist-entry="applied" data-state={assist.historyOf(entry) ?? undefined}>
            <Lines deltas={entry.deltas} copy={copy} />
            <div className={st.actions}>{undoControl(entry)}</div>
          </div>
        );
      case 'proposal': {
        if (entry.status === 'stale') {
          return (
            <p key={entry.id} className={st.note} data-assist-entry="proposal" data-assist-proposal data-status="stale">
              {noteText('stale', copy)}
            </p>
          );
        }
        const open = entry.status === 'open';
        return (
          <div
            key={entry.id}
            className={st.card}
            {...focusTargetProps(entry.id, p.title)}
            data-assist-entry="proposal"
            data-assist-proposal
            data-status={entry.status}
            data-state={assist.historyOf(entry) ?? undefined}
          >
            <p className={open ? st.cardTitle : st.status}>
              {open ? p.title : entry.status === 'applied' ? p.applied : p.dismissed}
            </p>
            <Lines deltas={entry.deltas} copy={copy} />
            {open ? (
              <div className={st.actions}>
                <button
                  type="button"
                  className={st.apply}
                  onClick={() => {
                    assist.applyProposal();
                    focusInput();
                  }}
                  data-assist-apply
                >
                  {p.apply}
                </button>
                <button
                  type="button"
                  className={st.ghost}
                  onClick={() => {
                    assist.dismissProposal();
                    focusInput();
                  }}
                  data-assist-dismiss
                >
                  {p.dismiss}
                </button>
                <CompareButton label={p.compare} pressed={assist.comparing} onHold={assist.setComparing} />
              </div>
            ) : entry.status === 'applied' ? (
              <div className={st.actions}>{undoControl(entry)}</div>
            ) : null}
          </div>
        );
      }
      case 'ask': {
        const question = askQuestion(entry.about, copy);
        return (
          <div
            key={entry.id}
            className={st.card}
            {...focusTargetProps(entry.id, question)}
            data-assist-entry="ask"
            data-status={entry.status}
          >
            <p className={st.cardTitle}>{question}</p>
            <div className={st.actions}>
              {entry.choices.map((choice, i) => {
                const label = askChoiceText(choice, project, copy);
                if (label === null) return null;
                return (
                  <button
                    key={`${entry.id}-${i}`}
                    type="button"
                    className={st.choice}
                    aria-pressed={entry.picked === i}
                    disabled={entry.status !== 'open' || busy || !canCreate}
                    onClick={() => {
                      assist.answer(entry.id, i);
                      // The chip goes inactive once answered; keep the keyboard in the panel.
                      focusInput();
                    }}
                    data-assist-choice={i}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      case 'note':
        return (
          <p key={entry.id} className={st.note} data-assist-entry="note" data-code={entry.code}>
            {noteText(entry.code, copy, entry.seconds)}
          </p>
        );
    }
  };

  const examples = [a.examples.trim, a.examples.fit, a.examples.caption] as const;

  return (
    // No product name on screen (docs/BRAND-EDITING-STUDIO.md §8-1): the input's own label names the region.
    <aside className={st.panel} aria-label={a.inputLabel} data-assist-panel>
      <div
        ref={logRef}
        className={st.log}
        role="log"
        aria-live="polite"
        aria-label={a.inputLabel}
        data-assist-log
        data-empty={entries.length === 0 || undefined}
      >
        {entries.length === 0 ? <p className={st.hint}>{a.emptyHint}</p> : entries.map(renderEntry)}
        {busy ? (
          <p className={st.pending} data-assist-pending>
            {a.busy}
          </p>
        ) : null}
      </div>

      {entries.length === 0 && canCreate ? (
        <div className={st.examples}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className={st.example}
              onClick={() => {
                setText(example);
                focusInput();
              }}
              data-assist-example
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className={st.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          className={st.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter is a new line; never while a Korean syllable is still being composed.
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          placeholder={a.placeholder}
          aria-label={a.inputLabel}
          rows={2}
          maxLength={500}
          disabled={!canCreate}
          data-assist-input
        />
        <button type="submit" className={st.send} disabled={!canCreate || busy || !text.trim()} data-assist-send>
          {a.send}
        </button>
      </form>

      <p className={st.foot} data-assist-policy>
        {canCreate ? a.costNote : copy.chat.readOnly}
      </p>
    </aside>
  );
}
