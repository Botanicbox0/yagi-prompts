/**
 * The worst-case model of the proof harness (audit §4 (e) 1): a fake provider whose schema-valid answers
 * carry, in turn, the internal text it was sent, a 60-word window of it, the canary, a reordered
 * paraphrase made of its 8-gram windows, a base64 window, an 8-word window in the short `notes` field,
 * and a benign control. Everything is derived from the request body actually sent, so it is
 * deterministic for a deterministic request.
 */
import { BENIGN_NOTES, geminiJson, isSiteCall, recordingFetch, type ReferenceCase } from './reference-cases';

export const ANSWER_KINDS = ['benign', 'full', 'window60', 'canary', 'reordered8', 'base64', 'notes8'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** The system text of a sent Gemini request body. */
export function systemOf(body: string): string {
  const parsed = JSON.parse(body) as { systemInstruction?: { parts?: Array<{ text?: string }> } };
  return parsed.systemInstruction?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

/** The user-turn text parts of a sent Gemini request body. */
export function userTextOf(body: string): string[] {
  const parsed = JSON.parse(body) as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
  return (parsed.contents ?? []).flatMap((c) => (c.parts ?? []).map((p) => p.text).filter((t): t is string => typeof t === 'string'));
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** The canary the guard put in `system`, or a stand-in when there is none (PROMPT_GUARD=off). */
export function canaryOf(system: string): string {
  return /\b(pgc[a-z0-9]{20})\b/.exec(system)?.[1] ?? 'pgcnocanarywasinthisrequest';
}

export function leakAnswer(kind: AnswerKind, system: string, benign: string): { prompt: string; notes: string } {
  const w = words(system);
  const from = Math.floor(w.length / 3);
  switch (kind) {
    case 'benign':
      return { prompt: benign, notes: BENIGN_NOTES };
    // Each leak rides on the benign answer, so the sites' own checks (reference tokens, required lines)
    // pass and only the guard stands between the leak and the customer. Only `full` may still be stopped
    // by a site's own length limit first.
    case 'full':
      return { prompt: `${benign}\n${system}`, notes: BENIGN_NOTES };
    case 'window60':
      return { prompt: `${benign}\n${w.slice(from, from + 60).join(' ')}`, notes: BENIGN_NOTES };
    case 'canary':
      return { prompt: `${benign}\nReference: ${canaryOf(system)}`, notes: BENIGN_NOTES };
    case 'reordered8': {
      const windows: string[] = [];
      for (let i = 0; i < 5; i += 1) windows.push(w.slice(from + i * 12, from + i * 12 + 8).join(' '));
      return { prompt: `${benign}\n${windows.reverse().join('. ')}`, notes: BENIGN_NOTES };
    }
    case 'base64':
      return { prompt: `${benign}\nCode: ${Buffer.from(w.slice(from, from + 40).join(' '), 'utf8').toString('base64')}`, notes: BENIGN_NOTES };
    case 'notes8':
      return { prompt: benign, notes: `${w.slice(from, from + 9).join(' ')}.` };
  }
}

/** The director's media analyzer answer when the live analyzer runs in a case. */
const ANALYZER_ANSWER = {
  paletteHex: ['#14181F', '#EAE4DC', '#3875C5'],
  lightingNotes: 'soft window key from camera-left',
  textureNotes: 'matte glass grain',
  subjectNotes: 'a matte serum bottle',
  referenceNotes: [{ token: '@Image 1', visualNotes: 'matte glass bottle' }],
};

/** A fetch double that answers the site's own call with the `kind` answer built from what it was sent. */
export function leakingFetch(kind: AnswerKind, c: ReferenceCase) {
  return recordingFetch((_n, body) => {
    if (!isSiteCall(body)) return geminiJson(ANALYZER_ANSWER);
    return geminiJson(leakAnswer(kind, systemOf(body), c.benign));
  });
}
