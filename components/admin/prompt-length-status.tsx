import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { formatPromptChars, readPromptLengthRefusal, type ClipLength } from '@/lib/engines/prompt-limits';

/**
 * Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters per clip, and a template over that does not go on
 * sale (lib/prompts/prompt-length.ts). The template page shows each clip's length against its limit; a clip over it is
 * flagged, and the sentence says what to do. Nothing is cut or unpublished for it.
 */
export function PromptLengthStatus({ clips, dict }: { clips: readonly ClipLength[]; dict: Dictionary }) {
  if (clips.length === 0) return null;
  const a = dict.admin;
  const over = clips.filter((clip) => clip.chars > clip.limit);
  return (
    <section data-prompt-length className="mt-4 flex flex-col gap-1">
      {clips.map((clip) => {
        const isOver = clip.chars > clip.limit;
        return (
          <p
            key={`${clip.clip}-${clip.stepId ?? 'text'}`}
            data-prompt-length-clip={clip.clip}
            data-chars={clip.chars}
            data-over={isOver ? 'true' : undefined}
            className={`font-mono text-[0.72rem] ${isOver ? 'text-accent' : 'opacity-70'}`}
          >
            {clips.length > 1 ? `${interpolate(a.promptLengthClip, { n: String(clip.clip) })} · ` : ''}
            {interpolate(a.promptLengthLine, { chars: formatPromptChars(clip.chars), max: formatPromptChars(clip.limit) })}
          </p>
        );
      })}
      {over[0] && (
        <p data-prompt-over-limit className="font-mono text-[0.72rem] text-accent">
          {interpolate(a.promptOverEngineLimit, { max: formatPromptChars(over[0].limit) })}
        </p>
      )}
    </section>
  );
}

/** A save refused for a clip's length, in a sentence (the detail itself stays readable in the banner). */
export function promptLengthRefusalText(detail: unknown, refusal: string): string | null {
  const read = readPromptLengthRefusal(detail);
  return read === null ? null : interpolate(refusal, { n: String(read.clip), chars: formatPromptChars(read.chars), max: formatPromptChars(read.limit) });
}

export function PromptLengthRefusalNote({ detail, dict }: { detail: string | undefined; dict: Dictionary }) {
  const text = promptLengthRefusalText(detail, dict.admin.promptLengthRefusal);
  return text === null ? null : (
    <p role="alert" data-prompt-length-refusal className="mt-3 text-[13px] text-accent">
      {text}
    </p>
  );
}
