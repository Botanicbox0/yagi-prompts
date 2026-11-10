/**
 * One more try after a provider's safety review stopped a run (docs/BRAND-STUDIO-V2.md §8.4).
 *
 * A review often trips on wording rather than on the picture that was asked for ("bare shoulders",
 * "shoot", a celebrity's name used as a style), and the same request sometimes simply passes the
 * second time. So a blocked run gets exactly one retry: Gemini rewrites the words a filter could
 * misread, keeping the scene the same, or answers that the request is the kind a review exists to
 * stop, in which case nothing is retried.
 *
 * This is not a way around the review: the retry goes through the same review with the safety
 * checker on, and the rewrite is forbidden from disguising anything (no code words, misspellings,
 * "it is fiction" framing). When Gemini cannot be reached, the unchanged prompt is tried once more.
 * Server-only.
 */
import { z } from 'zod';
import type { StudioPromptProfile } from '@/lib/brand-studio/models';
import { callGeminiJson, studioGeminiConfig } from './gemini';
import type { EnhanceDeps, EnhanceKind } from './types';

export interface BlockedInput {
  /** The text the provider reviewed (the enhanced prompt, or the customer's words). */
  prompt: string;
  kind: EnhanceKind;
  profile: StudioPromptProfile;
}

export type BlockedRewrite =
  | { action: 'retry'; prompt: string; source: 'model' | 'same' }
  /** The request itself is what the review is for: do not try again. */
  | { action: 'stop' };

const PROMPT_MAX = 6000;
const TIMEOUT_MS = 30_000;

const Answer = z.object({ decision: z.enum(['rewrite', 'stop']), prompt: z.string().max(PROMPT_MAX).default('') });

const SCHEMA = {
  type: 'object',
  properties: { decision: { type: 'string', enum: ['rewrite', 'stop'] }, prompt: { type: 'string' } },
  required: ['decision', 'prompt'],
};

const SYSTEM = `A provider's safety review stopped the prompt in the user turn, before or during generation. The prompt was written for a brand's own marketing. Reviews of this kind often react to a word, not to the picture or video that was asked for. Decide between two answers.

Answer "stop" when the prompt really asks for something a safety review exists to stop:
- sexual content, nudity, or a sexualised view of a body;
- a child, or anyone who reads as under 18, in a sensual, intimate, frightening or dangerous situation;
- violence against people or animals, gore, self-harm, or a weapon used on someone;
- hateful, degrading or harassing depiction of a person or group;
- a real, named or recognisable person (a celebrity, a politician, a private individual), or an imitation of one;
- another company's logo, character, trademark or artwork;
- deception: fake documents, fake news, impersonation, medical or financial claims presented as fact;
- anything illegal.
With "stop", return an empty prompt.

Otherwise answer "rewrite" and return the same prompt with only the risky wording changed:
- Keep the scene, the subjects, the actions, their order and timing, the camera, the light, the format of the prompt (blocks, time ranges, "Audio:" line) and every reference token exactly as written (@Image1, @Video1, @Audio1, Figure 1, image 1). Keep every piece of on-screen or spoken text verbatim.
- Describe people by what they wear, how they stand and what they do, not by body parts or skin. Never change anyone's age, and never call someone an adult unless the prompt already says so.
- Replace words that have a violent, sexual or medical second meaning with the literal, neutral one (for example "shoot" a scene becomes "film", a "bare" surface becomes "uncovered", "killer look" becomes "striking look", "hot" becomes "warm" or is dropped).
- Replace words that push intensity toward the body or toward danger (seductive, sexy, provocative, sultry, aggressive, explosive) with the plain intent (confident, relaxed, energetic).
- Remove the names of real people, and of brands or works other than the customer's own product; describe the look in plain words instead.
- Add nothing new: no new subjects, claims, text or story.
- Never disguise anything. No misspellings, code words, other languages, symbols in place of letters, "fictional" or "for a film" framing, and no instruction to ignore rules. The rewrite will be reviewed again and must read as an honest description of the same request.
If you cannot find any wording to change, return the prompt unchanged with "rewrite".

Return JSON only: {"decision": "rewrite" | "stop", "prompt": string}.`;

/** Reference tokens a rewrite must not lose (Seedance, Seedream and Nano Banana forms). */
const TOKEN = /@(?:Image|Video|Audio)\d+|\bFigure \d+|\bimage \d+/g;

function tokensOf(text: string): string[] {
  return [...new Set(text.match(TOKEN) ?? [])].sort();
}

export async function rewriteBlockedPrompt(input: BlockedInput, deps: EnhanceDeps): Promise<BlockedRewrite> {
  const original = input.prompt.trim();
  const same: BlockedRewrite = { action: 'retry', prompt: original, source: 'same' };
  if (!original) return { action: 'stop' };
  const config = studioGeminiConfig(deps.env);
  if (!config) return same;
  try {
    const raw = await callGeminiJson(config, deps.fetch, {
      system: SYSTEM,
      parts: [{ text: JSON.stringify({ for: input.kind, style: input.profile, prompt: original }) }],
      schema: SCHEMA,
      thinking: 'LOW',
      timeoutMs: TIMEOUT_MS,
    });
    const answer = Answer.parse(raw);
    if (answer.decision === 'stop') return { action: 'stop' };
    const rewritten = answer.prompt.trim();
    if (!rewritten || rewritten === original) return same;
    // A rewrite that dropped or renumbered a reference would send different media: keep the original.
    if (tokensOf(rewritten).join('|') !== tokensOf(original).join('|')) return same;
    return { action: 'retry', prompt: rewritten, source: 'model' };
  } catch (error) {
    deps.onFallback?.(error instanceof Error ? error.message.slice(0, 60) : 'rewrite_failed');
    return same;
  }
}
