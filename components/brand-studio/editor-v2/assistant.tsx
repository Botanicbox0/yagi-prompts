'use client';

import { useState } from 'react';
import type { EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import { EditorIcon } from './icons';
import type { EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

const EXAMPLES: Readonly<Record<EditorWorkspace, ReadonlyArray<keyof StudioEditorCopy['assist']['examples']>>> = {
  cut: ['cut1', 'cut2', 'cut3'],
  color: ['color1', 'color2'],
  sound: ['sound1', 'sound2', 'sound3'],
  captions: ['captions1', 'captions2'],
};

/**
 * "말로 편집" at hand in every workspace. A sentence becomes a proposal card (what will change, apply
 * or close); applying runs the same action a button would, so it lands in the same undo history.
 *
 * On a real film (V1) it follows only the cut sentences, shows only those examples and carries a
 * `예시` mark: the real assistant comes in V2 of the plan.
 */
export function Assistant({ api, placement }: { api: EditorApi; placement: 'bar' | 'side' }) {
  const { copy, proposal } = api;
  const a = copy.assist;
  const [text, setText] = useState('');
  const closed = api.readOnly || api.status !== 'ready';
  const exampleKeys = api.real ? EXAMPLES.cut : EXAMPLES[api.workspace];
  const submit = (value: string) => {
    const utterance = value.trim();
    if (!utterance || closed) return;
    api.propose(utterance);
    setText('');
  };
  const card = proposal && (
    <div className={styles.proposal} role="status" data-editor-proposal>
      <p className={styles.proposalSaid}>{proposal.utterance}</p>
      {proposal.run ? (
        <>
          <strong>{a.proposal}</strong>
          <ul>
            {proposal.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className={styles.quickRow}>
            <button
              type="button"
              className={styles.applyBtn}
              onClick={() => {
                proposal.run?.();
                api.setProposal({ ...proposal, lines: [], run: null, note: a.applied });
              }}
              data-editor-apply
            >
              <EditorIcon name="check" />
              {a.apply}
            </button>
            <button type="button" className={styles.fixBtn} onClick={() => api.setProposal(null)}>{a.dismiss}</button>
          </div>
        </>
      ) : (
        <div className={styles.proposalNote}>
          <p>{proposal.note}</p>
          <button type="button" className={styles.iconBtn} onClick={() => api.setProposal(null)} aria-label={a.dismiss} title={a.dismiss}>
            <EditorIcon name="close" />
          </button>
        </div>
      )}
    </div>
  );
  const examples = (
    <ul className={styles.examples}>
      {exampleKeys.map((key) => (
        <li key={key}>
          <button type="button" onClick={() => submit(a.examples[key])} disabled={closed} data-editor-example={key}>{a.examples[key]}</button>
        </li>
      ))}
    </ul>
  );
  const form = (
    <form
      className={styles.assistForm}
      onSubmit={(event) => {
        event.preventDefault();
        submit(text);
      }}
    >
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        placeholder={a.placeholder}
        aria-label={a.heading}
        maxLength={200}
        disabled={closed}
        data-editor-assist-input
      />
      <button type="submit" className={styles.iconBtn} aria-label={a.send} title={a.send} disabled={!text.trim() || closed}>
        <EditorIcon name="send" />
      </button>
    </form>
  );
  const mark = api.real ? <em className={styles.sampleTag} data-editor-assist-sample>{copy.panel.sample}</em> : null;
  if (placement === 'side') {
    return (
      <aside className={styles.assistSide} aria-label={a.heading} data-editor-assist="side">
        <header className={styles.panelHead}>
          <h2><EditorIcon name="spark" />{a.heading}{mark}</h2>
          <button type="button" className={styles.iconBtn} onClick={() => api.setAssistDock('bar')} aria-label={a.undock} title={a.undock}>
            <EditorIcon name="bar" />
          </button>
        </header>
        <div className={styles.assistLog}>
          {examples}
          {card}
        </div>
        {form}
      </aside>
    );
  }
  return (
    <div className={styles.assistBar} data-editor-assist="bar">
      {card}
      <span className={styles.assistLabel}><EditorIcon name="spark" />{a.heading}{mark}</span>
      {form}
      {examples}
      <button type="button" className={styles.iconBtn} onClick={() => api.setAssistDock('side')} aria-label={a.dock} title={a.dock}>
        <EditorIcon name="dock" />
      </button>
    </div>
  );
}
