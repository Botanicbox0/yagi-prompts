/**
 * Deterministic prompt assembly, used when the enhancer is off, has no key, or its answer fails a
 * check. No network. It keeps the customer's words, rewrites their reference mentions into the
 * model's syntax and adds only the structural lines each kind needs (reference roles, keep and
 * change, sound). It never adds description the customer did not give.
 */
import { composeBlueprintPrompt, isBlueprint } from './blueprint';
import { audioLine, effectiveSeconds, formatRange, keepPhrase, planShots, referenceClause } from './lines';
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

function referenceLines(input: EnhanceInput, bound: readonly BoundReference[], skipVideo = false): string[] {
  return bound
    .filter((b) => b.token && !(skipVideo && b.ref.kind === 'video'))
    .map((b) => referenceClause(input.profile, b));
}

function imagePrompt(input: EnhanceInput, binding: Binding, request: string): string {
  const refs = referenceLines(input, binding.bound);
  if (input.kind === 'region_edit') {
    const target = binding.editTarget ?? 'image 1';
    const lead = input.profile === 'seedream' ? `In ${target}, change only this` : `Using ${target}, change only this`;
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

function videoPrompt(input: EnhanceInput, binding: Binding, request: string): string {
  const video = input.video;
  const audio = audioLine(video?.audio ?? 'native');
  const seconds = effectiveSeconds(input.kind, video);
  const lines: string[] = [];

  if (isBlueprint(input)) return composeBlueprintPrompt(input, binding, request, seconds);
  if (input.kind === 'video_remix') {
    const ref = binding.bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
    const change = mapCustomerMentions(video?.change?.trim() ?? '', binding.bound);
    if (video?.method === 'edit') {
      const what = [change, request].filter(Boolean).map(sentence).join(' ');
      lines.push(`In ${ref}, change only the following: ${what || 'nothing else.'}`);
      lines.push('Everything else stays as it is.');
      lines.push(...referenceLines(input, binding.bound, true));
    } else {
      const kept = keepPhrase(video?.keep) || 'its overall structure';
      lines.push(`Follow ${ref} for ${kept}.`);
      if (change) lines.push(`Change: ${sentence(change)}`);
      lines.push(...referenceLines(input, binding.bound, true));
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
    lines.push(...referenceLines(input, binding.bound));
    lines.push(sentence(request));
    lines.push(...framesLines(binding));
  }
  if (audio) lines.push(audio);
  return lines.filter((l) => l.trim().length > 0).join('\n');
}

export function composeFallbackPrompt(input: EnhanceInput): EnhanceResult {
  const binding = bindReferences(input);
  const request = mapCustomerMentions(input.prompt.trim(), binding.bound);
  const prompt = input.profile === 'seedance' ? videoPrompt(input, binding, request) : imagePrompt(input, binding, request);
  return { prompt, notes: FALLBACK_NOTES[input.locale], source: 'fallback' };
}
