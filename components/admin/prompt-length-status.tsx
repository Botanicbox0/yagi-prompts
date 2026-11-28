import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { EDIT_HEADROOM_MIN_CHARS, formatPromptChars, readPromptLengthRefusal, type ClipHeadroom, type ClipLength } from '@/lib/engines/prompt-limits';
import { VIDEO_ENGINES, isVideoEngine } from '@/lib/images/engines';

/**
 * Founder, 2026-11-25: Seedance 2.5 and MAGI-2 take up to 15,000 characters per clip, and a template over that does
 * not go on sale (lib/prompts/prompt-length.ts). The template page shows each clip's length against its limit and the
 * room it leaves for a buyer's edits; a clip over the limit is flagged, and a template with too little room is said to
 * take no change requests (its page shows one line instead of the edit panel). Nothing is cut or unpublished for it.
 */
export function PromptLengthStatus({ clips, headroom = [], dict, engine }: {
  clips: readonly ClipLength[];
  headroom?: readonly ClipHeadroom[];
  dict: Dictionary;
  engine?: string | null;
}) {
  if (clips.length === 0) return null;
  const a = dict.admin;
  const over = clips.filter((clip) => clip.chars > clip.limit);
  const closed = headroom.some((room) => room.headroom < EDIT_HEADROOM_MIN_CHARS);
  const engineLabel = engine ? (isVideoEngine(engine) ? VIDEO_ENGINES[engine].label : engine) : null;
  return (
    <section data-prompt-length {...(closed ? { 'data-edits-closed': '' } : {})} className="mt-4 flex flex-col gap-1">
      {clips.map((clip) => {
        const isOver = clip.chars > clip.limit;
        const room = headroom.find((h) => h.clip === clip.clip && h.stepId === clip.stepId);
        const tight = room !== undefined && room.headroom < EDIT_HEADROOM_MIN_CHARS;
        return (
          <p
            key={`${clip.clip}-${clip.stepId ?? 'text'}`}
            data-prompt-length-clip={clip.clip}
            data-chars={clip.chars}
            data-over={isOver ? 'true' : undefined}
            {...(room ? { 'data-headroom': room.headroom } : {})}
            className={`font-mono text-[0.72rem] ${isOver || tight ? 'text-accent' : 'opacity-70'}`}
          >
            {clips.length > 1 ? `${interpolate(a.promptLengthClip, { n: String(clip.clip) })} · ` : ''}
            {interpolate(a.promptLengthLine, { chars: formatPromptChars(clip.chars), max: formatPromptChars(clip.limit) })}
            {room ? ` · ${interpolate(a.promptHeadroom, { n: formatPromptChars(Math.max(0, room.headroom)) })}` : ''}
          </p>
        );
      })}
      {over[0] && (
        <p data-prompt-over-limit className="font-mono text-[0.72rem] text-accent">
          {engine === 'magi-2' && engineLabel
            ? interpolate(a.promptOverEngineLimitForEngine, { max: formatPromptChars(over[0].limit), engine: engineLabel })
            : interpolate(a.promptOverEngineLimit, { max: formatPromptChars(over[0].limit) })}
        </p>
      )}
      {closed && (
        <p data-prompt-edits-closed className="font-mono text-[0.72rem] text-accent">
          {interpolate(a.promptEditsClosed, { min: formatPromptChars(EDIT_HEADROOM_MIN_CHARS) })}
        </p>
      )}
    </section>
  );
}

/** A save refused for a clip's length, in a sentence (the detail itself stays readable in the banner). */
export function promptLengthRefusalText(detail: unknown, refusal: string, refusalForEngine?: string): string | null {
  const read = readPromptLengthRefusal(detail);
  if (read === null) return null;
  const template = read.engine && refusalForEngine ? refusalForEngine : refusal;
  return interpolate(template, {
    n: String(read.clip),
    chars: formatPromptChars(read.chars),
    max: formatPromptChars(read.limit),
    ...(read.engine ? { engine: read.engine } : {}),
  });
}

export function PromptLengthRefusalNote({ detail, dict }: { detail: string | undefined; dict: Dictionary }) {
  const text = promptLengthRefusalText(detail, dict.admin.promptLengthRefusal, dict.admin.promptLengthRefusalForEngine);
  return text === null ? null : (
    <p role="alert" data-prompt-length-refusal className="mt-3 text-[13px] text-accent">
      {text}
    </p>
  );
}
