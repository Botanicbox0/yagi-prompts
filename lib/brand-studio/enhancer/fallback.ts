/**
 * Deterministic prompt assembly, used when the enhancer is off, has no key, or its answer fails a
 * check. No network. It keeps the customer's words, rewrites their reference mentions into the
 * model's syntax and adds only the structural lines each kind needs (reference roles, keep and
 * change, sound). It never adds description the customer did not give.
 */
import { composeBlueprintPrompt, isBlueprint } from './blueprint';
import { audioLine, effectiveSeconds, formatRange, keepPhrase, planShots, referenceClause } from './lines';
import { withClarified } from '../revision/clarify';
import { replaceMarks, type MarkWords } from './marks';
import { bindReferences, mapCustomerMentions, type Binding, type BoundReference } from './references';
import type { EnhanceInput, EnhanceResult } from './types';

const FALLBACK_NOTES = {
  ko: '입력하신 문장에 참조 표기와 기본 지시만 더해 보냈어요.',
  en: 'Your words were sent as written, with the references and basic directions added.',
} as const;

function sentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return /[.!?。…)"”'’]$/.test(t) ? t : `${t}.`;
}

function referenceLines(
  input: EnhanceInput,
  bound: readonly BoundReference[],
  skipVideo = false,
  env: Record<string, string | undefined> = process.env,
): string[] {
  return bound
    .filter((b) => b.token && !(skipVideo && b.ref.kind === 'video'))
    .map((b) => referenceClause(input.profile, b, env));
}

function imagePrompt(
  input: EnhanceInput,
  binding: Binding,
  request: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const refs = referenceLines(input, binding.bound, false, env);
  if (input.kind === 'region_edit') {
    const target = binding.editTarget ?? 'image 1';
    const wide = input.regionWindow;
    const lead = wide
      ? `In ${target}, change only the boxed part in the ${wide.where}`
      : input.profile === 'seedream' ? `In ${target}, change only this` : `Using ${target}, change only this`;
    return [
      `${lead}: ${sentence(request)}`,
      'Do not move or resize anything else.',
      ...refs,
      `Keep the exact framing, camera angle, object scale, outer silhouette, contours, perspective, light direction, colour, shadows, texture, grain and pixel positions of ${target}; never redraw, enlarge or reshape the surrounding object.`,
    ].join(input.profile === 'seedream' ? ' ' : '\n');
  }
  if (input.profile === 'seedream') return [sentence(request), ...refs].join(' ');
  const lead = binding.bound.some((b) => b.token) ? `Using ${binding.bound.find((b) => b.token)!.token}: ` : '';
  return [`${lead}${sentence(request)}`, ...refs].join('\n');
}

function framesLines(binding: Binding): string[] {
  if (binding.seedanceMode !== 'frames') return [];
  const lines = ['Start from the opening frame and move on from it.'];
  if (binding.bound.some((b) => b.ref.frame === 'end')) lines.push('End on the closing frame.');
  return lines;
}

function videoPrompt(
  input: EnhanceInput,
  binding: Binding,
  request: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const video = input.video;
  const audio = audioLine(video?.audio ?? 'native');
  const seconds = effectiveSeconds(input.kind, video);
  const lines: string[] = [];

  if (isBlueprint(input)) return composeBlueprintPrompt(input, binding, request, seconds, env);
  if (input.kind === 'video_remix') {
    const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
    const change = mapCustomerMentions(video?.change?.trim() ?? '', binding.bound);
    if (video?.method === 'edit') {
      const what = [change, request].filter(Boolean).map(sentence).join(' ');
      lines.push(`In ${ref}, change only the following: ${what || 'nothing else.'}`);
      lines.push('Everything else stays as it is.');
      lines.push(...referenceLines(input, binding.bound, true, env));
    } else {
      const kept = keepPhrase(video?.keep) || 'its overall structure';
      lines.push(`Follow ${ref} for ${kept}.`);
      if (change) lines.push(`Change: ${sentence(change)}`);
      lines.push(...referenceLines(input, binding.bound, true, env));
      if (request) lines.push(sentence(request));
      const keep = new Set(video?.keep ?? []);
      const shots = planShots(seconds, video);
      if (shots.length > 0 && (keep.has('timing') || keep.has('camera') || keep.has('composition') || keep.has('motion'))) {
        shots.forEach((s, i) => {
          const parts = [
            keep.has('composition') ? s.framing : '',
            keep.has('camera') ? s.camera : '',
            keep.has('motion') ? s.action : '',
          ].filter((p) => p.trim().length > 0);
          const body = parts.length ? sentence(parts.join(', ')) : 'Shot as in the reference.';
          const cut = keep.has('timing') && i < shots.length - 1 ? 'Hard cut.' : '';
          lines.push(`${formatRange(s.start, s.end)}: ${body} ${cut}`.trim());
        });
      }
    }
  } else {
    lines.push(...referenceLines(input, binding.bound, false, env));
    lines.push(sentence(request));
    lines.push(...framesLines(binding));
  }
  if (audio) lines.push(audio);
  return lines.filter((l) => l.trim().length > 0).join('\n');
}

/**
 * A reshoot without a model: the earlier prompt as it was sent, a blank line, then every change asked
 * for since, oldest first, as plain lines. Never empty: with nothing at all it is the request.
 */
function reshootPrompt(input: EnhanceInput, binding: Binding, request: string): string {
  const revision = input.revision!;
  // Earlier requests' own marks were written out before they got here (lib/brand-studio/prepare.ts);
  // a sign left over is only ever "the marked spot".
  const changes = [...revision.history.map((h) => mapCustomerMentions(replaceMarks(h.trim(), []), binding.bound)), request]
    .map(sentence)
    .filter(Boolean);
  const madeWith = revision.madeWith.trim();
  const text = [madeWith, changes.join('\n')].filter(Boolean).join('\n\n');
  return text || request || replaceMarks(input.prompt.trim(), markWords(input));
}

/** Mark n of a revision as words, by its number (①②③ in the request). */
function markWords(input: EnhanceInput): MarkWords[] {
  const words: MarkWords[] = [];
  for (const m of input.revision?.marks ?? []) if (m.n >= 1 && m.n <= 20) words[m.n - 1] = { what: m.what, label: m.label ?? null };
  return Array.from({ length: words.length }, (_, i) => words[i] ?? {});
}

export function composeFallbackPrompt(
  input: EnhanceInput,
  options: { env?: Record<string, string | undefined> } = {},
): EnhanceResult {
  const binding = bindReferences(input);
  // A revision's ①②③ become what each spot is on; the video model never reads the signs. The answer to
  // the one question asked about it follows the request, so what was meant reaches the model too.
  const said = input.revision ? withClarified(replaceMarks(input.prompt.trim(), markWords(input)), input.revision.clarified) : input.prompt.trim();
  const request = mapCustomerMentions(said, binding.bound);
  // An edit-revision is the ordinary edit fallback with the request as the change.
  if (input.revision?.mode === 'reshoot' && input.profile === 'seedance') {
    return { prompt: reshootPrompt(input, binding, request), notes: FALLBACK_NOTES[input.locale], source: 'fallback' };
  }
  const prompt = input.profile === 'seedance' ? videoPrompt(input, binding, request, options.env) : imagePrompt(input, binding, request, options.env);
  return { prompt, notes: FALLBACK_NOTES[input.locale], source: 'fallback' };
}
